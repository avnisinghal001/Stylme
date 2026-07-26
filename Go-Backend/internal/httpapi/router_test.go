package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stylme/go-backend/internal/domain"
	"stylme/go-backend/internal/service"
)

func TestSarvamVoiceCatalogHandlerReturnsAllCurrentVoices(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/voices/sarvam", nil)
	response := httptest.NewRecorder()

	(&Handler{}).listSarvamVoices(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	if body := response.Body.String(); !containsAll(body, `"model":"bulbul:v3"`, `"id":"shubh"`, `"id":"anand"`, `"id":"soham"`) {
		t.Fatalf("catalog response is incomplete: %s", body)
	}
}

func TestToolCatalogHandlerReturnsRuntimeCapabilities(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/tools", nil)
	response := httptest.NewRecorder()

	(&Handler{}).listTools(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	if body := response.Body.String(); !containsAll(body, `"key":"search_catalog"`, `"key":"record_opt_out"`, `"availability":"always_on"`, `"availability":"unavailable"`) {
		t.Fatalf("catalog response is incomplete: %s", body)
	}
}

func TestSarvamPreviewStatusDoesNotExposeCredentialFailuresAsValidation(t *testing.T) {
	if got := sarvamPreviewStatus(service.ErrSarvamCredentialMissing); got != http.StatusServiceUnavailable {
		t.Fatalf("expected missing credential to map to 503, got %d", got)
	}
	if got := sarvamPreviewStatus(&service.SarvamUpstreamError{StatusCode: 429}); got != http.StatusTooManyRequests {
		t.Fatalf("expected provider rate limit to map to 429, got %d", got)
	}
	if got := sarvamPreviewStatus(&service.SarvamValidationError{Message: "bad preview input"}); got != http.StatusUnprocessableEntity {
		t.Fatalf("expected validation failure to map to 422, got %d", got)
	}
	if got := sarvamPreviewStatus(errors.New("database unavailable")); got != http.StatusInternalServerError {
		t.Fatalf("expected unexpected failure to map to 500, got %d", got)
	}
}

func containsAll(value string, needles ...string) bool {
	for _, needle := range needles {
		if !strings.Contains(value, needle) {
			return false
		}
	}
	return true
}

func TestCORSAllowsProductionStorefront(t *testing.T) {
	h := &Handler{corsOrigins: map[string]bool{"https://fitstylme.vercel.app": true}}
	request := httptest.NewRequest(http.MethodOptions, "/v1/web/sessions", nil)
	request.Header.Set("Origin", "https://fitstylme.vercel.app")
	response := httptest.NewRecorder()

	h.cors(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("preflight must not reach the route handler")
	})).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", response.Code)
	}
	if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != "https://fitstylme.vercel.app" {
		t.Fatalf("unexpected allow origin %q", origin)
	}
	if headers := response.Header().Get("Access-Control-Allow-Headers"); headers == "" {
		t.Fatal("expected allowed request headers")
	}
}

func TestAdminSwarmViewRedactsManagedTelephonyIdentifiers(t *testing.T) {
	swarm := domain.AgentSwarm{Telephony: domain.TelephonyBinding{
		PhoneNumber:        "+19388004249",
		HumanHandoffNumber: "+918126679138",
		InboundTrunkID:     "ST_inbound",
		OutboundTrunkID:    "ST_outbound",
		DispatchRuleID:     "SDR_dispatch",
		LiveKitAgentName:   "stylme-voice",
	}}

	redacted := redactManagedTelephony(swarm)
	if redacted.Telephony.PhoneNumber != "+19388004249" {
		t.Fatalf("phone number must remain visible, got %q", redacted.Telephony.PhoneNumber)
	}
	if redacted.Telephony.HumanHandoffNumber != "+918126679138" {
		t.Fatalf("human handoff number must remain admin-visible, got %q", redacted.Telephony.HumanHandoffNumber)
	}
	if redacted.Telephony.InboundTrunkID != "" || redacted.Telephony.OutboundTrunkID != "" || redacted.Telephony.DispatchRuleID != "" || redacted.Telephony.LiveKitAgentName != "" {
		t.Fatalf("managed infrastructure leaked to admin response: %#v", redacted.Telephony)
	}
	if swarm.Telephony.InboundTrunkID == "" {
		t.Fatal("redaction must not mutate the stored swarm")
	}
}

func TestAdminTestCallCannotOverrideManagedCallerID(t *testing.T) {
	if got := callerIDForRequest("owner-user", "+10000000000"); got != "" {
		t.Fatalf("admin caller ID override was retained: %q", got)
	}
	if got := callerIDForRequest("", "+19388004249"); got != "+19388004249" {
		t.Fatalf("internal caller ID was unexpectedly removed: %q", got)
	}
}

func TestCORSDoesNotAllowUnknownOrigin(t *testing.T) {
	h := &Handler{corsOrigins: map[string]bool{"https://fitstylme.vercel.app": true}}
	request := httptest.NewRequest(http.MethodGet, "/v1/public/ai/config", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	response := httptest.NewRecorder()

	h.cors(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(response, request)

	if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != "" {
		t.Fatalf("unknown origin must not be allowed, got %q", origin)
	}
}
