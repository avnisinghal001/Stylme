export type CheckoutRecoveryConfig = {
  id: string;
  enabled: boolean;
  source: { pageSize: number };
  samora: {
    environment: 'stage' | 'production';
    baseUrl: string;
    agentId: string | null;
    campaignId: string | null;
    platform: string;
    externalWorkflowId: string;
    allowedCampaignStatuses: Array<'DRAFT' | 'IN_PROGRESS'>;
    orgApiKeyConfigured: boolean;
    orgApiKey: string | null;
  };
  calling: {
    timezone: 'Asia/Kolkata';
    windowStart: string;
    windowEnd: string;
    inactivityMinutes: number;
    maxAttempts: number;
    cooldownMinutes: number;
  };
  multilingual: {
    enabled: boolean;
    primaryLanguage: SupportedCallLanguage;
    supportedLanguages: SupportedCallLanguage[];
    automaticDetection: boolean;
    detectionThreshold: number;
    languageSwitchTool: 'switch_language_tool';
  };
  postCallDelivery: {
    enabled: boolean;
    provider: 'zepic';
    questionId: string | null;
    expectedAnswer: string;
    sendOnStatus: ['CALL_FINISHED'];
    providerConfig: null | {
      mode: 'record_sync';
      baseUrl: string;
      apiTokenConfigured: boolean;
      apiToken: string | null;
      lookupField: string;
      objectName: string;
      objectType: string;
      objectApiName: string;
      recordFields: Record<string, string>;
    };
  };
  cronSecretConfigured: boolean;
  cronSecret: string | null;
  cronHeader: 'X-Cron-Secret';
  updatedAt?: string | null;
};

export type CheckoutRecoveryConfigInput = {
  enabled: boolean;
  cronSecret?: string;
  source: { pageSize: number };
  samora: {
    environment: 'stage' | 'production';
    baseUrl: string;
    orgApiKey?: string;
    agentId?: string | null;
    campaignId?: string | null;
    platform: string;
    externalWorkflowId: string;
    allowedCampaignStatuses: Array<'DRAFT' | 'IN_PROGRESS'>;
  };
  calling: {
    timezone: 'Asia/Kolkata';
    windowStart: string;
    windowEnd: string;
    inactivityMinutes: number;
    maxAttempts: number;
    cooldownMinutes: number;
  };
  multilingual: {
    enabled: boolean;
    primaryLanguage: SupportedCallLanguage;
    supportedLanguages: SupportedCallLanguage[];
    automaticDetection: boolean;
    detectionThreshold: number;
    languageSwitchTool: 'switch_language_tool';
  };
  postCallDelivery: {
    enabled: boolean;
    provider: 'zepic';
    questionId: string;
    expectedAnswer: string;
    sendOnStatus: ['CALL_FINISHED'];
    providerConfig?: {
      mode: 'record_sync';
      baseUrl: string;
      apiToken?: string;
      lookupField: string;
      objectName: string;
      objectType: string;
      objectApiName: string;
      recordFields: Record<string, string>;
    } | null;
  };
  metadata?: Record<string, unknown>;
};

export type SupportedCallLanguage = 'en-IN' | 'hi-IN' | 'ta-IN' | 'te-IN' | 'bn-IN' | 'mr-IN';

export type RecoveryRun = {
  id?: string;
  runId: string;
  status: string;
  requestedBy?: string;
  startedAt: string;
  finishedAt?: string | null;
  source: { fetched: number; valid: number; invalid: number; deduplicated: number };
  lookup: { submitted: number; eligible: number; skippedCompleted: number; skippedStale: number; skippedActiveCall: number; errors: number };
  schedule: { submitted: number; scheduled: number; alreadyScheduled: number; skipped: number; failed: number };
  activityUpsert: { submitted: number; succeeded: number; failed: number };
  errors: Array<{ externalId?: string | null; stage: string; code: string; retryable: boolean }>;
};

export type RecoveryCheckout = {
  id: string;
  checkoutId: string;
  externalId: string;
  contactPhone?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  status: string;
  paymentStatus: string;
  itemCount: number;
  cartValuePaise: number;
  currency: string;
  topItem?: string | null;
  lastCartEvent?: string | null;
  eventVersion: number;
  eligibleAt?: string | null;
  lastCartActivityAt?: string | null;
  updatedAt?: string | null;
};
