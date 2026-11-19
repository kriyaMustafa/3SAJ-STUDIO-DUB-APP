/**
 * 3SAJ Studio App — Daily Usage & Quota Service
 * Enforces server-side quota checks in Asia/Phnom_Penh timezone.
 * Handles reservation before translation and idempotent commit upon completion.
 */

import { authService, DailyUsageInfo, SubscriptionInfo } from './authService';

export interface QuotaReservationResult {
  allowed: boolean;
  job_id?: string;
  is_unlimited?: boolean;
  already_reserved?: boolean;
  remaining_minutes_after_job?: number;
  plan?: SubscriptionInfo;
}

export class UsageService {
  async getTodayUsage(): Promise<DailyUsageInfo | null> {
    const token = await authService.getAccessToken();
    if (!token) return null;

    try {
      const response = await fetch(`${authService.getBackendUrl()}/api/usage/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch {
      return null;
    }
  }

  async reserveTranslationQuota(
    videoDurationSeconds: number,
    idempotencyToken: string,
    projectId?: string
  ): Promise<QuotaReservationResult> {
    const token = await authService.getAccessToken();
    if (!token) {
      throw new Error('Please sign in to your 3SAJ account to use translation services.');
    }

    const response = await fetch(`${authService.getBackendUrl()}/api/usage/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        video_duration_seconds: videoDurationSeconds,
        idempotency_token: idempotencyToken,
        project_id: projectId,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const detail = data.detail || {};
      const err: any = new Error(detail.message || 'Quota limit reached or no active subscription.');
      err.code = detail.error_code || 'QUOTA_ERROR';
      err.daily_limit_minutes = detail.daily_limit_minutes;
      err.remaining_minutes = detail.remaining_minutes;
      throw err;
    }

    return data;
  }

  async commitTranslationQuota(idempotencyToken: string): Promise<boolean> {
    const token = await authService.getAccessToken();
    if (!token) return false;

    try {
      const response = await fetch(`${authService.getBackendUrl()}/api/usage/commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          idempotency_token: idempotencyToken,
        }),
      });
      return response.ok;
    } catch (e) {
      console.warn('Failed committing translation quota:', e);
      return false;
    }
  }
}

export const usageService = new UsageService();
