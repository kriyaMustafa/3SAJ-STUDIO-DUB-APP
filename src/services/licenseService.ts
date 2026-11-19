import * as SecureStore from 'expo-secure-store';
import {
  LicenseTier,
  LicenseDuration,
  LicenseData,
  LicenseStatus,
  DailyUsageData,
  TIER_CONFIGS,
  DURATION_DAYS_MAP,
} from '../types/license';
import { hmacSha256 } from './cryptoUtils';
import { authService } from './api/authService';
import { usageService } from './api/usageService';

const MASTER_SALT = '3SAJ_STUDIO_DUBBING_MASTER_LICENSE_SALT_2026';
const LICENSE_STORAGE_KEY = 'saj_studio_active_license_v1';
const USAGE_STORAGE_KEY = 'saj_studio_daily_usage_v1';
export const ADMIN_MASTER_PIN = '3saj9999';

/**
 * Generates an authentic cryptographic license key.
 * Format: 3SAJ-[TIER]-[DAYS]D-[5_CHAR_ID]-[8_CHAR_SIGNATURE]
 * Example: 3SAJ-PRO-30D-K8X2Q-F3A81D29
 */
export function generateLicenseKey(
  tier: LicenseTier,
  durationDays: number,
  customId?: string
): string {
  const cleanId = (
    customId || Math.random().toString(36).substring(2, 7)
  )
    .toUpperCase()
    .slice(0, 5)
    .padEnd(5, 'X');

  const payload = `${tier.toUpperCase()}:${durationDays}:${cleanId}`;
  const sig = hmacSha256(payload, MASTER_SALT).slice(0, 8).toUpperCase();

  return `3SAJ-${tier.toUpperCase()}-${durationDays}D-${cleanId}-${sig}`;
}

/**
 * Validates the cryptographic signature and format of a license key.
 */
export function verifyLicenseKey(rawKey: string): {
  valid: boolean;
  tier?: LicenseTier;
  durationDays?: number;
  keyId?: string;
  error?: string;
} {
  const cleaned = rawKey.trim().toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^3SAJ-(FLASH|PRO|PRO_MAX|UNLIMITED|PREMIUM)-(\d+)D-([A-Z0-9]{5})-([A-F0-9]{8})$/);

  if (!match) {
    return {
      valid: false,
      error: 'Invalid license format. Example: 3SAJ-PRO-30D-ABC12-1A2B3C4D',
    };
  }

  const tier = match[1] as LicenseTier;
  const days = parseInt(match[2], 10);
  const keyId = match[3];
  const signature = match[4];

  if (isNaN(days) || days <= 0) {
    return { valid: false, error: 'Invalid license duration.' };
  }

  const payload = `${tier}:${days}:${keyId}`;
  const expectedSig = hmacSha256(payload, MASTER_SALT).slice(0, 8).toUpperCase();

  if (signature !== expectedSig) {
    return {
      valid: false,
      error: 'Invalid or counterfeit license key signature.',
    };
  }

  return {
    valid: true,
    tier,
    durationDays: days,
    keyId,
  };
}

/**
 * Activates a license key on this device and stores it in SecureStore.
 */
export async function activateLicense(rawKey: string): Promise<{
  success: boolean;
  license?: LicenseData;
  message: string;
}> {
  const verification = verifyLicenseKey(rawKey);
  if (!verification.valid || !verification.tier || !verification.durationDays) {
    return {
      success: false,
      message: verification.error || 'License key validation failed.',
    };
  }

  const tier = verification.tier;
  const durationDays = verification.durationDays;
  const activatedAt = Date.now();
  const expiresAt = activatedAt + durationDays * 24 * 60 * 60 * 1000;
  const dailyLimitSeconds = TIER_CONFIGS[tier]?.dailyLimitSeconds || 10800;

  const licenseData: LicenseData = {
    key: rawKey.trim().toUpperCase(),
    tier,
    durationDays,
    activatedAt,
    expiresAt,
    dailyLimitSeconds,
  };

  try {
    await SecureStore.setItemAsync(LICENSE_STORAGE_KEY, JSON.stringify(licenseData));
    return {
      success: true,
      license: licenseData,
      message: `Successfully activated ${TIER_CONFIGS[tier]?.displayName || tier} Plan for ${durationDays} days!`,
    };
  } catch (err) {
    console.error('[LicenseService] Failed to save license:', err);
    return {
      success: false,
      message: 'Failed to securely store license on device.',
    };
  }
}

/**
 * Loads the active license data from SecureStore.
 */
export async function getSavedLicense(): Promise<LicenseData | null> {
  try {
    const raw = await SecureStore.getItemAsync(LICENSE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicenseData;
  } catch (err) {
    console.warn('[LicenseService] Error reading license:', err);
    return null;
  }
}

/**
 * Checks overall app subscription status.
 * Authoritatively queries server-side PostgreSQL first via authService,
 * then falls back to local SecureStore.
 */
export async function checkAppLicense(): Promise<LicenseStatus> {
  // 1. Check server-side subscription
  try {
    const profile = await authService.getCurrentProfile();
    if (profile && profile.subscription) {
      const sub = profile.subscription;
      const tier = (sub.plan_code in TIER_CONFIGS ? sub.plan_code : 'PRO') as LicenseTier;
      const dailyLimitSeconds = sub.daily_minute_limit ? sub.daily_minute_limit * 60 : 864000;

      const licenseData: LicenseData = {
        key: `CENTRAL-${sub.subscription_id.slice(0, 8)}`,
        tier,
        durationDays: 30,
        activatedAt: Date.now(),
        expiresAt: new Date(sub.expires_at).getTime(),
        dailyLimitSeconds,
      };

      return {
        isValid: true,
        isExpired: false,
        license: licenseData,
        daysRemaining: sub.days_remaining,
        hoursRemaining: sub.hours_remaining,
        message: `Active: ${sub.plan_name} (${sub.days_remaining}d ${sub.hours_remaining}h left)`,
      };
    }
  } catch (e) {
    console.warn('[LicenseService] Server profile check error:', e);
  }

  // 2. Check local fallback license
  const license = await getSavedLicense();
  if (!license) {
    return {
      isValid: false,
      isExpired: false,
      license: null,
      daysRemaining: 0,
      hoursRemaining: 0,
      message: 'No active subscription. Please subscribe to Flash, Pro, Pro Max, or Unlimited in Settings.',
    };
  }

  const now = Date.now();
  const diffMs = license.expiresAt - now;

  if (diffMs <= 0) {
    return {
      isValid: false,
      isExpired: true,
      license,
      daysRemaining: 0,
      hoursRemaining: 0,
      message: `Your ${TIER_CONFIGS[license.tier]?.displayName || license.tier} Plan expired. Please renew your subscription to continue.`,
    };
  }

  const daysRemaining = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hoursRemaining = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  return {
    isValid: true,
    isExpired: false,
    license,
    daysRemaining,
    hoursRemaining,
    message: `Active: ${TIER_CONFIGS[license.tier]?.displayName || license.tier} Plan (${daysRemaining}d ${hoursRemaining}h remaining)`,
  };
}

/**
 * Returns today's video translation usage statistics.
 */
export async function getDailyUsage(tierLimitSeconds: number): Promise<DailyUsageData> {
  // Try fetching from server first
  try {
    const todayUsage = await usageService.getTodayUsage();
    if (todayUsage) {
      const usedSec = Math.round(todayUsage.minutes_used * 60);
      const limitSec = todayUsage.daily_limit_minutes ? todayUsage.daily_limit_minutes * 60 : tierLimitSeconds;
      const remSec = todayUsage.minutes_remaining !== null ? Math.round(todayUsage.minutes_remaining * 60) : limitSec;

      return {
        date: todayUsage.date,
        secondsUsed: usedSec,
        secondsRemaining: remSec,
        dailyLimitSeconds: limitSec,
        percentageUsed: Math.min(100, Math.round((usedSec / limitSec) * 100)),
      };
    }
  } catch (e) {
    console.warn('[LicenseService] Error reading server usage:', e);
  }

  // Local fallback
  const todayStr = new Date().toISOString().slice(0, 10);
  let secondsUsed = 0;

  try {
    const raw = await SecureStore.getItemAsync(USAGE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === todayStr) {
        secondsUsed = parsed.secondsUsed || 0;
      }
    }
  } catch (err) {
    console.warn('[LicenseService] Error reading local daily usage:', err);
  }

  const secondsRemaining = Math.max(0, tierLimitSeconds - secondsUsed);
  const percentageUsed = Math.min(100, Math.round((secondsUsed / tierLimitSeconds) * 100));

  return {
    date: todayStr,
    secondsUsed,
    secondsRemaining,
    dailyLimitSeconds: tierLimitSeconds,
    percentageUsed,
  };
}

/**
 * Records newly translated video seconds into today's quota.
 */
export async function recordDailyUsage(secondsAdded: number, idempotencyToken?: string): Promise<void> {
  if (idempotencyToken) {
    try {
      await usageService.commitTranslationQuota(idempotencyToken);
    } catch (e) {
      console.warn('[LicenseService] Server commit error:', e);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let currentUsed = 0;

  try {
    const raw = await SecureStore.getItemAsync(USAGE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === todayStr) {
        currentUsed = parsed.secondsUsed || 0;
      }
    }
  } catch (_) {}

  const newTotal = currentUsed + Math.max(0, Math.round(secondsAdded));
  try {
    await SecureStore.setItemAsync(
      USAGE_STORAGE_KEY,
      JSON.stringify({ date: todayStr, secondsUsed: newTotal })
    );
  } catch (err) {
    console.warn('[LicenseService] Error updating local daily usage:', err);
  }
}

/**
 * Validates whether a translation job of `neededSeconds` fits within today's quota.
 */
export async function checkDailyTranslationQuota(
  license: LicenseData,
  neededSeconds: number
): Promise<{
  allowed: boolean;
  secondsUsed: number;
  secondsRemaining: number;
  dailyLimitSeconds: number;
  tierName: string;
}> {
  const tierConfig = TIER_CONFIGS[license.tier] || TIER_CONFIGS.PRO;
  const usage = await getDailyUsage(tierConfig.dailyLimitSeconds);

  // If already at or exceeding daily quota
  if (usage.secondsRemaining <= 0) {
    return {
      allowed: false,
      secondsUsed: usage.secondsUsed,
      secondsRemaining: 0,
      dailyLimitSeconds: tierConfig.dailyLimitSeconds,
      tierName: tierConfig.displayName,
    };
  }

  // If requested batch exceeds remaining seconds
  if (neededSeconds > usage.secondsRemaining) {
    return {
      allowed: false,
      secondsUsed: usage.secondsUsed,
      secondsRemaining: usage.secondsRemaining,
      dailyLimitSeconds: tierConfig.dailyLimitSeconds,
      tierName: tierConfig.displayName,
    };
  }

  return {
    allowed: true,
    secondsUsed: usage.secondsUsed,
    secondsRemaining: usage.secondsRemaining,
    dailyLimitSeconds: tierConfig.dailyLimitSeconds,
    tierName: tierConfig.displayName,
  };
}

/**
 * Removes the saved license (useful for testing or switching keys).
 */
export async function removeLicense(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LICENSE_STORAGE_KEY);
  } catch (_) {}
}
