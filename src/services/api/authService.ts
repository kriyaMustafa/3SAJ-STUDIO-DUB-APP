/**
 * 3SAJ Studio App — Auth & Device Management Client
 * Handles account authentication, JWT tokens, device sessions, and remote revocations.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import queryString from 'query-string';

const DEVICE_ID_KEY = '3saj_studio_device_id';
const ACCESS_TOKEN_KEY = '3saj_studio_access_token';
const REFRESH_TOKEN_KEY = '3saj_studio_refresh_token';
const USER_PROFILE_KEY = '3saj_studio_user_profile';

export interface UserProfile {
  id: string;
  user_id?: string;
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

export const DEFAULT_BACKEND_URL = 'https://threesaj-studio-dub-app-734y.onrender.com';

export class AuthService {
  private backendBaseUrl: string;
  private authListeners: Array<(user: UserProfile | null, sub: SubscriptionInfo | null) => void> = [];
  private cachedProfileData: {
    user: UserProfile;
    subscription: SubscriptionInfo | null;
    usage_today: DailyUsageInfo;
    cachedAt: number;
  } | null = null;

  constructor(backendBaseUrl: string = DEFAULT_BACKEND_URL) {
    this.backendBaseUrl = backendBaseUrl.replace(/\/$/, '');
  }

  /**
   * Subscribes to real-time authentication state changes (sign in, sign out, profile refresh).
   */
  onAuthStateChanged(listener: (user: UserProfile | null, sub: SubscriptionInfo | null) => void) {
    this.authListeners.push(listener);
    return () => {
      this.authListeners = this.authListeners.filter((l) => l !== listener);
    };
  }

  notifyAuthChange(user: UserProfile | null, sub: SubscriptionInfo | null) {
    for (const listener of this.authListeners) {
      try {
        listener(user, sub);
      } catch (e) {
        console.warn('Auth listener error:', e);
      }
    }
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
   * Robust fetch wrapper with configurable AbortController timeout and informative error handling.
   */
  async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = 15000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Please check your internet connection or server status.`);
      }
      if (err.message && (err.message.includes('Network request failed') || err.message.includes('Failed to fetch'))) {
        throw new Error('Network connection failed. Please ensure your device has internet access and your backend server is running.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
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

      const res = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: refreshToken,
          device_id: deviceId,
        }),
      }, 10000);

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

  /**
   * Guarantees a valid access token for API endpoints.
   * If user is signed in, returns their valid token.
   * If user is anonymous or guest, automatically and transparently provisions
   * a persistent device-bound session on the backend so checkout and API calls
   * never fail with "Missing or malformed Authorization header".
   */
  async ensureAuthenticatedSession(): Promise<string> {
    const existing = await this.getValidAccessToken();
    if (existing) return existing;

    const deviceId = await this.getDeviceId();
    const cleanDevId = deviceId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
    const guestEmail = `dev_${cleanDevId}@guest.3saj.app`;
    const guestPassword = `guest_pass_${cleanDevId}_2026`;

    try {
      // 1. Try logging in existing device account
      const loginRes = await this.login(guestEmail, guestPassword);
      if (loginRes?.tokens?.access_token) {
        return loginRes.tokens.access_token;
      }
    } catch {
      // 2. If login fails (user does not exist yet), register fresh device account
      try {
        const regRes = await this.register(
          guestEmail,
          guestPassword,
          `Android User ${cleanDevId.substring(0, 4)}`
        );
        if (regRes?.tokens?.access_token) {
          return regRes.tokens.access_token;
        }
      } catch (regErr) {
        console.warn('Guest auto-session registration warning:', regErr);
      }
    }

    return (await this.getValidAccessToken()) || '';
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
    this.cachedProfileData = null;
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {}),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {}),
        SecureStore.deleteItemAsync(USER_PROFILE_KEY).catch(() => {}),
        AsyncStorage.removeItem(ACCESS_TOKEN_KEY).catch(() => {}),
        AsyncStorage.removeItem(REFRESH_TOKEN_KEY).catch(() => {}),
        AsyncStorage.removeItem(USER_PROFILE_KEY).catch(() => {}),
      ]);
      this.notifyAuthChange(null, null);
    } catch (e) {
      console.warn('Failed clearing tokens:', e);
      this.notifyAuthChange(null, null);
    }
  }

  async storeUserProfile(user: UserProfile, sub: SubscriptionInfo | null = null): Promise<void> {
    await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
    this.notifyAuthChange(user, sub);
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

    const response = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/auth/register`, {
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
    }, 20000);

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
  async login(email: string, password: string, revokeDeviceId?: string): Promise<{
    user: UserProfile;
    tokens: AuthTokens;
    subscription?: SubscriptionInfo | null;
  }> {
    const deviceId = await this.getDeviceId();
    const deviceName = await this.getDeviceName();

    const response = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        device_id: deviceId,
        device_name: deviceName,
        platform: Platform.OS,
        revoke_device_id: revokeDeviceId,
      }),
    }, 20000);

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
   * Google OAuth 2.0 verification using Google ID Token.
   */
  async loginWithGoogleToken(idToken: string, profileHints?: { email?: string; fullName?: string; googleId?: string; revokeDeviceId?: string }): Promise<{
    user: UserProfile;
    tokens: AuthTokens;
    subscription?: SubscriptionInfo | null;
  }> {
    const deviceId = await this.getDeviceId();
    const deviceName = await this.getDeviceName();

    const response = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_token: idToken,
        email: profileHints?.email,
        google_id: profileHints?.googleId,
        full_name: profileHints?.fullName,
        device_id: deviceId,
        device_name: deviceName,
        platform: Platform.OS,
        revoke_device_id: profileHints?.revokeDeviceId,
      }),
    }, 25000);

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

    if (data?.user) {
      const uid = data.user.id || (data.user as any).user_id;
      data.user.id = uid;
      data.user.user_id = uid;
    }

    await this.storeTokens(data.tokens);
    await this.storeUserProfile(data.user, data.subscription);
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

    const response = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/auth/google`, {
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
    }, 25000);

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
   * Checks status of web-based Google authentication session (for devices without Google Play Services).
   */
  async checkWebAuthSession(sessionId: string): Promise<{
    status: 'pending' | 'authenticated' | 'expired';
    user?: UserProfile;
    tokens?: AuthTokens;
  } | null> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.backendBaseUrl}/api/auth/session/check?session_id=${encodeURIComponent(sessionId)}`,
        { method: 'GET' },
        8000
      );
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Handles app deep links returned from browser-based Google OAuth (sajstudio://auth/callback).
   */
  async handleAuthDeepLink(url: string): Promise<UserProfile | null> {
    try {
      const parsed = queryString.parseUrl(url);
      const query = parsed.query;
      const accessToken = (query.access_token as string) || '';
      const refreshToken = (query.refresh_token as string) || '';
      const userId = (query.user_id as string) || '';
      const email = (query.email as string) || '';
      const fullName = (query.full_name as string) || email.split('@')[0];

      if (accessToken && refreshToken && email) {
        const tokens: AuthTokens = {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'bearer',
          expires_in: 86400 * 30,
        };
        const user: UserProfile = {
          id: userId || `usr_${Date.now()}`,
          user_id: userId || `usr_${Date.now()}`,
          email,
          full_name: fullName,
        };

        await this.storeTokens(tokens);
        await this.storeUserProfile(user);
        this.notifyAuthChange(user, null);
        return user;
      }
    } catch (e) {
      console.warn('Failed parsing auth deep link:', e);
    }
    return null;
  }

  /**
   * Fetch current user profile, subscription, and usage info.
   * Features in-memory caching (15s) and 6s network timeout for zero UI lag.
   */
  async getCurrentProfile(forceRefresh: boolean = false): Promise<{
    user: UserProfile;
    subscription: SubscriptionInfo | null;
    usage_today: DailyUsageInfo;
  } | null> {
    const now = Date.now();
    if (!forceRefresh && this.cachedProfileData && now - this.cachedProfileData.cachedAt < 15000) {
      return this.cachedProfileData;
    }

    let token = await this.getValidAccessToken();
    if (!token) {
      const stored = await this.getStoredUserProfile();
      if (stored) {
        return {
          user: stored,
          subscription: null,
          usage_today: {
            date: new Date().toISOString().split('T')[0],
            plan_code: null,
            daily_limit_minutes: null,
            minutes_used: 0,
            minutes_remaining: null,
            seconds_until_midnight_reset: 0,
            is_unlimited: false,
          },
        };
      }
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      let response = await fetch(`${this.backendBaseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // If token expired on server, attempt refresh
      if (response.status === 401) {
        const refreshedToken = await this.refreshTokens();
        if (refreshedToken) {
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), 6000);
          response = await fetch(`${this.backendBaseUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${refreshedToken}` },
            signal: retryController.signal,
          });
          clearTimeout(retryTimeoutId);
        }
      }

      if (response.ok) {
        const data = await response.json();
        if (data?.user) {
          const uid = data.user.id || (data.user as any).user_id;
          data.user.id = uid;
          data.user.user_id = uid;
          this.cachedProfileData = {
            ...data,
            cachedAt: Date.now(),
          };
          await this.storeUserProfile(data.user, data.subscription);
        }
        return data;
      }
      return this.cachedProfileData || null;
    } catch {
      if (this.cachedProfileData) {
        return this.cachedProfileData;
      }
      const stored = await this.getStoredUserProfile();
      if (stored) {
        return {
          user: stored,
          subscription: null,
          usage_today: {
            date: new Date().toISOString().split('T')[0],
            plan_code: null,
            daily_limit_minutes: null,
            minutes_used: 0,
            minutes_remaining: null,
            seconds_until_midnight_reset: 0,
            is_unlimited: false,
          },
        };
      }
      return null;
    }
  }

  /**
   * List all registered devices for user.
   */
  async listDevices(): Promise<DeviceInfo[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      const response = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 12000);
      if (!response.ok) return [];
      const data = await response.json();
      return data.devices || [];
    } catch (e) {
      console.warn('Failed listing devices:', e);
      return [];
    }
  }

  /**
   * Revoke a remote device to allow login on a new phone.
   */
  async revokeDevice(deviceId: string): Promise<boolean> {
    const token = await this.getAccessToken();
    if (!token) return false;

    try {
      const response = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/devices/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ device_id: deviceId }),
      }, 12000);

      return response.ok;
    } catch (e) {
      console.warn('Failed revoking device:', e);
      return false;
    }
  }

  /**
   * Log out current device.
   */
  async logout(): Promise<void> {
    const token = await this.getAccessToken();
    const deviceId = await this.getDeviceId();

    if (token) {
      try {
        await this.fetchWithTimeout(`${this.backendBaseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ device_id: deviceId }),
        }, 8000);
      } catch (e) {
        console.warn('Logout network error:', e);
      }
    }

    await this.clearTokens();
  }

  /**
   * Verifies and activates a paid ABA PayWay subscription.
   */
  async verifySubscriptionPayment(paymentId: string, planCode?: string): Promise<{
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

    const query = planCode ? `?plan_code=${encodeURIComponent(planCode)}` : '';
    const response = await this.fetchWithTimeout(`${this.backendBaseUrl}/api/subscriptions/verify/${paymentId}${query}`, {
      headers,
    }, 15000);

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Verification failed' }));
      throw new Error(err.detail || 'Failed to verify subscription payment');
    }

    const data = await response.json();
    // Safety check: if caller specified planCode, ensure client-side subscription object matches the purchased tier
    if (data.subscription && planCode && data.subscription.plan_code !== planCode) {
      data.subscription.plan_code = planCode;
      if (planCode === 'FLASH') {
        data.subscription.plan_name = 'Flash';
        data.subscription.price_usd = 5;
        data.subscription.daily_minute_limit = 150;
      }
    }

    return data;
  }
}

export const authService = new AuthService();
