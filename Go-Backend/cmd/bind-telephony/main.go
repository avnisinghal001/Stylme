package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"stylme/go-backend/internal/config"
	"stylme/go-backend/internal/store"
)

func main() {
	inboundID := flag.String("inbound", "", "LiveKit inbound SIP trunk ID")
	outboundID := flag.String("outbound", "", "LiveKit outbound SIP trunk ID")
	dispatchID := flag.String("dispatch", "", "LiveKit inbound dispatch rule ID")
	phone := flag.String("phone", "", "Shared E.164 phone number; defaults to TWILIO_PHONE_NUMBER")
	agentName := flag.String("agent", "stylme-voice", "LiveKit agent name")
	flag.Parse()

	if *inboundID == "" || *outboundID == "" || *dispatchID == "" {
		fail("-inbound, -outbound, and -dispatch are required")
	}
	cfg, err := config.Load()
	if err != nil {
		fail(err.Error())
	}
	if *phone == "" {
		*phone = strings.TrimSpace(os.Getenv("TWILIO_PHONE_NUMBER"))
	}
	if !strings.HasPrefix(*phone, "+") {
		fail("phone must be configured in E.164 format")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	data, err := store.New(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		fail(err.Error())
	}
	defer data.Close(context.Background())
	now := time.Now().UTC()
	for _, swarmID := range []string{"swarm_default_inbound", "swarm_default_outbound"} {
		swarm, getErr := data.GetSwarm(ctx, swarmID)
		if getErr != nil {
			fail(fmt.Sprintf("load %s: %v", swarmID, getErr))
		}
		swarm.Telephony.PhoneNumber = *phone
		swarm.Telephony.InboundTrunkID = *inboundID
		swarm.Telephony.OutboundTrunkID = *outboundID
		swarm.Telephony.DispatchRuleID = *dispatchID
		swarm.Telephony.LiveKitAgentName = *agentName
		swarm.Revision++
		swarm.UpdatedAt = now
		swarm.UpdatedBy = "bind-telephony-cli"
		if saveErr := data.SaveSwarm(ctx, swarm); saveErr != nil {
			fail(fmt.Sprintf("save %s: %v", swarmID, saveErr))
		}
	}
	campaign, err := data.GetCampaign(ctx, "campaign_default_checkout_recovery")
	if err == nil {
		campaign.FromNumber = *phone
		campaign.SwarmID = "swarm_default_outbound"
		campaign.EntryNodeKey = "stylist"
		campaign.UpdatedAt = now
		if saveErr := data.SaveCampaign(ctx, campaign); saveErr != nil {
			fail(fmt.Sprintf("save checkout recovery campaign: %v", saveErr))
		}
	}
	fmt.Println("bound shared telephony resources to default swarms and checkout recovery campaign")
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
