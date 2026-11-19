import os
import uuid
import datetime
import logging
import requests
from typing import Dict, Any, Optional

logger = logging.getLogger("central_payment_client")

CENTRAL_PAYMENT_URL = os.environ.get(
    "CENTRAL_PAYMENT_API_URL",
    "https://threesaj-central-payment-staging.onrender.com/api/v1"
).rstrip("/")

STUDIO_APP_API_KEY = os.environ.get("STUDIO_APP_API_KEY")
if not STUDIO_APP_API_KEY:
    raise RuntimeError("STUDIO_APP_API_KEY environment variable is required. Please set it in your Render environment.")

def create_central_payment(
    amount: float,
    customer_reference: str,
    plan_code: str,
    plan_title: str
) -> Dict[str, Any]:
    """
    Calls Central Payment API to initiate an ABA KHQR payment session.
    Reuses existing central payment server without duplicate payment infrastructure.
    """
    endpoint = f"{CENTRAL_PAYMENT_URL}/payments"
    idempotency_key = f"studio_sub_{customer_reference}_{plan_code}_{int(datetime.datetime.now().timestamp() / 180)}"

    payload = {
        "amount": amount,
        "currency": "USD",
        "customer_reference": customer_reference,
        "payment_method": "abapay_khqr",
        "metadata": {
            "channel": "mobile_app",
            "app_code": "STUDIO_APP",
            "plan_code": plan_code,
            "plan_title": plan_title,
            "user_id": customer_reference
        }
    }

    headers = {
        "Content-Type": "application/json",
        "X-API-Key": STUDIO_APP_API_KEY,
        "Idempotency-Key": idempotency_key
    }

    try:
        res = requests.post(endpoint, json=payload, headers=headers, timeout=15)
        if res.status_code in (200, 201):
            return res.json()
        logger.error(f"Central payment error ({res.status_code}): {res.text}")
        raise RuntimeError(f"Payment gateway error: {res.text}")
    except requests.RequestException as e:
        logger.error(f"Central payment network failure: {e}")
        raise RuntimeError(f"Could not connect to payment gateway: {str(e)}")

def check_central_payment_status(payment_id: str) -> Dict[str, Any]:
    """Queries authoritative payment status from Central Payment API."""
    endpoint = f"{CENTRAL_PAYMENT_URL}/payments/{payment_id}"
    headers = {
        "X-API-Key": STUDIO_APP_API_KEY
    }

    try:
        res = requests.get(endpoint, headers=headers, timeout=10)
        if res.status_code == 200:
            return res.json()
        logger.warning(f"Payment status check returned {res.status_code}: {res.text}")
        return {"status": "UNKNOWN", "detail": res.text}
    except Exception as e:
        logger.error(f"Failed to query central payment status: {e}")
        return {"status": "NETWORK_ERROR", "error": str(e)}

def activate_paid_subscription(conn, payment_id: str, user_id: str, plan_code: str) -> Dict[str, Any]:
    """
    Activates or extends subscription for 30 days upon confirmed payment.
    Ensures zero duplicate subscriptions or activations.
    """
    with conn.cursor() as cur:
        # Check if already activated for this payment_id
        cur.execute(
            "SELECT id, plan_code, status, started_at, expires_at FROM subscriptions WHERE payment_id = %s;",
            (payment_id,)
        )
        existing_sub = cur.fetchone()
        if existing_sub:
            return {
                "activated": True,
                "already_active": True,
                "subscription": existing_sub
            }

        # Check existing active subscription for user (to extend if renewing early)
        now = datetime.datetime.now(datetime.timezone.utc)
        cur.execute(
            "SELECT id, expires_at, plan_code FROM subscriptions WHERE user_id = %s AND status = 'ACTIVE' ORDER BY expires_at DESC LIMIT 1;",
            (user_id,)
        )
        current_sub = cur.fetchone()

        base_time = now
        if current_sub and current_sub["expires_at"] and current_sub["expires_at"] > now:
            base_time = current_sub["expires_at"]

        expires_at = base_time + datetime.timedelta(days=30)
        new_sub_id = str(uuid.uuid4())

        cur.execute(
            """
            INSERT INTO subscriptions (id, user_id, plan_code, payment_id, status, started_at, expires_at, auto_renew, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'ACTIVE', %s, %s, FALSE, NOW(), NOW())
            RETURNING id, user_id, plan_code, payment_id, status, started_at, expires_at;
            """,
            (new_sub_id, user_id, plan_code, payment_id, now, expires_at)
        )
        new_sub = cur.fetchone()
        conn.commit()

        return {
            "activated": True,
            "already_active": False,
            "subscription": new_sub
        }
