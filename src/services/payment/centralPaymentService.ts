/**
 * 3SAJ Studio App — Central Payment Integration Service
 * Secure client: All payment requests and verifications route through the backend API,
 * keeping ABA PayWay API keys and secrets 100% server-side.
 */

import { Linking, Platform } from 'react-native';
import { authService } from '../api/authService';

export interface PaymentInitParams {
  amount: number;
  customerReference: string;
  currency?: 'USD' | 'KHR';
  planCode: string; // FLASH, PRO, PRO_MAX, UNLIMITED
  planTitle: string;
}

export interface PaymentSessionResponse {
  payment_id: string;
  transaction_id: string;
  amount: number;
  currency: string;
  status: string;
  qr_string: string | null;
  qr_image: string | null;
  abapay_deeplink: string | null;
  expires_at: string | null;
}

export interface PaymentStatusResponse {
  payment_id: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'PAID_MISMATCH_MANUAL_REVIEW' | 'PAID_LATE_MANUAL_REVIEW';
  is_verified: boolean;
  paid_at: string | null;
  message?: string;
  metadata?: Record<string, any>;
}

export class CentralPaymentClient {
  /**
   * Creates a payment session via backend API.
   * Keeps secret ABA PayWay keys strictly on the server.
   * Seamlessly auto-authenticates guest sessions so payments outside Settings never fail.
   */
  async createPayment(params: PaymentInitParams): Promise<PaymentSessionResponse> {
    let token = await authService.getValidAccessToken();
    if (!token) {
      try {
        token = await authService.ensureAuthenticatedSession();
      } catch (sessErr) {
        console.warn('ensureAuthenticatedSession warning:', sessErr);
      }
    }

    const deviceId = await authService.getDeviceId();
    const deviceName = await authService.getDeviceName();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const backendUrl = authService.getBackendUrl() || 'https://threesaj-studio-dub-app.onrender.com';
    let lastError: any = null;

    // Retry up to 2 times to handle Render free-tier cold-start wake-up
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 28000) : null;

        const response = await fetch(`${backendUrl}/api/subscriptions/checkout`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            plan_code: params.planCode,
            device_id: deviceId,
            device_name: deviceName,
            platform: Platform.OS,
          }),
          ...(controller ? { signal: controller.signal } : {}),
        });

        if (timeoutId) clearTimeout(timeoutId);

        // If 401 Unauthorized, re-authenticate fresh device session and retry
        if (response.status === 401) {
          const freshToken = await authService.ensureAuthenticatedSession();
          if (freshToken) {
            headers.Authorization = `Bearer ${freshToken}`;
            const retryRes = await fetch(`${backendUrl}/api/subscriptions/checkout`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                plan_code: params.planCode,
                device_id: deviceId,
                device_name: deviceName,
                platform: Platform.OS,
              }),
            });
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              if (retryData.tokens) await authService.storeTokens(retryData.tokens);
              if (retryData.user) await authService.storeUserProfile(retryData.user);
              return retryData;
            }
          }
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({ detail: `Server returned HTTP ${response.status}` }));
          throw new Error(err.detail || err.message || `Payment creation failed (${response.status})`);
        }

        const data = await response.json();
        if (data.tokens) {
          await authService.storeTokens(data.tokens);
        }
        if (data.user) {
          await authService.storeUserProfile(data.user);
        }

        return data;
      } catch (err: any) {
        lastError = err;
        if (attempt === 1) {
          // Brief pause before second attempt if server is waking up
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    const isNetworkErr =
      lastError?.name === 'AbortError' ||
      !lastError?.message ||
      lastError.message.includes('Network request failed') ||
      lastError.message.includes('Failed to fetch');

    if (isNetworkErr) {
      throw new Error(
        `Unable to connect to payment server at ${backendUrl}. The backend server may be waking up or your internet connection is unstable. Please tap Retry in a few seconds.`
      );
    }

    throw lastError;
  }

  /**
   * Opens ABA Mobile Bank app directly via deep link.
   */
  async openABAMobileApp(deeplink: string): Promise<boolean> {
    if (!deeplink) return false;
    try {
      const canOpen = await Linking.canOpenURL(deeplink);
      if (canOpen) {
        await Linking.openURL(deeplink);
        return true;
      } else {
        await Linking.openURL(deeplink);
        return true;
      }
    } catch (e) {
      console.warn('Could not launch ABA Mobile deeplink:', e);
      return false;
    }
  }

  /**
   * Polls payment status via backend verification endpoint until PAID or terminal state.
   */
  async pollPaymentStatus(
    paymentId: string,
    onStatusUpdate?: (status: PaymentStatusResponse) => void,
    maxWaitSeconds: number = 300,
    intervalMs: number = 2500
  ): Promise<PaymentStatusResponse> {
    const startTime = Date.now();
    const timeoutMs = maxWaitSeconds * 1000;
    const token = await authService.getValidAccessToken();
    const deviceId = await authService.getDeviceId();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const headers: Record<string, string> = {
          'X-Device-Id': deviceId,
        };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(
          `${authService.getBackendUrl()}/api/subscriptions/verify/${paymentId}`,
          {
            method: 'GET',
            headers,
          }
        );

        if (response.ok) {
          const res = await response.json();
          const statusRes: PaymentStatusResponse = {
            payment_id: paymentId,
            status: res.status,
            is_verified: res.success,
            paid_at: res.status === 'PAID' ? new Date().toISOString() : null,
            message: res.message,
          };

          if (onStatusUpdate) {
            onStatusUpdate(statusRes);
          }

          if (res.status === 'PAID') {
            return statusRes;
          }
          if (['FAILED', 'EXPIRED'].includes(res.status)) {
            return statusRes;
          }
        }
      } catch (err) {
        console.warn('Error polling status:', err);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('Payment status polling timed out.');
  }
}

export const centralPaymentClient = new CentralPaymentClient();
