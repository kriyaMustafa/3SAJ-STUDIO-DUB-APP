/**
 * 3SAJ Studio App — Auth & Device Management Client
 * Handles account authentication, JWT tokens, device sessions, and remote revocations.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '3saj_studio_device_id';
const ACCESS_TOKEN_KEY = '3saj_studio_access_token';
const REFRESH_TOKEN_KEY = '3saj_studio_refresh_token';
const USER_PROFILE_KEY = '3saj_studio_user_profile';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
}

export interface DeviceInfo {
  id: string;
  device_id: string;
  device_name: string;
  platform: string;
  is_active: boolean;
  is_current?: boolean;
  last_active_at?: string;
  created_at?: string;
}

export interface SubscriptionInfo {
  subscription_id: string;
  plan_code: 'FLASH' | 'PRO' | 'PRO_MAX' | 'UNLIMITED';
  plan_name: string;
  price_usd: number;
  daily_minute_limit: number | null;
  max_devices: number;
  expires_at: string;
  days_remaining: number;
  hours_remaining: number;
  is_unlimited: boolean;
}

export interface DailyUsageInfo {
  date: string;
  plan_code: string | null;
  daily_limit_minutes: number | null;
  minutes_used: number;
  minutes_remaining: number | null;
  seconds_until_midnight_reset: number;
  is_unlimited: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export const DEFAULT_BACKEND_URL = 'https://threesaj-studio-dub-app.onrender.com';

export class AuthService {
  private backendBaseUrl: string;

  constructor(backendBaseUrl: string = DEFAULT_BACKEND_URL) {
    this.backendBaseUrl = backendBaseUrl.replace(/\/$/, '');
  }

  setBackendUrl(url: string) {
    if (url) {
      this.backendBaseUrl = url.replace(/\/$/, '');
    }
  }

  getBackendUrl(): string {
    return this.backendBaseUrl;
  }

  /**
   * Retrieves or generates a persistent, unique device identifier.
   */
  async getDeviceId(): Promise<string> {
    try {
      let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (!deviceId) {
        deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
      }
      if (!deviceId) {
        deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId).catch(() => {});
        await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      }
      return deviceId;
    } catch {
      return `dev_${Platform.OS}_${Date.now()}`;
    }
  }

  async getDeviceName(): Promise<string> {
    return Platform.OS === 'android' ? 'Android Phone' : 'iOS Device';
  }

  async getAccessToken(): Promise<string | null> {
    try {
      let token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (!token) {
        token = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
      }
      return token;
    } catch {
      return null;
    }
  }

  async getRefreshToken(): Promise<string | null> {
    try {
      let token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!token) {
        token = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      }
      return token;
    } catch {
      return null;
    }
  }

  /**
   * Refreshes access tokens using stored refresh_token.
   */
  async refreshTokens(): Promise<string | null> {
    try {
      const refreshToken = await this.getRefreshToken();
      const deviceId = await this.getDeviceId();
      if (!refreshToken || !deviceId) {
        return null;
      }

      const res = await fetch(`${this.backendBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: refreshToken,
          device_id: deviceId,
        }),
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      if (data.tokens) {
        await this.storeTokens(data.tokens);
        return data.tokens.access_token;
      }
      return null;
    } catch (e) {
      console.warn('Failed refreshing tokens:', e);
      return null;
    }
  }

  /**
   * Returns a guaranteed valid access token, auto-refreshing if expired or about to expire.
   */
  async getValidAccessToken(): Promise<string | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) b64 += '=';

        let decoded = '';
        if (typeof atob === 'function') {
          decoded = atob(b64);
        } else if (typeof Buffer !== 'undefined') {
          decoded = Buffer.from(b64, 'base64').toString('utf8');
        }
        if (decoded) {
          const payload = JSON.parse(decoded);
          const exp = payload.exp;
          const now = Math.floor(Date.now() / 1000);
          if (exp && exp - now < 60) {
            const refreshed = await this.refreshTokens();
            if (refreshed) return refreshed;
          }
        }
      }
    } catch {
      const refreshed = await this.refreshTokens();
      if (refreshed) return refreshed;
    }

    return token;
  }

  async storeTokens(tokens: AuthTokens): Promise<void> {
    try {
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.access_token).catch(() => {});
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh_token).catch(() => {});
      await AsyncStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
    } catch (e) {
      console.warn('Failed storing tokens:', e);
    }
  }

  async clearTokens(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {});
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
      await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
      await AsyncStorage.removeItem(USER_PROFILE_KEY);
    } catch (e) {
      console.warn('Failed clearing tokens:', e);
    }
  }

  async storeUserProfile(user: UserProfile): Promise<void> {
    await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
  }

  async getStoredUserProfile(): Promise<UserProfile | null> {
    try {
      const data = await AsyncStorage.getItem(USER_PROFILE_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /**
   * Register a new user with email and password.
   */
  async register(email: string, password: string, fullName?: string): Promise<{
    user: UserProfile;
    tokens: AuthTokens;
  }> {
    const deviceId = await this.getDeviceId();
    const deviceName = await this.getDeviceName();

    const response = await fetch(`${this.backendBaseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        full_name: fullName,
        device_id: deviceId,
        device_name: deviceName,
        platform: Platform.OS,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail?.message || data.detail || 'Registration failed');
    }

    await this.storeTokens(data.tokens);
    await this.storeUserProfile(data.user);
    return data;
  }

  /**
   * Log in an existing user.
   */
  async login(email: string, password: string): Promise<{
    user: UserProfile;
    tokens: AuthTokens;
    subscription?: SubscriptionInfo | null;
  }> {
    const deviceId = await this.getDeviceId();
    const deviceName = await this.getDeviceName();

    const response = await fetch(`${this.backendBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        device_id: deviceId,
        device_name: deviceName,
        platform: Platform.OS,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (response.status === 403 && data.detail?.error_code === 'DEVICE_LIMIT_EXCEEDED') {
        const err: any = new Error(data.detail.message);
        err.code = 'DEVICE_LIMIT_EXCEEDED';
        err.active_devices = data.detail.active_devices;
        throw err;
      }
      throw new Error(data.detail?.message || data.detail || 'Login failed');
    }

    await this.storeTokens(data.tokens);
    await this.storeUserProfile(data.user);
    return data;
  }

  /**
   * Google OAuth login / registration with account linking.
   */
  async loginWithGoogle(email: string, googleId: string, fullName?: string): Promise<{
    user: UserProfile;
    tokens: AuthTokens;
    subscription?: SubscriptionInfo | null;
  }> {
    const deviceId = await this.getDeviceId();
    const deviceName = await this.getDeviceName();

    const response = await fetch(`${this.backendBaseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        google_id: googleId,
        full_name: fullName,
        device_id: deviceId,
        device_name: deviceName,
        platform: Platform.OS,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (response.status === 403 && data.detail?.error_code === 'DEVICE_LIMIT_EXCEEDED') {
        const err: any = new Error(data.detail.message);
        err.code = 'DEVICE_LIMIT_EXCEEDED';
        err.active_devices = data.detail.active_devices;
        throw err;
      }
      throw new Error(data.detail?.message || data.detail || 'Google sign-in failed');
    }

    await this.storeTokens(data.tokens);
    await this.storeUserProfile(data.user);
    return data;
  }

  /**
   * Fetch current user profile, subscription, and usage info.
   */
  async getCurrentProfile(): Promise<{
    user: UserProfile;
    subscription: SubscriptionInfo | null;
    usage_today: DailyUsageInfo;
  } | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const response = await fetch(`${this.backendBaseUrl}/api/auth/me`, {
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

  /**
   * List all registered devices for user.
   */
  async listDevices(): Promise<DeviceInfo[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    const response = await fetch(`${this.backendBaseUrl}/api/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.devices || [];
  }

  /**
   * Revoke a remote device to allow login on a new phone.
   */
  async revokeDevice(deviceId: string): Promise<boolean> {
    const token = await this.getAccessToken();
    if (!token) return false;

    const response = await fetch(`${this.backendBaseUrl}/api/devices/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ device_id: deviceId }),
    });

    return response.ok;
  }

  /**
   * Log out current device.
   */
  async logout(): Promise<void> {
    const token = await this.getAccessToken();
    const deviceId = await this.getDeviceId();

    if (token) {
      try {
        await fetch(`${this.backendBaseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ device_id: deviceId }),
        });
      } catch (e) {
        console.warn('Logout network error:', e);
      }
    }

    await this.clearTokens();
  }

  /**
   * Verifies and activates a paid ABA PayWay subscription.
   */
  async verifySubscriptionPayment(paymentId: string): Promise<{
    success: boolean;
    status: string;
    subscription?: SubscriptionInfo;
    message?: string;
  }> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.backendBaseUrl}/api/subscriptions/verify/${paymentId}`, {
      headers,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Verification failed' }));
      throw new Error(err.detail || 'Failed to verify subscription payment');
    }

    return await response.json();
  }
}

export const authService = new AuthService();
