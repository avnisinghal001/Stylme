package service

import (
	"testing"

	"stylme/go-backend/internal/domain"
)

func TestManagedTelephonyCannotBeOverwrittenByAdminPayload(t *testing.T) {
	stored := domain.TelephonyBinding{
		PhoneNumber:        "+19388004249",
		HumanHandoffNumber: "+918111111111",
		InboundTrunkID:     "ST_inbound",
		OutboundTrunkID:    "ST_outbound",
		DispatchRuleID:     "SDR_dispatch",
		LiveKitAgentName:   "stylme-voice",
	}
	malicious := domain.TelephonyBinding{
		PhoneNumber:        "+10000000000",
		HumanHandoffNumber: "8126679138",
		InboundTrunkID:     "attacker-inbound",
		OutboundTrunkID:    "attacker-outbound",
		DispatchRuleID:     "attacker-dispatch",
		LiveKitAgentName:   "attacker-worker",
	}

	got := preserveManagedTelephony(malicious, stored)
	if got.PhoneNumber != stored.PhoneNumber || got.InboundTrunkID != stored.InboundTrunkID || got.OutboundTrunkID != stored.OutboundTrunkID || got.DispatchRuleID != stored.DispatchRuleID || got.LiveKitAgentName != stored.LiveKitAgentName {
		t.Fatalf("admin payload replaced managed infrastructure: got %#v", got)
	}
	if got.HumanHandoffNumber != "+918126679138" {
		t.Fatalf("editable human handoff number was not normalized: %q", got.HumanHandoffNumber)
	}
}

func TestNormalizeHumanHandoffNumber(t *testing.T) {
	tests := map[string]string{
		"8126679138":        "+918126679138",
		"+91 81266 79138":   "+918126679138",
		"+1 (510) 555-0123": "+15105550123",
		"":                  "",
	}
	for input, want := range tests {
		got, err := normalizeHumanHandoffNumber(input)
		if err != nil || got != want {
			t.Fatalf("normalize %q: got %q, %v; want %q", input, got, err, want)
		}
	}
	if _, err := normalizeHumanHandoffNumber("12345"); err == nil {
		t.Fatal("expected an invalid handoff number to be rejected")
	}
}

func TestCampaignCallerIDAlwaysComesFromManagedSwarm(t *testing.T) {
	if got := managedCampaignFromNumber("+10000000000", "+19388004249"); got != "+19388004249" {
		t.Fatalf("campaign accepted browser caller ID %q", got)
	}
}
