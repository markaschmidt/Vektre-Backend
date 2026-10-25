import type { UserPlan } from '../../integrations/app-data.types.js';

export interface StorageUsageApi {
  scope: 'user' | 'organization';
  subject_id: string;
  plan: UserPlan;
  quota_bytes: number;
  used_bytes: number;
  remaining_bytes: number;
  percent_used: number;
}
