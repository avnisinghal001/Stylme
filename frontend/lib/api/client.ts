import type { AppearanceProposal, AuthSession, AuthUser, CustomerCart, CustomerOrder, CustomerProfile, SellerApplicationInput, SellerSummary } from '@/types/auth';
import { getPublicApiBaseUrl } from '@/lib/api/public-endpoints';

export const ACCESS_TOKEN_KEY = 'stylme.access_token';

export const API_BASE_URL = getPublicApiBaseUrl();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { detail?: unknown; message?: unknown; error?: unknown };
  for (const candidate of [value.detail, value.message, value.error]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (candidate && typeof candidate === 'object') {
      const detail = candidate as { message?: unknown; fields?: unknown };
      if (typeof detail.message === 'string' && detail.message.trim()) {
        const fields = Array.isArray(detail.fields) ? `: ${detail.fields.join(', ')}` : '';
        return `${detail.message}${fields}`;
      }
    }
  }
  return fallback;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token = getAccessToken(), headers, ...requestInit } = init;
  const requestHeaders = new Headers(headers);
  if (requestInit.body && !(requestInit.body instanceof FormData) && !requestHeaders.has('content-type')) {
    requestHeaders.set('content-type', 'application/json');
  }
  if (token) requestHeaders.set('authorization', `Bearer ${token}`);

  const response = await fetch(`${getPublicApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`, {
    ...requestInit,
    headers: requestHeaders,
    cache: requestInit.cache ?? 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(readMessage(payload, `Request failed (${response.status}).`), response.status, payload);
  }
  return payload as T;
}

export function login(email: string, password: string): Promise<AuthSession> {
  return apiRequest<AuthSession>('/auth/login', {
    method: 'POST',
    token: null,
    body: JSON.stringify({ email, password }),
  });
}

export function registerCustomer(fullName: string, email: string, phone: string, password: string): Promise<AuthSession> {
  return apiRequest<AuthSession>('/auth/register', {
    method: 'POST', token: null, body: JSON.stringify({ fullName, email, phone, password }),
  });
}

export function getCurrentUser(token?: string): Promise<AuthUser> {
  return apiRequest<AuthUser>('/auth/me', { token });
}

export function getCustomerProfile(): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/profile');
}

export type CustomerProfileInput = {
  fullName?: string;
  phone?: string;
  dateOfBirth?: string;
  heightCm?: number | null;
  weightKg?: number | null;
  bodyProfileConsent?: boolean;
  styleKeys?: string[];
  sizeKeys?: string[];
  generationKeys?: string[];
  genderKeys?: string[];
  aestheticKeys?: string[];
  occasionKeys?: string[];
  festivalKeys?: string[];
  personalizationSegmentKeys?: string[];
  metadata?: Record<string, unknown>;
};

export function updateCustomerProfile(input: CustomerProfileInput): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/profile', { method: 'PATCH', body: JSON.stringify(input) });
}

export function completeCustomerOnboarding(input: CustomerProfileInput): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/profile/onboarding/complete', { method: 'POST', body: JSON.stringify(input) });
}

export type AppearanceReservation = {
  runId: string;
  status: 'reserved' | 'completed' | 'failed';
  shouldProcess: boolean;
  proposal?: AppearanceProposal;
  provider?: string;
  model?: string;
};

export function reserveAppearance(input: {
  consent: true;
  inputHash: string;
  contractVersion: number;
  metadataSchemaVersion: number;
  allowedFiltersHash: string;
  imageHashes: string[];
}): Promise<AppearanceReservation> {
  return apiRequest('/profile/appearance/reserve', { method: 'POST', body: JSON.stringify(input) });
}

export function completeAppearance(runId: string, input: {
  provider: string;
  model: string;
  proposal: AppearanceProposal;
  confidence: number;
  warnings: string[];
}): Promise<AppearanceReservation> {
  return apiRequest(`/profile/appearance/${encodeURIComponent(runId)}/complete`, { method: 'POST', body: JSON.stringify(input) });
}

export function failAppearance(runId: string, error: unknown): Promise<AppearanceReservation> {
  return apiRequest(`/profile/appearance/${encodeURIComponent(runId)}/fail`, {
    method: 'POST',
    body: JSON.stringify({ errorCode: 'client_appearance_generation_failed', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Appearance processing failed.' }),
  });
}

export async function listCustomerOrders(): Promise<{ items: CustomerOrder[]; total: number }> {
  return apiRequest('/orders');
}

export function getCustomerCart(): Promise<CustomerCart> { return apiRequest('/cart'); }
export function addCustomerCartItem(offerId: string, variantId: string, quantity = 1): Promise<CustomerCart> {
  return apiRequest('/cart/items', { method: 'POST', body: JSON.stringify({ offerId, variantId, quantity }) });
}
export function setCustomerCartQuantity(offerId: string, variantId: string, quantity: number): Promise<CustomerCart> {
  return apiRequest(`/cart/items/${encodeURIComponent(offerId)}/${encodeURIComponent(variantId)}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });
}
export function removeCustomerCartItem(offerId: string, variantId: string): Promise<CustomerCart> {
  return apiRequest(`/cart/items/${encodeURIComponent(offerId)}/${encodeURIComponent(variantId)}`, { method: 'DELETE' });
}

export function applyAsSeller(input: SellerApplicationInput): Promise<{ user: AuthUser; sellerStatus: string }> {
  return apiRequest<{
    user: AuthUser;
    seller: { status: string };
  }>('/seller/application', {
    method: 'POST',
    token: null,
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      fullName: input.fullName,
      displayName: input.displayName,
      brandName: input.brandName,
      contact: input.phone?.trim() ? { phone: input.phone.trim() } : {},
      primaryLocation: {
        name: `${input.displayName.trim()} primary location`,
        addressLine: input.addressLine,
        pincode: input.pincode,
      },
    }),
  }).then((response) => ({
    user: response.user,
    sellerStatus: response.user.sellerStatus ?? response.seller.status,
  }));
}

export async function listSellers(status?: string): Promise<{ items: SellerSummary[]; total: number }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await apiRequest<{
    items: Array<{
      id: string;
      userId: string;
      displayName: string;
      status: SellerSummary['status'];
      rejectionReason?: string | null;
      createdAt?: string | null;
      user?: { email?: string; fullName?: string } | null;
      locations?: unknown[];
      brands?: unknown[];
    }>;
    total: number;
  }>(`/admin/sellers${query}`);
  return {
    total: response.total,
    items: response.items.map((seller) => ({
      id: seller.id,
      userId: seller.userId,
      email: seller.user?.email ?? '',
      fullName: seller.user?.fullName ?? '',
      displayName: seller.displayName,
      status: seller.status,
      rejectionReason: seller.rejectionReason,
      createdAt: seller.createdAt,
      locations: seller.locations?.length ?? 0,
      brands: seller.brands?.length ?? 0,
    })),
  };
}

export function decideSeller(
  sellerId: string,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<SellerSummary> {
  return apiRequest(`/admin/sellers/${encodeURIComponent(sellerId)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, reason: reason?.trim() || null }),
  });
}
