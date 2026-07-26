package domain

// ToolDefinition is the control-plane contract for every capability that may
// appear in Agent Studio. Keeping it server-owned prevents the UI from
// advertising keys the runtime cannot execute.
type ToolDefinition struct {
	Key          string   `json:"key"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Group        string   `json:"group"`
	Channels     []string `json:"channels"`
	Directions   []string `json:"directions"`
	Availability string   `json:"availability"`
	Assignable   bool     `json:"assignable"`
	RiskLevel    string   `json:"riskLevel"`
	Runtime      string   `json:"runtime"`
	Requirements []string `json:"requirements"`
}

func AgentToolCatalog() []ToolDefinition {
	return []ToolDefinition{
		{Key: "search_catalog", Name: "Search catalogue", Description: "Search real StylMe products before stating price, stock, fit, or delivery facts.", Group: "Discovery", Channels: []string{"web", "voice"}, Directions: []string{"interactive", "inbound", "outbound"}, Availability: "ready", Assignable: true, RiskLevel: "read", Runtime: "control-plane"},
		{Key: "lookup_order", Name: "Verify order", Description: "Verify an order using its number and the account phone's last four digits.", Group: "Commerce", Channels: []string{"voice"}, Directions: []string{"inbound", "outbound"}, Availability: "ready", Assignable: true, RiskLevel: "read", Runtime: "voice-worker"},
		{Key: "propose_profile_update", Name: "Propose profile update", Description: "Propose a durable preference change without silently committing it.", Group: "Personalization", Channels: []string{"web"}, Directions: []string{"interactive"}, Availability: "ready", Assignable: true, RiskLevel: "write-with-confirmation", Runtime: "web-control-plane"},
		{Key: "handoff", Name: "Agent handoff", Description: "Move a live conversation through a matching outgoing swarm edge.", Group: "Orchestration", Channels: []string{"voice"}, Directions: []string{"inbound", "outbound"}, Availability: "ready", Assignable: true, RiskLevel: "workflow", Runtime: "voice-worker", Requirements: []string{"The node needs at least one outgoing handoff edge."}},
		{Key: "warm_transfer", Name: "Warm transfer to human", Description: "Call the configured support number, brief the human, and join them to the caller's room.", Group: "Orchestration", Channels: []string{"voice"}, Directions: []string{"inbound", "outbound"}, Availability: "setup_required", Assignable: true, RiskLevel: "external-action", Runtime: "voice-worker", Requirements: []string{"A human handoff number and managed outbound SIP trunk must be configured on the swarm."}},
		{Key: "capture_callback", Name: "Capture callback", Description: "Record an explicitly confirmed callback request in the final disposition.", Group: "Lifecycle", Channels: []string{"voice"}, Directions: []string{"inbound", "outbound"}, Availability: "ready", Assignable: true, RiskLevel: "write-with-confirmation", Runtime: "voice-worker"},
		{Key: "record_opt_out", Name: "Record opt-out", Description: "Persist an explicit do-not-call request in the call disposition.", Group: "Safety", Channels: []string{"voice"}, Directions: []string{"outbound"}, Availability: "ready", Assignable: true, RiskLevel: "write-with-confirmation", Runtime: "voice-worker"},
		{Key: "end_call", Name: "End call", Description: "End the room after a clear goodbye, opt-out, or terminal workflow state.", Group: "Lifecycle", Channels: []string{"voice"}, Directions: []string{"inbound", "outbound"}, Availability: "ready", Assignable: true, RiskLevel: "external-action", Runtime: "voice-worker"},
		{Key: "capture_call_field", Name: "Capture disposition field", Description: "Capture explicit answers allowed by the current agent's disposition contract.", Group: "System", Channels: []string{"voice"}, Directions: []string{"inbound", "outbound"}, Availability: "always_on", Assignable: false, RiskLevel: "system", Runtime: "voice-worker", Requirements: []string{"Automatically included for every voice node."}},
		{Key: "send_recovery_link", Name: "Send recovery link", Description: "Send a secure checkout recovery link after explicit consent.", Group: "Commerce", Channels: []string{"voice"}, Directions: []string{"outbound"}, Availability: "unavailable", Assignable: false, RiskLevel: "external-action", Runtime: "not-connected", Requirements: []string{"A transactional messaging provider and auditable consent delivery path are not connected yet."}},
	}
}

func AgentToolDefinition(key string) (ToolDefinition, bool) {
	for _, definition := range AgentToolCatalog() {
		if definition.Key == key {
			return definition, true
		}
	}
	return ToolDefinition{}, false
}
