export type AppRole = 'customer' | 'seller' | 'admin' | 'owner';

export type SellerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  roles: AppRole[];
  status: string;
  onboardingCompleted: boolean;
  genderKeys: string[];
  defaultPincode?: string | null;
  profileSignals: {
    age?: number | null;
    heightCm?: number | null;
    weightKg?: number | null;
  };
  sellerStatus?: SellerStatus | null;
}

export interface CustomerProfile {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  roles: AppRole[];
  onboardingCompleted: boolean;
  defaultPincode?: string | null;
  addresses: Array<Record<string, unknown>>;
  preferences: {
    styleKeys?: string[];
    sizeKeys?: string[];
    generationKeys?: string[];
    genderKeys?: string[];
    aestheticKeys?: string[];
    occasionKeys?: string[];
    festivalKeys?: string[];
    personalizationSegmentKeys?: string[];
  };
  bodyProfile: {
    dateOfBirth?: string | null;
    age?: number | null;
    heightCm?: number | null;
    weightKg?: number | null;
    consent: boolean;
  };
  appearanceProfile?: AppearanceProposal & { confidence?: number; reviewRequired?: boolean; runId?: string } | null;
  metadata: Record<string, unknown>;
}

export interface AppearanceProposal {
  skinTone: 'very-light' | 'light' | 'medium' | 'tan' | 'deep' | 'unknown';
  undertone: 'cool' | 'warm' | 'neutral' | 'olive' | 'unknown';
  recommendedColorFamilyKeys: string[];
  styleKeys: string[];
  fitKeys: string[];
  silhouetteKeys: string[];
  contrastLevel: 'low' | 'medium' | 'high' | 'unknown';
  notes: string[];
  actions: Array<{ field: 'recommended_color_family' | 'style' | 'fit' | 'silhouette'; action: 'reuse'; values: string[] }>;
}

export interface CustomerOrder {
  id: string;
  orderNumber?: string;
  status: string;
  currency: string;
  items: Array<Record<string, unknown>>;
  itemCount: number;
  totalPaise: number;
  placedAt?: string | null;
}

export interface CustomerCart {
  items: Array<{
    key: string;
    offerId: string;
    productId: string;
    variantId: string;
    slug: string;
    title: string;
    imageUrl?: string | null;
    sizeKey: string;
    color: { name?: string | null; hex?: string | null; familyKeys: string[] };
    quantity: number;
    availableQty: number;
    pricePaise: number;
    lineTotalPaise: number;
  }>;
  itemCount: number;
  subtotalPaise: number;
}

export interface AuthSession {
  accessToken: string;
  tokenType: 'bearer';
  user: AuthUser;
}

export interface SellerApplicationInput {
  email: string;
  password: string;
  fullName: string;
  displayName: string;
  brandName: string;
  phone?: string;
  addressLine: string;
  pincode: string;
}

export interface SellerSummary {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  displayName: string;
  status: SellerStatus;
  rejectionReason?: string | null;
  createdAt?: string | null;
  locations: number;
  brands: number;
}
