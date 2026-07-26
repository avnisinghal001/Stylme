package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"stylme/go-backend/internal/domain"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

var ErrNotFound = errors.New("not found")

type MongoStore struct {
	client *mongo.Client
	db     *mongo.Database
}

func New(ctx context.Context, uri, database string) (*MongoStore, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, fmt.Errorf("connect mongo: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(ctx)
		return nil, fmt.Errorf("ping mongo: %w", err)
	}
	return &MongoStore{client: client, db: client.Database(database)}, nil
}

func (s *MongoStore) Close(ctx context.Context) error { return s.client.Disconnect(ctx) }
func (s *MongoStore) Ping(ctx context.Context) error  { return s.client.Ping(ctx, nil) }

func (s *MongoStore) EnsureIndexes(ctx context.Context) error {
	// v1 briefly created this invalid compound multikey index before swarm
	// documents existed. MongoDB cannot index two array fields in one compound
	// index, so remove that exact legacy definition before seeding defaults.
	if err := s.db.Collection("agent_swarms").Indexes().DropOne(ctx, "channels_1_directions_1_status_1"); err != nil {
		var commandErr mongo.CommandError
		if !errors.As(err, &commandErr) || commandErr.Code != 27 {
			return fmt.Errorf("drop invalid legacy swarm index: %w", err)
		}
	}
	ttl := int32(0)
	collections := []struct {
		name   string
		models []mongo.IndexModel
	}{
		{"ai_agents", []mongo.IndexModel{
			{Keys: bson.D{{Key: "key", Value: 1}}, Options: options.Index().SetUnique(true)},
			{Keys: bson.D{{Key: "channels", Value: 1}, {Key: "direction", Value: 1}, {Key: "status", Value: 1}}},
		}},
		{"agent_swarms", []mongo.IndexModel{
			{Keys: bson.D{{Key: "key", Value: 1}}, Options: options.Index().SetUnique(true)},
			{Keys: bson.D{{Key: "channels", Value: 1}, {Key: "status", Value: 1}}},
			{Keys: bson.D{{Key: "directions", Value: 1}, {Key: "status", Value: 1}}},
		}},
		{"campaigns", []mongo.IndexModel{
			{Keys: bson.D{{Key: "status", Value: 1}, {Key: "updated_at", Value: -1}}},
			{Keys: bson.D{{Key: "swarm_id", Value: 1}, {Key: "created_at", Value: -1}}},
			{Keys: bson.D{{Key: "kind", Value: 1}, {Key: "status", Value: 1}}},
		}},
		{"calls", []mongo.IndexModel{
			{Keys: bson.D{{Key: "idempotency_key", Value: 1}}, Options: options.Index().SetUnique(true)},
			{Keys: bson.D{{Key: "campaign_id", Value: 1}, {Key: "status", Value: 1}, {Key: "scheduled_at", Value: 1}}},
			{Keys: bson.D{{Key: "direction", Value: 1}, {Key: "created_at", Value: -1}}},
			{Keys: bson.D{{Key: "livekit.room_name", Value: 1}}, Options: options.Index().SetSparse(true)},
		}},
		{"ai_sessions", []mongo.IndexModel{
			{Keys: bson.D{{Key: "expires_at", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(ttl)},
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "updated_at", Value: -1}}},
		}},
		{"provider_credentials", []mongo.IndexModel{
			{Keys: bson.D{{Key: "provider", Value: 1}, {Key: "status", Value: 1}, {Key: "updated_at", Value: -1}}},
			{Keys: bson.D{{Key: "expires_at", Value: 1}}, Options: options.Index().SetSparse(true)},
		}},
	}
	for _, collection := range collections {
		if _, err := s.db.Collection(collection.name).Indexes().CreateMany(ctx, collection.models); err != nil {
			return fmt.Errorf("create %s indexes: %w", collection.name, err)
		}
	}
	return nil
}

func (s *MongoStore) SeedDefaults(ctx context.Context, model string) error {
	for _, agent := range domain.DefaultAgents(model) {
		_, err := s.db.Collection("ai_agents").UpdateOne(ctx, bson.M{"_id": agent.ID}, bson.M{"$setOnInsert": agent}, options.UpdateOne().SetUpsert(true))
		if err != nil {
			return fmt.Errorf("seed agent %s: %w", agent.Key, err)
		}
	}
	for _, swarm := range domain.DefaultSwarms() {
		_, err := s.db.Collection("agent_swarms").UpdateOne(ctx, bson.M{"_id": swarm.ID}, bson.M{"$setOnInsert": swarm}, options.UpdateOne().SetUpsert(true))
		if err != nil {
			return fmt.Errorf("seed swarm %s: %w", swarm.Key, err)
		}
	}
	for _, campaign := range domain.DefaultCampaigns() {
		_, err := s.db.Collection("campaigns").UpdateOne(ctx, bson.M{"_id": campaign.ID}, bson.M{"$setOnInsert": campaign}, options.UpdateOne().SetUpsert(true))
		if err != nil {
			return fmt.Errorf("seed campaign %s: %w", campaign.ID, err)
		}
	}
	if err := s.migrateDefaultInboundV3(ctx, model); err != nil {
		return err
	}
	return s.migrateDefaultRuntimeToolsV4(ctx)
}

func (s *MongoStore) migrateDefaultRuntimeToolsV4(ctx context.Context) error {
	agent, err := s.GetAgent(ctx, "agent_default_outbound_stylist")
	if err != nil {
		return fmt.Errorf("load default outbound tool migration: %w", err)
	}
	changed := false
	for index := range agent.Tools {
		if agent.Tools[index].Key == "send_recovery_link" && agent.Tools[index].Enabled {
			agent.Tools[index].Enabled = false
			agent.Tools[index].Description = "Requires a transactional messaging integration before it can be enabled."
			changed = true
		}
	}
	if !changed {
		return nil
	}
	agent.Revision++
	agent.UpdatedAt = time.Now().UTC()
	agent.UpdatedBy = "seed-migration-runtime-tools-v4"
	if err := s.SaveAgent(ctx, agent); err != nil {
		return fmt.Errorf("migrate default outbound runtime tools: %w", err)
	}
	return nil
}

func (s *MongoStore) migrateDefaultInboundV3(ctx context.Context, model string) error {
	desiredAgents := map[string]domain.Agent{}
	for _, agent := range domain.DefaultAgents(model) {
		if agent.ID == "agent_default_inbound_concierge" || agent.ID == "agent_inbound_human_handoff" {
			desiredAgents[agent.ID] = agent
		}
	}
	now := time.Now().UTC()
	for id, desired := range desiredAgents {
		existing, err := s.GetAgent(ctx, id)
		if err != nil {
			return fmt.Errorf("load default agent migration %s: %w", id, err)
		}
		if existing.Metadata["seed"] == "stylme-v3" {
			continue
		}
		desired.CreatedAt = existing.CreatedAt
		desired.CreatedBy = existing.CreatedBy
		desired.Revision = existing.Revision + 1
		desired.UpdatedAt = now
		desired.UpdatedBy = "seed-migration-v3"
		if err := s.SaveAgent(ctx, desired); err != nil {
			return fmt.Errorf("migrate default agent %s: %w", id, err)
		}
	}

	var desiredSwarm domain.AgentSwarm
	for _, swarm := range domain.DefaultSwarms() {
		if swarm.ID == "swarm_default_inbound" {
			desiredSwarm = swarm
			break
		}
	}
	existingSwarm, err := s.GetSwarm(ctx, desiredSwarm.ID)
	if err != nil {
		return fmt.Errorf("load default inbound migration: %w", err)
	}
	if existingSwarm.Metadata["seed"] == "stylme-v3" {
		return nil
	}
	desiredSwarm.Telephony.PhoneNumber = existingSwarm.Telephony.PhoneNumber
	desiredSwarm.Telephony.InboundTrunkID = existingSwarm.Telephony.InboundTrunkID
	desiredSwarm.Telephony.OutboundTrunkID = existingSwarm.Telephony.OutboundTrunkID
	desiredSwarm.Telephony.DispatchRuleID = existingSwarm.Telephony.DispatchRuleID
	if existingSwarm.Telephony.LiveKitAgentName != "" {
		desiredSwarm.Telephony.LiveKitAgentName = existingSwarm.Telephony.LiveKitAgentName
	}
	desiredSwarm.CreatedAt = existingSwarm.CreatedAt
	desiredSwarm.CreatedBy = existingSwarm.CreatedBy
	desiredSwarm.Revision = existingSwarm.Revision + 1
	desiredSwarm.UpdatedAt = now
	desiredSwarm.UpdatedBy = "seed-migration-v3"
	if err := s.SaveSwarm(ctx, desiredSwarm); err != nil {
		return fmt.Errorf("migrate default inbound swarm: %w", err)
	}
	return nil
}

func (s *MongoStore) ListAgents(ctx context.Context) ([]domain.Agent, error) {
	return findMany[domain.Agent](ctx, s.db.Collection("ai_agents"), bson.M{}, options.Find().SetSort(bson.D{{Key: "is_default", Value: -1}, {Key: "updated_at", Value: -1}}))
}

func (s *MongoStore) GetAgent(ctx context.Context, id string) (domain.Agent, error) {
	return findOne[domain.Agent](ctx, s.db.Collection("ai_agents"), bson.M{"_id": id})
}

func (s *MongoStore) GetDefaultAgent(ctx context.Context, channel string) (domain.Agent, error) {
	return findOneWithOptions[domain.Agent](ctx, s.db.Collection("ai_agents"), bson.M{"channels": channel, "status": "active", "is_default": true}, options.FindOne().SetSort(bson.D{{Key: "revision", Value: -1}}))
}

func (s *MongoStore) SaveAgent(ctx context.Context, agent domain.Agent) error {
	_, err := s.db.Collection("ai_agents").ReplaceOne(ctx, bson.M{"_id": agent.ID}, agent, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) ClearAgentDefaults(ctx context.Context, id string, channels []string, direction string) error {
	filter := bson.M{"_id": bson.M{"$ne": id}, "is_default": true, "channels": bson.M{"$in": channels}}
	if direction != "" {
		filter["direction"] = direction
	}
	_, err := s.db.Collection("ai_agents").UpdateMany(ctx, filter, bson.M{"$set": bson.M{"is_default": false, "updated_at": time.Now().UTC()}})
	return err
}

func (s *MongoStore) ListSwarms(ctx context.Context) ([]domain.AgentSwarm, error) {
	return findMany[domain.AgentSwarm](ctx, s.db.Collection("agent_swarms"), bson.M{}, options.Find().SetSort(bson.D{{Key: "is_default", Value: -1}, {Key: "updated_at", Value: -1}}))
}

func (s *MongoStore) GetSwarm(ctx context.Context, id string) (domain.AgentSwarm, error) {
	return findOne[domain.AgentSwarm](ctx, s.db.Collection("agent_swarms"), bson.M{"_id": id})
}

func (s *MongoStore) GetDefaultSwarm(ctx context.Context, channel, direction string) (domain.AgentSwarm, error) {
	return findOneWithOptions[domain.AgentSwarm](ctx, s.db.Collection("agent_swarms"), bson.M{"channels": channel, "directions": direction, "status": "active", "is_default": true}, options.FindOne().SetSort(bson.D{{Key: "revision", Value: -1}}))
}

func (s *MongoStore) GetOutboundSwarmForAgent(ctx context.Context, agentID string) (domain.AgentSwarm, error) {
	return findOneWithOptions[domain.AgentSwarm](ctx, s.db.Collection("agent_swarms"), bson.M{
		"channels":             "voice",
		"directions":           "outbound",
		"status":               "active",
		"graph.nodes.agent_id": agentID,
	}, options.FindOne().SetSort(bson.D{{Key: "is_default", Value: -1}, {Key: "revision", Value: -1}}))
}

func (s *MongoStore) SaveSwarm(ctx context.Context, swarm domain.AgentSwarm) error {
	_, err := s.db.Collection("agent_swarms").ReplaceOne(ctx, bson.M{"_id": swarm.ID}, swarm, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) ClearSwarmDefaults(ctx context.Context, id string, channels, directions []string) error {
	filter := bson.M{"_id": bson.M{"$ne": id}, "is_default": true, "channels": bson.M{"$in": channels}, "directions": bson.M{"$in": directions}}
	_, err := s.db.Collection("agent_swarms").UpdateMany(ctx, filter, bson.M{"$set": bson.M{"is_default": false, "updated_at": time.Now().UTC()}})
	return err
}

func (s *MongoStore) ListCampaigns(ctx context.Context) ([]domain.Campaign, error) {
	return findMany[domain.Campaign](ctx, s.db.Collection("campaigns"), bson.M{}, options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}}).SetLimit(250))
}

func (s *MongoStore) GetCampaign(ctx context.Context, id string) (domain.Campaign, error) {
	return findOne[domain.Campaign](ctx, s.db.Collection("campaigns"), bson.M{"_id": id})
}

func (s *MongoStore) GetCampaignByKind(ctx context.Context, kind string) (domain.Campaign, error) {
	return findOneWithOptions[domain.Campaign](ctx, s.db.Collection("campaigns"), bson.M{
		"kind": kind, "status": bson.M{"$in": bson.A{"draft", "running", "paused"}},
	}, options.FindOne().SetSort(bson.D{{Key: "status", Value: 1}, {Key: "updated_at", Value: -1}}))
}

func (s *MongoStore) SaveCampaign(ctx context.Context, campaign domain.Campaign) error {
	_, err := s.db.Collection("campaigns").ReplaceOne(ctx, bson.M{"_id": campaign.ID}, campaign, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) InsertCalls(ctx context.Context, calls []domain.Call) (int, error) {
	if len(calls) == 0 {
		return 0, nil
	}
	docs := make([]any, len(calls))
	for i := range calls {
		docs[i] = calls[i]
	}
	result, err := s.db.Collection("calls").InsertMany(ctx, docs, options.InsertMany().SetOrdered(false))
	if mongo.IsDuplicateKeyError(err) {
		return len(result.InsertedIDs), nil
	}
	if err != nil {
		return len(result.InsertedIDs), err
	}
	return len(result.InsertedIDs), nil
}

func (s *MongoStore) SaveCall(ctx context.Context, call domain.Call) error {
	_, err := s.db.Collection("calls").ReplaceOne(ctx, bson.M{"_id": call.ID}, call, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) GetCall(ctx context.Context, id string) (domain.Call, error) {
	return findOne[domain.Call](ctx, s.db.Collection("calls"), bson.M{"_id": id})
}

func (s *MongoStore) GetCallByIdempotencyKey(ctx context.Context, key string) (domain.Call, error) {
	return findOne[domain.Call](ctx, s.db.Collection("calls"), bson.M{"idempotency_key": key})
}

func (s *MongoStore) GetCallByRoom(ctx context.Context, room string) (domain.Call, error) {
	return findOne[domain.Call](ctx, s.db.Collection("calls"), bson.M{"livekit.room_name": room})
}

func (s *MongoStore) ListCalls(ctx context.Context, filter bson.M, limit int64) ([]domain.Call, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	return findMany[domain.Call](ctx, s.db.Collection("calls"), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(limit))
}

func (s *MongoStore) ListCallsPage(ctx context.Context, filter bson.M, page, pageSize int64) ([]domain.Call, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	total, err := s.db.Collection("calls").CountDocuments(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	items, err := findMany[domain.Call](ctx, s.db.Collection("calls"), filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetSkip((page-1)*pageSize).SetLimit(pageSize))
	return items, total, err
}

func (s *MongoStore) ListCredentials(ctx context.Context) ([]domain.ProviderCredential, error) {
	return findMany[domain.ProviderCredential](ctx, s.db.Collection("provider_credentials"), bson.M{}, options.Find().SetSort(bson.D{{Key: "provider", Value: 1}, {Key: "updated_at", Value: -1}}))
}

func (s *MongoStore) GetActiveCredential(ctx context.Context, provider string, now time.Time) (domain.ProviderCredential, error) {
	return findOneWithOptions[domain.ProviderCredential](ctx, s.db.Collection("provider_credentials"), bson.M{
		"provider": provider,
		"status":   "active",
		"$or": bson.A{
			bson.M{"expires_at": bson.M{"$exists": false}},
			bson.M{"expires_at": nil},
			bson.M{"expires_at": bson.M{"$gt": now}},
		},
	}, options.FindOne().SetSort(bson.D{{Key: "updated_at", Value: -1}}))
}

func (s *MongoStore) UpsertCredential(ctx context.Context, credential domain.ProviderCredential) error {
	_, err := s.db.Collection("provider_credentials").UpdateOne(
		ctx,
		bson.M{"_id": credential.ID},
		bson.M{
			"$set": bson.M{
				"provider": credential.Provider, "label": credential.Label,
				"ciphertext": credential.Ciphertext, "key_hint": credential.KeyHint,
				"status": credential.Status, "expires_at": credential.ExpiresAt,
				"metadata": credential.Metadata, "updated_by": credential.UpdatedBy,
				"updated_at": credential.UpdatedAt,
			},
			"$setOnInsert": bson.M{
				"created_by": credential.CreatedBy, "created_at": credential.CreatedAt,
			},
		},
		options.UpdateOne().SetUpsert(true),
	)
	return err
}

func (s *MongoStore) DeactivateProviderCredentials(ctx context.Context, provider, exceptID string) error {
	filter := bson.M{"provider": provider, "status": "active", "_id": bson.M{"$ne": exceptID}}
	_, err := s.db.Collection("provider_credentials").UpdateMany(ctx, filter, bson.M{"$set": bson.M{"status": "superseded", "updated_at": time.Now().UTC()}})
	return err
}

func (s *MongoStore) ClaimPendingCall(ctx context.Context, now time.Time, lease time.Duration) (domain.Call, error) {
	filter := bson.M{"status": "pending", "scheduled_at": bson.M{"$lte": now}, "$or": bson.A{bson.M{"lease_until": bson.M{"$exists": false}}, bson.M{"lease_until": bson.M{"$lte": now}}}}
	update := bson.M{"$set": bson.M{"status": "dispatching", "lease_until": now.Add(lease), "updated_at": now}, "$inc": bson.M{"attempt": 1}}
	var call domain.Call
	err := s.db.Collection("calls").FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetSort(bson.D{{Key: "scheduled_at", Value: 1}}).SetReturnDocument(options.After)).Decode(&call)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return domain.Call{}, ErrNotFound
	}
	return call, err
}

func (s *MongoStore) CountActiveCampaignCalls(ctx context.Context, campaignID, excludeCallID string) (int64, error) {
	filter := bson.M{
		"campaign_id": campaignID,
		"status":      bson.M{"$in": bson.A{"dispatching", "ringing", "active"}},
	}
	if excludeCallID != "" {
		filter["_id"] = bson.M{"$ne": excludeCallID}
	}
	return s.db.Collection("calls").CountDocuments(ctx, filter)
}

func (s *MongoStore) IncrementCampaignCount(ctx context.Context, campaignID, key string, delta int64) error {
	if campaignID == "" {
		return nil
	}
	_, err := s.db.Collection("campaigns").UpdateOne(ctx, bson.M{"_id": campaignID}, bson.M{"$inc": bson.M{"counts." + key: delta}, "$set": bson.M{"updated_at": time.Now().UTC()}})
	return err
}

func (s *MongoStore) CampaignCallAnalytics(ctx context.Context, campaignID, period, timezone string) ([]map[string]any, error) {
	format := "%Y-%m-%d"
	if period == "month" {
		format = "%Y-%m"
	}
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"campaign_id": campaignID}}},
		{{Key: "$group", Value: bson.M{
			"_id": bson.M{
				"period": bson.M{"$dateToString": bson.M{"format": format, "date": "$created_at", "timezone": timezone}},
				"status": "$status",
			},
			"count": bson.M{"$sum": 1},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "_id.period", Value: -1}, {Key: "_id.status", Value: 1}}}},
		{{Key: "$limit", Value: 500}},
	}
	cursor, err := s.db.Collection("calls").Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	type row struct {
		ID struct {
			Period string `bson:"period"`
			Status string `bson:"status"`
		} `bson:"_id"`
		Count int64 `bson:"count"`
	}
	var rows []row
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(rows))
	for _, item := range rows {
		result = append(result, map[string]any{"period": item.ID.Period, "status": item.ID.Status, "count": item.Count})
	}
	return result, nil
}

func (s *MongoStore) SaveSession(ctx context.Context, session domain.AISession) error {
	_, err := s.db.Collection("ai_sessions").ReplaceOne(ctx, bson.M{"_id": session.ID}, session, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) GetSession(ctx context.Context, id string) (domain.AISession, error) {
	return findOne[domain.AISession](ctx, s.db.Collection("ai_sessions"), bson.M{"_id": id, "expires_at": bson.M{"$gt": time.Now().UTC()}})
}

func (s *MongoStore) UserRoles(ctx context.Context, userID string) ([]string, error) {
	id, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return nil, ErrNotFound
	}
	var user struct {
		Roles  []string `bson:"roles"`
		Status string   `bson:"status"`
	}
	if err := s.db.Collection("users").FindOne(ctx, bson.M{"_id": id, "status": "active"}).Decode(&user); errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	return user.Roles, nil
}

func findOne[T any](ctx context.Context, collection *mongo.Collection, filter any) (T, error) {
	return findOneWithOptions[T](ctx, collection, filter)
}

func findOneWithOptions[T any](ctx context.Context, collection *mongo.Collection, filter any, opts ...options.Lister[options.FindOneOptions]) (T, error) {
	var value T
	if err := collection.FindOne(ctx, filter, opts...).Decode(&value); errors.Is(err, mongo.ErrNoDocuments) {
		return value, ErrNotFound
	} else if err != nil {
		return value, err
	}
	return value, nil
}

func findMany[T any](ctx context.Context, collection *mongo.Collection, filter any, opts ...options.Lister[options.FindOptions]) ([]T, error) {
	cursor, err := collection.Find(ctx, filter, opts...)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var values []T
	if err := cursor.All(ctx, &values); err != nil {
		return nil, err
	}
	if values == nil {
		values = []T{}
	}
	return values, nil
}
