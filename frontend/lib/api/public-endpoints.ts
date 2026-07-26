const LOCAL_FASTAPI = "http://localhost:8000/api/v1";
const PRODUCTION_FASTAPI = "https://stylme-swoopstyl-api.vercel.app/api/v1";
const LOCAL_AI_CONTROL_PLANE = "http://localhost:8081/v1";
const PRODUCTION_AI_CONTROL_PLANE = "https://stylme-ai-control-plane.vercel.app/v1";

function normalized(value: string | undefined) {
  return value?.trim().replace(/\/$/, "") ?? "";
}

function pointsToLocalhost(value: string) {
  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function browserIsLocal() {
  if (typeof window === "undefined") return process.env.NODE_ENV !== "production";
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function publicEndpoint(configured: string, localFallback: string, productionFallback: string) {
  if (!browserIsLocal() && (!configured || pointsToLocalhost(configured))) {
    return productionFallback;
  }
  return configured || (browserIsLocal() ? localFallback : productionFallback);
}

/**
 * Resolve public browser endpoints at call time. A production browser must
 * never inherit a localhost URL from a developer build or root .env file.
 */
export function getPublicApiBaseUrl() {
  // Production browsers use the storefront's external rewrite. The fetch is
  // still initiated and rendered client-side, while same-origin delivery
  // avoids CDN/CORS cache variants dropping access-control headers.
  if (typeof window !== "undefined" && !browserIsLocal()) return "/api/v1";
  return publicEndpoint(
    normalized(process.env.NEXT_PUBLIC_API_BASE_URL),
    LOCAL_FASTAPI,
    PRODUCTION_FASTAPI,
  );
}

export function getPublicAiApiBaseUrl() {
  return publicEndpoint(
    normalized(process.env.NEXT_PUBLIC_AI_API_BASE_URL),
    LOCAL_AI_CONTROL_PLANE,
    PRODUCTION_AI_CONTROL_PLANE,
  );
}
