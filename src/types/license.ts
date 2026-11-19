export type LicenseTier = 'FLASH' | 'PRO' | 'PREMIUM';

export type LicenseDuration = '1_WEEK' | '1_MONTH' | '2_MONTHS' | '3_MONTHS';

export interface TierConfig {
  tier: LicenseTier;
  displayName: string;
  dailyLimitSeconds: number; // Daily video translation quota in seconds
  dailyLimitHours: number;
  description: string;
  badgeColor: string;
}

export const TIER_CONFIGS: Record<LicenseTier, TierConfig> = {
  FLASH: {
    tier: 'FLASH',
    displayName: 'Flash',
    dailyLimitSeconds: 3600, // 1 hour per day
    dailyLimitHours: 1,
    description: '1 Hour Translation / Day',
    badgeColor: '#F59E0B', // Amber
  },
  PRO: {
    tier: 'PRO',
    displayName: 'Pro',
    dailyLimitSeconds: 10800, // 3 hours per day
    dailyLimitHours: 3,
    description: '3 Hours Translation / Day',
    badgeColor: '#38BDF8', // Sky Blue
  },
  PREMIUM: {
    tier: 'PREMIUM',
    displayName: 'Premium',
    dailyLimitSeconds: 21600, // 6 hours per day
    dailyLimitHours: 6,
    description: '6 Hours Translation / Day',
    badgeColor: '#A855F7', // Purple
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
