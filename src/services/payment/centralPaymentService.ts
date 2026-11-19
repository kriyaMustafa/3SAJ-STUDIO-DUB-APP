/**
 * 3SAJ Studio App — Central Payment Integration Service
 * Connects directly to 3SAJ Central Payment Gateway (D:\PROJECT\3saj-central-payment)
 * Handles ABA KHQR dynamic QR generation, ABA Mobile App deeplinking, and real-time status polling.
 */

import { Linking, Platform } from 'react-native';

export const CENTRAL_PAYMENT_DEFAULT_URL = 'https://threesaj-central-payment-staging.onrender.com/api/v1';
export const STUDIO_APP_DEFAULT_API_KEY = 'saj_live_studioapp_f7a9c8b2e1d4039586172a3b4c5d6e7f8a9b0c1d2e3f4a5b';

export interface PaymentInitParams {
  amount: number;
  customerReference: string; // user_id or unique account reference
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
  qr_image: string | null; // Base64 encoded PNG data URI or raw image
  abapay_deeplink: string | null; // abamobilebank://...
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
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string = STUDIO_APP_DEFAULT_API_KEY, baseUrl: string = CENTRAL_PAYMENT_DEFAULT_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Creates a payment session with 3SAJ Central Payment API and returns dynamic KHQR + deeplink.
   */
  async createPayment(params: PaymentInitParams): Promise<PaymentSessionResponse> {
    const idempotencyKey = `studio_app_${params.customerReference}_${params.planCode}_${Date.now()}`;
    const endpoint = `${this.baseUrl}/payments`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency || 'USD',
        customer_reference: params.customerReference,
        payment_method: 'abapay_khqr',
        metadata: {
          channel: 'mobile_app',
          app_code: 'STUDIO_APP',
          platform: Platform.OS,
          plan_code: params.planCode,
          plan_title: params.planTitle,
          user_id: params.customerReference,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Network request failed' }));
      throw new Error(err.detail || err.message || `Payment creation failed (${response.status})`);
    }

    const data = await response.json();
    return {
      payment_id: data.payment_id || data.id,
      transaction_id: data.transaction_id,
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      qr_string: data.qr_string,
      qr_image: data.qr_image,
      abapay_deeplink: data.abapay_deeplink,
      expires_at: data.expires_at,
    };
  }

  /**
   * Opens ABA Mobile Bank app directly via deep link if installed on device.
   * Falls back to returning false if deep link cannot be handled.
   */
  async openABAMobileApp(deeplink: string): Promise<boolean> {
    if (!deeplink) return false;
    try {
      const canOpen = await Linking.canOpenURL(deeplink);
      if (canOpen) {
        await Linking.openURL(deeplink);
        return true;
      } else {
        // Fallback: try opening directly anyway
        await Linking.openURL(deeplink);
        return true;
      }
    } catch (e) {
      console.warn('Could not launch ABA Mobile deeplink:', e);
      return false;
    }
  }

  /**
   * Polls payment status from 3SAJ Central Payment API until terminal state or timeout.
   */
  async pollPaymentStatus(
    paymentId: string,
    onStatusUpdate?: (status: PaymentStatusResponse) => void,
    maxWaitSeconds: number = 300,
    intervalMs: number = 2500
  ): Promise<PaymentStatusResponse> {
    const startTime = Date.now();
    const timeoutMs = maxWaitSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`${this.baseUrl}/payments/${paymentId}`, {
          method: 'GET',
          headers: {
            'X-API-Key': this.apiKey,
          },
        });

        if (response.ok) {
          const statusRes: PaymentStatusResponse = await response.json();
          if (onStatusUpdate) {
            onStatusUpdate(statusRes);
          }

          if (statusRes.status === 'PAID') {
            return statusRes;
          }
          if (['FAILED', 'EXPIRED', 'PAID_MISMATCH_MANUAL_REVIEW', 'PAID_LATE_MANUAL_REVIEW'].includes(statusRes.status)) {
            return statusRes;
          }
        }
      } catch (err) {
        console.warn('Error polling central payment status:', err);
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Payment status polling timed out.');
  }
}

export const centralPaymentClient = new CentralPaymentClient();
