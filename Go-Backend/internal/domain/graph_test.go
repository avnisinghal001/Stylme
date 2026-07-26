package domain

import "testing"

func TestValidateGraphAcceptsSingleNodeAndDAG(t *testing.T) {
	agentA := "agent-a"
	agentB := "agent-b"
	for _, graph := range []SwarmGraph{
		{EntryNodeKey: "stylist", Nodes: []SwarmNode{{Key: "stylist", AgentID: agentA}}},
		{
			EntryNodeKey: "triage",
			Nodes:        []SwarmNode{{Key: "triage", AgentID: agentA}, {Key: "orders", AgentID: agentB}},
			Edges:        []SwarmEdge{{From: "triage", To: "orders", Priority: 10, Condition: TransitionCondition{Field: "intent", Operator: "eq", Value: "order_help"}}},
		},
	} {
		if err := ValidateGraph(graph); err != nil {
			t.Fatalf("expected valid graph, got %v", err)
		}
	}
}

func TestValidateGraphRejectsCyclesAndUnknownNodes(t *testing.T) {
	base := []SwarmNode{{Key: "a", AgentID: "agent-a"}, {Key: "b", AgentID: "agent-b"}}
	cases := []SwarmGraph{
		{EntryNodeKey: "missing", Nodes: base},
		{EntryNodeKey: "a", Nodes: base, Edges: []SwarmEdge{{From: "a", To: "missing"}}},
		{EntryNodeKey: "a", Nodes: base, Edges: []SwarmEdge{{From: "a", To: "b"}, {From: "b", To: "a"}}},
	}
	for _, graph := range cases {
		if err := ValidateGraph(graph); err == nil {
			t.Fatal("expected graph validation error")
		}
	}
}
