package livekit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"stylme/go-backend/internal/domain"

	lkproto "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

type Gateway interface {
	DispatchOutbound(context.Context, domain.Call, domain.AgentSwarm) (string, error)
}

type DisabledGateway struct{}

func (DisabledGateway) DispatchOutbound(context.Context, domain.Call, domain.AgentSwarm) (string, error) {
	return "", errors.New("LiveKit is not configured")
}

type SIPGateway struct {
	sip      *lksdk.SIPClient
	dispatch *lksdk.AgentDispatchClient
}

func New(url, key, secret string) Gateway {
	if url == "" || key == "" || secret == "" {
		return DisabledGateway{}
	}
	return &SIPGateway{sip: lksdk.NewSIPClient(url, key, secret), dispatch: lksdk.NewAgentDispatchServiceClient(url, key, secret)}
}

func (g *SIPGateway) DispatchOutbound(ctx context.Context, call domain.Call, swarm domain.AgentSwarm) (string, error) {
	if swarm.Telephony.OutboundTrunkID == "" {
		return "", errors.New("swarm has no outbound trunk")
	}
	if call.From == "" || call.To == "" {
		return "", errors.New("call requires E.164 from and to numbers")
	}
	room := fmt.Sprintf("stylme__%s__%s", swarm.ID, call.ID)
	metadata, _ := json.Marshal(map[string]any{"callId": call.ID, "swarmId": swarm.ID, "direction": "outbound"})
	agentName := swarm.Telephony.LiveKitAgentName
	if agentName == "" {
		agentName = "stylme-voice"
	}
	if _, err := g.dispatch.CreateDispatch(ctx, &lkproto.CreateAgentDispatchRequest{Room: room, AgentName: agentName, Metadata: string(metadata)}); err != nil {
		return "", fmt.Errorf("dispatch voice agent: %w", err)
	}
	if _, err := g.sip.CreateSIPParticipant(ctx, &lkproto.CreateSIPParticipantRequest{
		SipTrunkId: swarm.Telephony.OutboundTrunkID, SipCallTo: call.To, SipNumber: call.From,
		RoomName: room, ParticipantIdentity: "customer-" + call.ID, ParticipantName: "StylMe customer", ParticipantMetadata: string(metadata),
	}); err != nil {
		return "", fmt.Errorf("create SIP participant: %w", err)
	}
	return room, nil
}
