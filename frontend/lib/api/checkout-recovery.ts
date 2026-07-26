import { apiRequest } from '@/lib/api/client';
import type {
  CheckoutRecoveryConfig,
  CheckoutRecoveryConfigInput,
  RecoveryCheckout,
  RecoveryRun,
} from '@/types/checkout-recovery';

type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export function getRecoveryConfig() {
  return apiRequest<CheckoutRecoveryConfig>('/admin/checkout-recovery/config');
}

export function saveRecoveryConfig(input: CheckoutRecoveryConfigInput) {
  return apiRequest<CheckoutRecoveryConfig>('/admin/checkout-recovery/config', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function testRecoveryConnection() {
  return apiRequest<{
    ok: boolean;
    latencyMs: number;
    total: number;
    agentVerified: boolean;
    campaignVerified: boolean;
    multilingual: {
      enabled: boolean;
      languageSwitchTool: 'switch_language_tool';
      agentConfigurationRequired: boolean;
    };
  }>('/admin/checkout-recovery/test', { method: 'POST' });
}

export function runRecoveryNow() {
  return apiRequest<RecoveryRun>('/admin/checkout-recovery/run', { method: 'POST' });
}

export function getRecoveryRuns(page = 1, pageSize = 20) {
  return apiRequest<Page<RecoveryRun>>(`/admin/checkout-recovery/runs?page=${page}&pageSize=${pageSize}`);
}

export function getRecoveryCheckouts(page = 1, pageSize = 20) {
  return apiRequest<Page<RecoveryCheckout>>(`/admin/checkout-recovery/checkouts?page=${page}&pageSize=${pageSize}`);
}
