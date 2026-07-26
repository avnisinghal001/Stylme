package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"stylme/go-backend/internal/config"
	"stylme/go-backend/internal/domain"
	"stylme/go-backend/internal/store"
)

func main() {
	apply := flag.Bool("apply", false, "write the managed inbound agents and swarm to MongoDB")
	flag.Parse()
	if !*apply {
		fail("refusing to change configuration without -apply")
	}

	cfg, err := config.Load()
	if err != nil {
		fail(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	data, err := store.New(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		fail(err.Error())
	}
	defer data.Close(context.Background())

	now := time.Now().UTC()
	updatedAgents := 0
	for _, desired := range domain.DefaultAgents(cfg.OpenAIModel) {
		if desired.Direction != "inbound" {
			continue
		}
		if existing, getErr := data.GetAgent(ctx, desired.ID); getErr == nil {
			desired.CreatedAt = existing.CreatedAt
			desired.CreatedBy = existing.CreatedBy
			desired.Revision = existing.Revision + 1
		} else if getErr != store.ErrNotFound {
			fail(fmt.Sprintf("load agent %s: %v", desired.ID, getErr))
		}
		desired.UpdatedAt = now
		desired.UpdatedBy = "configure-inbound-swarm-cli"
		if err := data.SaveAgent(ctx, desired); err != nil {
			fail(fmt.Sprintf("save agent %s: %v", desired.ID, err))
		}
		updatedAgents++
	}

	var desired domain.AgentSwarm
	for _, swarm := range domain.DefaultSwarms() {
		if swarm.ID == "swarm_default_inbound" {
			desired = swarm
			break
		}
	}
	if desired.ID == "" {
		fail("default inbound swarm is unavailable")
	}
	if err := domain.ValidateGraph(desired.Graph); err != nil {
		fail(fmt.Sprintf("default inbound graph is invalid: %v", err))
	}
	if existing, getErr := data.GetSwarm(ctx, desired.ID); getErr == nil {
		desired.Telephony = existing.Telephony
		if desired.Telephony.LiveKitAgentName == "" {
			desired.Telephony.LiveKitAgentName = "stylme-voice"
		}
		desired.CreatedAt = existing.CreatedAt
		desired.CreatedBy = existing.CreatedBy
		desired.Revision = existing.Revision + 1
	} else if getErr != store.ErrNotFound {
		fail(fmt.Sprintf("load inbound swarm: %v", getErr))
	}
	desired.UpdatedAt = now
	desired.UpdatedBy = "configure-inbound-swarm-cli"
	if err := data.SaveSwarm(ctx, desired); err != nil {
		fail(fmt.Sprintf("save inbound swarm: %v", err))
	}

	fmt.Printf("configured %d inbound agents and swarm %s revision %d; telephony binding preserved\n", updatedAgents, desired.ID, desired.Revision)
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
