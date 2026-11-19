export type LicenseTier = 'FLASH' | 'PRO' | 'PRO_MAX' | 'UNLIMITED' | 'PREMIUM';

export type LicenseDuration = '1_WEEK' | '1_MONTH' | '2_MONTHS' | '3_MONTHS';

export interface TierConfig {
  tier: LicenseTier;
  displayName: string;
  dailyLimitSeconds: number; // Daily video translation quota in seconds
  dailyLimitHours: number;
  dailyLimitMinutes: number;
  priceUsd: number;
  description: string;
  badgeColor: string;
}

export const TIER_CONFIGS: Record<LicenseTier, TierConfig> = {
  FLASH: {
    tier: 'FLASH',
    displayName: 'Flash',
    dailyLimitSeconds: 9000, // 150 minutes per day
    dailyLimitMinutes: 150,
    dailyLimitHours: 2.5,
    priceUsd: 5,
    description: '150 Minutes Translation / Day',
    badgeColor: '#F59E0B', // Amber
  },
  PRO: {
    tier: 'PRO',
    displayName: 'Pro',
    dailyLimitSeconds: 18000, // 300 minutes per day
    dailyLimitMinutes: 300,
    dailyLimitHours: 5,
    priceUsd: 8,
    description: '300 Minutes Translation / Day',
    badgeColor: '#38BDF8', // Sky Blue
  },
  PRO_MAX: {
    tier: 'PRO_MAX',
    displayName: 'Pro Max',
    dailyLimitSeconds: 36000, // 600 minutes per day
    dailyLimitMinutes: 600,
    dailyLimitHours: 10,
    priceUsd: 10,
    description: '600 Minutes Translation / Day',
    badgeColor: '#A855F7', // Purple
  },
  UNLIMITED: {
    tier: 'UNLIMITED',
    displayName: 'Unlimited',
    dailyLimitSeconds: 864000, // No daily limit
    dailyLimitMinutes: 14400,
    dailyLimitHours: 240,
    priceUsd: 15,
    description: 'Unlimited Minutes / Day',
    badgeColor: '#10B981', // Emerald
  },
  PREMIUM: {
    tier: 'PREMIUM',
    displayName: 'Premium',
    dailyLimitSeconds: 36000,
    dailyLimitMinutes: 600,
    dailyLimitHours: 10,
    priceUsd: 10,
    description: '600 Minutes Translation / Day',
    badgeColor: '#EC4899', // Pink
  },
};

export const DURATION_DAYS_MAP: Record<LicenseDuration, number> = {
  '1_WEEK': 7,
  '1_MONTH': 30,
  '2_MONTHS': 60,
  '3_MONTHS': 90,
};

export interface LicenseData {
  key: string;
  tier: LicenseTier;
  durationDays: number;
  activatedAt: number; // Unix ms
  expiresAt: number; // Unix ms
  dailyLimitSeconds: number;
}

export interface LicenseStatus {
  isValid: boolean;
  isExpired: boolean;
  license: LicenseData | null;
  daysRemaining: number;
  hoursRemaining: number;
  message: string;
}

export interface DailyUsageData {
  date: string; // YYYY-MM-DD
  secondsUsed: number;
  secondsRemaining: number;
  dailyLimitSeconds: number;
  percentageUsed: number;
}
