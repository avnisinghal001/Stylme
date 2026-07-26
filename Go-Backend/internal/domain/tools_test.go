package domain

import "testing"

func TestAgentToolCatalogHasUniqueKeysAndHonestAvailability(t *testing.T) {
	seen := map[string]bool{}
	for _, tool := range AgentToolCatalog() {
		if tool.Key == "" || tool.Name == "" || tool.Group == "" || len(tool.Channels) == 0 {
			t.Fatalf("incomplete tool definition: %#v", tool)
		}
		if seen[tool.Key] {
			t.Fatalf("duplicate tool key %q", tool.Key)
		}
		seen[tool.Key] = true
		if tool.Availability == "unavailable" && tool.Assignable {
			t.Fatalf("unavailable tool %q cannot be assignable", tool.Key)
		}
	}
	for _, key := range []string{"search_catalog", "handoff", "record_opt_out", "capture_call_field", "send_recovery_link"} {
		if !seen[key] {
			t.Fatalf("missing runtime tool %q", key)
		}
	}
}

func TestValidateGraphRejectsUnreachableAndDuplicateRoutes(t *testing.T) {
	nodes := []SwarmNode{{Key: "entry", AgentID: "a"}, {Key: "other", AgentID: "b"}}
	if err := ValidateGraph(SwarmGraph{EntryNodeKey: "entry", Nodes: nodes}); err == nil {
		t.Fatal("expected unreachable node validation error")
	}
	edge := SwarmEdge{From: "entry", To: "other", Condition: TransitionCondition{Field: "intent", Operator: "exists"}}
	if err := ValidateGraph(SwarmGraph{EntryNodeKey: "entry", Nodes: nodes, Edges: []SwarmEdge{edge, edge}}); err == nil {
		t.Fatal("expected duplicate edge validation error")
	}
}
