package domain

import (
	"strings"
	"testing"
)

func TestDefaultAgentsAreSafeAndConfigurable(t *testing.T) {
	agents := DefaultAgents("gpt-5.6-luna")
	if len(agents) < 3 {
		t.Fatalf("expected web, inbound, and outbound defaults; got %d", len(agents))
	}
	seen := map[string]bool{}
	for _, agent := range agents {
		if agent.Key == "" || agent.Instructions.System == "" || agent.Model.Name == "" {
			t.Fatalf("default is incomplete: %#v", agent)
		}
		if len(agent.Capture.Fields) == 0 {
			t.Fatalf("agent %s needs an explicit capture contract", agent.Key)
		}
		seen[agent.Key] = true
	}
	for _, key := range []string{"stylme-web-stylist", "stylme-inbound-concierge", "stylme-outbound-stylist"} {
		if !seen[key] {
			t.Fatalf("missing %s default", key)
		}
	}
}

func TestDefaultInboundSwarmUsesOneFastRouterBeforeSpecialists(t *testing.T) {
	agents := DefaultAgents("gpt-5.6-luna")
	agentIDs := make(map[string]Agent, len(agents))
	for _, agent := range agents {
		agentIDs[agent.ID] = agent
	}

	var inbound AgentSwarm
	for _, swarm := range DefaultSwarms() {
		if swarm.ID == "swarm_default_inbound" {
			inbound = swarm
			break
		}
	}
	if inbound.ID == "" {
		t.Fatal("missing default inbound swarm")
	}
	if err := ValidateGraph(inbound.Graph); err != nil {
		t.Fatalf("default inbound graph is invalid: %v", err)
	}
	if inbound.Graph.EntryNodeKey != "router" {
		t.Fatalf("expected fast router entry, got %q", inbound.Graph.EntryNodeKey)
	}
	if inbound.Telephony.LiveKitAgentName != "stylme-voice" {
		t.Fatalf("expected managed LiveKit worker binding, got %q", inbound.Telephony.LiveKitAgentName)
	}

	wantNodes := map[string]string{
		"router":      "agent_default_inbound_concierge",
		"shopping":    "agent_inbound_shopping",
		"orders":      "agent_inbound_orders",
		"after_sales": "agent_inbound_after_sales",
		"general":     "agent_inbound_general",
		"human":       "agent_inbound_human_handoff",
	}
	if len(inbound.Graph.Nodes) != len(wantNodes) {
		t.Fatalf("expected %d inbound nodes, got %d", len(wantNodes), len(inbound.Graph.Nodes))
	}
	for _, node := range inbound.Graph.Nodes {
		if wantNodes[node.Key] != node.AgentID {
			t.Fatalf("unexpected inbound node mapping %s -> %s", node.Key, node.AgentID)
		}
		if _, ok := agentIDs[node.AgentID]; !ok {
			t.Fatalf("node %s references missing agent %s", node.Key, node.AgentID)
		}
	}

	wantRoutes := map[string]string{
		"router:shopping":    "shopping",
		"router:orders":      "orders",
		"router:after_sales": "after_sales",
		"router:general":     "general",
		"router:human":       "human",
		"shopping:human":     "human",
		"orders:human":       "human",
		"after_sales:human":  "human",
		"general:human":      "human",
	}
	if len(inbound.Graph.Edges) != len(wantRoutes) {
		t.Fatalf("expected %d inbound handoffs, got %d", len(wantRoutes), len(inbound.Graph.Edges))
	}
	for _, edge := range inbound.Graph.Edges {
		key := edge.From + ":" + edge.To
		if edge.Condition.Field != "handoff_route" || edge.Condition.Operator != "eq" || edge.Condition.Value != wantRoutes[key] {
			t.Fatalf("unsafe or unexpected route %#v", edge)
		}
	}
	if inbound.Telephony.HumanHandoffNumber != "+918126679138" {
		t.Fatalf("unexpected default human handoff number %q", inbound.Telephony.HumanHandoffNumber)
	}

	router := agentIDs["agent_default_inbound_concierge"]
	if router.Name != "StylMe Fast Care Router" {
		t.Fatalf("unexpected router name %q", router.Name)
	}
	human := agentIDs["agent_inbound_human_handoff"]
	warmTransferEnabled := false
	for _, tool := range human.Tools {
		if tool.Key == "warm_transfer" && tool.Enabled {
			warmTransferEnabled = true
		}
	}
	if !warmTransferEnabled {
		t.Fatal("human handoff agent must enable warm transfer")
	}
}

func TestEveryInboundAgentBlocksPaymentSecrets(t *testing.T) {
	for _, agent := range DefaultAgents("gpt-5.6-luna") {
		if agent.Direction != "inbound" {
			continue
		}
		guardrails := strings.ToLower(strings.Join(agent.Instructions.Guardrails, " "))
		for _, secret := range []string{"card number", "cvv", "otp", "upi pin", "banking password"} {
			if !strings.Contains(guardrails, secret) {
				t.Fatalf("agent %s does not explicitly block %s", agent.Key, secret)
			}
		}
	}
}
