package service

import (
	"testing"
	"time"

	"stylme/go-backend/internal/domain"
)

func TestSanitizePlanCanonicalizesGenderFromFilterContract(t *testing.T) {
	filters := map[string]any{
		"fields": []any{
			map[string]any{
				"key": "gender",
				"options": []any{
					map[string]any{"key": "women", "label": "Women"},
					map[string]any{"key": "men", "label": "Men"},
				},
			},
		},
	}
	plan := sanitizePlan(domain.SearchPlan{Gender: []string{"Women", "unknown"}}, filters)
	if len(plan.Gender) != 1 || plan.Gender[0] != "women" {
		t.Fatalf("expected canonical controlled gender, got %#v", plan.Gender)
	}
}

func TestCallingWindowInConfiguredTimezone(t *testing.T) {
	window := domain.CallingWindow{Timezone: "Asia/Kolkata", Start: "10:00", End: "19:00"}
	inside := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)   // 13:30 IST
	outside := time.Date(2026, 7, 19, 15, 0, 0, 0, time.UTC) // 20:30 IST
	if !withinCallingWindow(window, inside) {
		t.Fatal("expected instant inside the calling window")
	}
	if withinCallingWindow(window, outside) {
		t.Fatal("expected instant outside the calling window")
	}
	next := nextCallingWindow(window, outside)
	want := time.Date(2026, 7, 20, 4, 30, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("expected next window %s, got %s", want, next)
	}
}

func TestOvernightCallingWindow(t *testing.T) {
	window := domain.CallingWindow{Timezone: "Asia/Kolkata", Start: "22:00", End: "02:00"}
	inside := time.Date(2026, 7, 19, 18, 0, 0, 0, time.UTC) // 23:30 IST
	outside := time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
	if !withinCallingWindow(window, inside) || withinCallingWindow(window, outside) {
		t.Fatal("overnight window calculation is incorrect")
	}
}

func TestDirectCallAgentMustBelongToSwarm(t *testing.T) {
	swarm := domain.AgentSwarm{Graph: domain.SwarmGraph{
		EntryNodeKey: "stylist",
		Nodes:        []domain.SwarmNode{{Key: "stylist", AgentID: "agent-stylist"}},
	}}
	if got, err := directCallAgentID(swarm, ""); err != nil || got != "agent-stylist" {
		t.Fatalf("expected entry agent, got %q (%v)", got, err)
	}
	if _, err := directCallAgentID(swarm, "agent-other"); err == nil {
		t.Fatal("expected unrelated agent to be rejected")
	}
}

func TestValidateAgentToolsEnforcesCatalogCompatibility(t *testing.T) {
	base := domain.Agent{Channels: []string{"voice"}, Direction: "outbound"}
	base.Tools = []domain.ToolConfig{{Key: "record_opt_out", Enabled: true}}
	if err := validateAgentTools(base); err != nil {
		t.Fatalf("expected outbound opt-out tool to be valid: %v", err)
	}

	base.Tools = []domain.ToolConfig{{Key: "lookup_order", Enabled: true}, {Key: "lookup_order", Enabled: true}}
	if err := validateAgentTools(base); err == nil {
		t.Fatal("expected duplicate tool validation error")
	}

	base.Tools = []domain.ToolConfig{{Key: "propose_profile_update", Enabled: true}}
	if err := validateAgentTools(base); err == nil {
		t.Fatal("expected web-only tool to be rejected on voice")
	}

	base.Tools = []domain.ToolConfig{{Key: "send_recovery_link", Enabled: true}}
	if err := validateAgentTools(base); err == nil {
		t.Fatal("expected unavailable tool to be rejected")
	}

	web := domain.Agent{Channels: []string{"web"}, Direction: "interactive"}
	if err := validateAgentTools(web); err == nil {
		t.Fatal("expected web agent without catalogue search to be rejected")
	}
	web.Tools = []domain.ToolConfig{{Key: "search_catalog", Enabled: true}}
	if err := validateAgentTools(web); err != nil {
		t.Fatalf("expected web catalogue tool to be valid: %v", err)
	}
}

func TestValidateCaptureContractRejectsDuplicateAndUnsupportedFields(t *testing.T) {
	valid := domain.CaptureConfig{Fields: []domain.CaptureField{{Key: "outcome", Label: "Outcome", Type: "select", Enum: []string{"resolved", "escalated"}}}}
	if err := validateCaptureContract(valid); err != nil {
		t.Fatalf("expected valid capture contract: %v", err)
	}
	if err := validateCaptureContract(domain.CaptureConfig{Fields: []domain.CaptureField{{Key: "outcome", Label: "Outcome", Type: "object"}}}); err == nil {
		t.Fatal("expected unsupported field type to be rejected")
	}
	if err := validateCaptureContract(domain.CaptureConfig{Fields: []domain.CaptureField{{Key: "note", Label: "Note", Type: "string"}, {Key: "note", Label: "Duplicate", Type: "string"}}}); err == nil {
		t.Fatal("expected duplicate capture key to be rejected")
	}
}
