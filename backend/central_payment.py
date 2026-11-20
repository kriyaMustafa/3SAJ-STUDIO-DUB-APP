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

def activate_paid_subscription(conn, payment_id: str, user_id: str, plan_code: str = "PRO") -> Dict[str, Any]:
    """
    Activates or upgrades subscription for 30 days upon confirmed payment.
    Accurately identifies plan from payment amount or metadata.
    Handles upgrades immediately by superseding lower tier plans.
    """
    with conn.cursor() as cur:
        # Resolve authoritative payment row from PostgreSQL payments table (lookup by UUID or tran_id)
        cur.execute(
            """
            SELECT id, amount, extra_metadata
            FROM payments
            WHERE id = %s OR transaction_id = %s;
            """,
            (payment_id, payment_id)
        )
        payment_row = cur.fetchone()
        payment_id_to_store = payment_row["id"] if payment_row else None
        real_plan_code = plan_code

        if payment_row:
            meta = payment_row.get("extra_metadata") or {}
            if isinstance(meta, str):
                try:
                    import json
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            if isinstance(meta, dict) and meta.get("plan_code"):
                real_plan_code = str(meta.get("plan_code")).upper().strip()
            elif payment_row.get("amount") is not None:
                amt = float(payment_row["amount"])
                if amt >= 14.0:
                    real_plan_code = "UNLIMITED"
                elif amt >= 9.5:
                    real_plan_code = "PRO_MAX"
                elif amt >= 7.5:
                    real_plan_code = "PRO"
                elif amt >= 4.5:
                    real_plan_code = "FLASH"

        # Validate that plan_code exists in plans table
        cur.execute("SELECT code, name, price_usd, daily_minute_limit FROM plans WHERE code = %s;", (real_plan_code,))
        plan_meta = cur.fetchone()
        if not plan_meta:
            real_plan_code = plan_code or "FLASH"

        # Check if already activated for this payment_id or payment_row["id"]
        if payment_id_to_store:
            cur.execute(
                """
                SELECT id, plan_code, status, started_at, expires_at
                FROM subscriptions
                WHERE payment_id = %s OR payment_id = %s;
                """,
                (payment_id, payment_id_to_store)
            )
        else:
            cur.execute(
                """
                SELECT id, plan_code, status, started_at, expires_at
                FROM subscriptions
                WHERE payment_id = %s;
                """,
                (payment_id,)
            )
        existing_sub = cur.fetchone()
        if existing_sub:
            # If the plan_code on the existing subscription doesn't match real_plan_code, update it
            if existing_sub["plan_code"] != real_plan_code:
                cur.execute(
                    """
                    UPDATE subscriptions
                    SET plan_code = %s, status = 'ACTIVE', updated_at = NOW()
                    WHERE id = %s
                    RETURNING id, user_id, plan_code, payment_id, status, started_at, expires_at;
                    """,
                    (real_plan_code, existing_sub["id"])
                )
                existing_sub = cur.fetchone()
                # Supersede other older active subscriptions for this user
                cur.execute(
                    """
                    UPDATE subscriptions
                    SET status = 'UPGRADED', updated_at = NOW()
                    WHERE user_id = %s AND id != %s AND status = 'ACTIVE';
                    """,
                    (user_id, existing_sub["id"])
                )
                conn.commit()
            return {
                "activated": True,
                "already_active": True,
                "subscription": existing_sub
            }

        now = datetime.datetime.now(datetime.timezone.utc)
        cur.execute(
            """
            SELECT id, expires_at, plan_code
            FROM subscriptions
            WHERE user_id = %s AND status = 'ACTIVE'
            ORDER BY expires_at DESC
            LIMIT 1;
            """,
            (user_id,)
        )
        current_sub = cur.fetchone()

        # If user is upgrading or changing plan, supersede previous active subscriptions
        is_upgrade = current_sub and current_sub["plan_code"] != real_plan_code
        if is_upgrade:
            cur.execute(
                """
                UPDATE subscriptions
                SET status = 'UPGRADED', updated_at = NOW()
                WHERE user_id = %s AND status = 'ACTIVE';
                """,
                (user_id,)
            )

        base_time = now
        # If renewing the SAME plan before expiry, extend from current expiry
        if not is_upgrade and current_sub and current_sub["expires_at"] and current_sub["expires_at"] > now:
            base_time = current_sub["expires_at"]

        expires_at = base_time + datetime.timedelta(days=30)
        new_sub_id = str(uuid.uuid4())

        cur.execute(
            """
            INSERT INTO subscriptions (id, user_id, plan_code, payment_id, status, started_at, expires_at, auto_renew, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'ACTIVE', %s, %s, FALSE, NOW(), NOW())
            RETURNING id, user_id, plan_code, payment_id, status, started_at, expires_at;
            """,
            (new_sub_id, user_id, real_plan_code, payment_id_to_store, now, expires_at)
        )
        new_sub = cur.fetchone()
        conn.commit()

        return {
            "activated": True,
            "already_active": False,
            "is_upgrade": is_upgrade,
            "subscription": new_sub
        }
