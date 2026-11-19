import os
import re
import json
import uuid
import datetime
import logging
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, Header, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
import requests
import yt_dlp

from database import get_db_connection
from auth import (
    hash_password,
    verify_password,
    create_tokens,
    verify_token,
    hash_token,
    get_current_user_and_device,
    register_device_session,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS
)
from central_payment import (
    create_central_payment,
    check_central_payment_status,
    activate_paid_subscription,
    CENTRAL_PAYMENT_URL,
    STUDIO_APP_API_KEY
)
from usage import (
    get_cambodia_now,
    get_cambodia_today,
    get_seconds_until_midnight_cambodia,
    get_user_active_subscription,
    get_user_today_usage,
    check_and_reserve_quota,
    commit_quota_deduction
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("3saj-backend")

app = FastAPI(
    title="3SAJ Studio API",
    description="Unified Backend API for 3SAJ Studio: Auth, Device Management, Subscriptions, ABA Central Payment, Usage Enforcement, and Video Extraction.",
    version="2.0.0"
)

# Enable CORS for mobile app, web, and emulator access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# SCHEMAS
# ==============================================================================

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None
    device_id: str
    device_name: Optional[str] = "Android Device"
    platform: Optional[str] = "android"

class LoginRequest(BaseModel):
    email: str
    password: str
    device_id: str
    device_name: Optional[str] = "Android Device"
    platform: Optional[str] = "android"

class GoogleAuthRequest(BaseModel):
    email: str
    google_id: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    device_id: str
    device_name: Optional[str] = "Android Device"
    platform: Optional[str] = "android"

class RefreshTokenRequest(BaseModel):
    refresh_token: str
    device_id: str

class LogoutRequest(BaseModel):
    device_id: Optional[str] = None

class RevokeDeviceRequest(BaseModel):
    device_id: str

class ResetPasswordRequest(BaseModel):
    email: str
    new_password: str

class CheckoutRequest(BaseModel):
    plan_code: str  # FLASH, PRO, PRO_MAX, UNLIMITED
    device_id: Optional[str] = None
    device_name: Optional[str] = None
    platform: Optional[str] = "android"

class ReserveQuotaRequest(BaseModel):
    video_duration_seconds: int
    idempotency_token: str
    project_id: Optional[str] = None

class CommitQuotaRequest(BaseModel):
    idempotency_token: str

class ExtractRequest(BaseModel):
    url: str

class ExtractResponse(BaseModel):
    title: str
    videoUrl: str
    srtContent: Optional[str] = None
    srtUrl: Optional[str] = None
    thumbnailUrl: Optional[str] = None
    durationSeconds: Optional[int] = None

# ==============================================================================
# HEALTH & CONFIG
# ==============================================================================

@app.get("/")
@app.get("/health")
def health_check():
    return {
        "status": "online",
        "service": "3SAJ Studio Unified Backend",
        "version": "2.0.0",
        "central_payment_url": CENTRAL_PAYMENT_URL,
        "features": [
            "auth",
            "devices_max_2",
            "subscriptions",
            "aba_khqr_payments",
            "quota_enforcement",
            "video_extraction"
        ]
    }

# ==============================================================================
# AUTHENTICATION ENDPOINTS
# ==============================================================================

@app.post("/api/auth/register")
def register_user(req: RegisterRequest):
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not req.device_id:
        raise HTTPException(status_code=400, detail="Device ID is required")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Check if user email already exists
            cur.execute("SELECT id FROM users WHERE email = %s;", (email,))
            existing = cur.fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="An account with this email already exists. Please log in.")

            # Create user
            user_id = str(uuid.uuid4())
            pw_hash = hash_password(req.password)
            cur.execute(
                """
                INSERT INTO users (id, email, hashed_password, full_name, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, TRUE, NOW(), NOW())
                RETURNING id, email, full_name;
                """,
                (user_id, email, pw_hash, req.full_name or email.split("@")[0])
            )
            user = cur.fetchone()

            # Record local auth identity
            cur.execute(
                """
                INSERT INTO user_auth_identities (id, user_id, provider, provider_user_id, provider_email, created_at)
                VALUES (%s, %s, 'local', %s, %s, NOW());
                """,
                (str(uuid.uuid4()), user_id, email, email)
            )
            conn.commit()

        # Generate tokens
        tokens = create_tokens(user_id, email, req.device_id)

        # Register device session (enforcing max 2 devices)
        device = register_device_session(
            conn=conn,
            user_id=user_id,
            device_id=req.device_id,
            device_name=req.device_name or "Android Device",
            platform=req.platform or "android",
            refresh_token=tokens["refresh_token"]
        )

        return {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "full_name": user["full_name"]
            },
            "device": device,
            "tokens": tokens
        }

@app.post("/api/auth/login")
def login_user(req: LoginRequest):
    email = req.email.strip().lower()
    if not req.device_id:
        raise HTTPException(status_code=400, detail="Device ID is required")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, email, hashed_password, full_name, is_active FROM users WHERE email = %s;",
                (email,)
            )
            user = cur.fetchone()
            if not user or not user["hashed_password"]:
                raise HTTPException(status_code=401, detail="Invalid email or password")

            if not verify_password(req.password, user["hashed_password"]):
                raise HTTPException(status_code=401, detail="Invalid email or password")

            if not user["is_active"]:
                raise HTTPException(status_code=403, detail="User account is suspended")

        user_id = user["id"]
        tokens = create_tokens(user_id, email, req.device_id)

        # Register device session (enforcing max 2 devices)
        device = register_device_session(
            conn=conn,
            user_id=user_id,
            device_id=req.device_id,
            device_name=req.device_name or "Android Device",
            platform=req.platform or "android",
            refresh_token=tokens["refresh_token"]
        )

        # Load active subscription
        subscription = get_user_active_subscription(conn, user_id)

        return {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "full_name": user["full_name"]
            },
            "device": device,
            "tokens": tokens,
            "subscription": subscription
        }

@app.post("/api/auth/google")
def google_auth(req: GoogleAuthRequest):
    """
    Google OAuth login & registration with secure account linking.
    Resolves to the same internal user account if email already exists.
    """
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid Google email required")
    if not req.google_id:
        raise HTTPException(status_code=400, detail="Google User ID required")
    if not req.device_id:
        raise HTTPException(status_code=400, detail="Device ID is required")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 1. Check if identity already linked
            cur.execute(
                "SELECT user_id FROM user_auth_identities WHERE provider = 'google' AND provider_user_id = %s;",
                (req.google_id,)
            )
            identity = cur.fetchone()

            if identity:
                user_id = identity["user_id"]
                cur.execute("SELECT id, email, full_name, is_active FROM users WHERE id = %s;", (user_id,))
                user = cur.fetchone()
            else:
                # 2. Check if user already exists by email
                cur.execute("SELECT id, email, full_name, is_active FROM users WHERE email = %s;", (email,))
                user = cur.fetchone()

                if user:
                    user_id = user["id"]
                    # Link Google identity to existing account
                    cur.execute(
                        """
                        INSERT INTO user_auth_identities (id, user_id, provider, provider_user_id, provider_email, created_at)
                        VALUES (%s, %s, 'google', %s, %s, NOW())
                        ON CONFLICT (provider, provider_user_id) DO NOTHING;
                        """,
                        (str(uuid.uuid4()), user_id, req.google_id, email)
                    )
                else:
                    # 3. Create new user account
                    user_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO users (id, email, full_name, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, TRUE, NOW(), NOW())
                        RETURNING id, email, full_name;
                        """,
                        (user_id, email, req.full_name or email.split("@")[0])
                    )
                    user = cur.fetchone()

                    # Link Google identity
                    cur.execute(
                        """
                        INSERT INTO user_auth_identities (id, user_id, provider, provider_user_id, provider_email, created_at)
                        VALUES (%s, %s, 'google', %s, %s, NOW());
                        """,
                        (str(uuid.uuid4()), user_id, req.google_id, email)
                    )
            conn.commit()

        if not user or not user["is_active"]:
            raise HTTPException(status_code=403, detail="User account is suspended")

        tokens = create_tokens(user_id, email, req.device_id)

        # Register device session (enforces max 2 devices)
        device = register_device_session(
            conn=conn,
            user_id=user_id,
            device_id=req.device_id,
            device_name=req.device_name or "Android Device",
            platform=req.platform or "android",
            refresh_token=tokens["refresh_token"]
        )

        subscription = get_user_active_subscription(conn, user_id)

        return {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "full_name": user["full_name"]
            },
            "device": device,
            "tokens": tokens,
            "subscription": subscription
        }

@app.post("/api/auth/refresh")
def refresh_access_token(req: RefreshTokenRequest):
    """Exchanges a valid refresh token for a fresh access token."""
    payload = verify_token(req.refresh_token, expected_type="refresh")
    user_id = payload.get("sub")
    device_id = payload.get("device_id")

    if device_id != req.device_id:
        raise HTTPException(status_code=401, detail="Device mismatch on refresh token")

    token_hash = hash_token(req.refresh_token)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, is_active FROM users WHERE id = %s;", (user_id,))
            user = cur.fetchone()
            if not user or not user["is_active"]:
                raise HTTPException(status_code=401, detail="User inactive or not found")

            # Validate refresh token hash matches stored device token
            cur.execute(
                "SELECT id, is_active FROM user_devices WHERE user_id = %s AND device_id = %s AND refresh_token_hash = %s;",
                (user_id, device_id, token_hash)
            )
            device = cur.fetchone()
            if not device or not device["is_active"]:
                raise HTTPException(status_code=401, detail="Session expired or revoked on this device")

            # Update last_active_at
            cur.execute(
                "UPDATE user_devices SET last_active_at = NOW() WHERE user_id = %s AND device_id = %s;",
                (user_id, device_id)
            )
            conn.commit()

    tokens = create_tokens(user_id, user["email"], device_id)
    return tokens

@app.post("/api/auth/logout")
def logout_user(req: LogoutRequest, current=Depends(get_current_user_and_device)):
    """Logs out and revokes session for the current device."""
    user_id = current["user_id"]
    device_id = req.device_id or current["device_id"]

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE user_devices SET is_active = FALSE, refresh_token_hash = NULL WHERE user_id = %s AND device_id = %s;",
                (user_id, device_id)
            )
            conn.commit()

    return {"success": True, "message": "Successfully logged out device."}

@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    email = req.email.strip().lower()
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s;", (email,))
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="No account found with this email")

            pw_hash = hash_password(req.new_password)
            cur.execute(
                "UPDATE users SET hashed_password = %s, updated_at = NOW() WHERE id = %s;",
                (pw_hash, user["id"])
            )
            # Revoke all device sessions on password reset for security
            cur.execute(
                "UPDATE user_devices SET is_active = FALSE, refresh_token_hash = NULL WHERE user_id = %s;",
                (user["id"],)
            )
            conn.commit()

    return {"success": True, "message": "Password reset successfully. Please sign in with your new password."}

@app.get("/api/auth/me")
def get_current_user_profile(current=Depends(get_current_user_and_device)):
    """Returns current user account, device, and active subscription info."""
    user_id = current["user_id"]
    with get_db_connection() as conn:
        sub = get_user_active_subscription(conn, user_id)
        usage = get_user_today_usage(conn, user_id)

    return {
        "user": current,
        "subscription": sub,
        "usage_today": usage
    }

# ==============================================================================
# DEVICE MANAGEMENT ENDPOINTS
# ==============================================================================

@app.get("/api/devices")
def list_user_devices(current=Depends(get_current_user_and_device)):
    """Returns all registered devices for the current user."""
    user_id = current["user_id"]
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, device_id, device_name, platform, is_active, last_active_at, created_at
                FROM user_devices
                WHERE user_id = %s
                ORDER BY last_active_at DESC;
                """,
                (user_id,)
            )
            rows = cur.fetchall()

    devices = [
        {
            "id": r["id"],
            "device_id": r["device_id"],
            "device_name": r["device_name"],
            "platform": r["platform"],
            "is_active": r["is_active"],
            "is_current": r["device_id"] == current["device_id"],
            "last_active_at": r["last_active_at"].isoformat() if r["last_active_at"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]
    return {"devices": devices, "max_allowed": 2}

@app.post("/api/devices/revoke")
def revoke_remote_device(req: RevokeDeviceRequest, current=Depends(get_current_user_and_device)):
    """Revokes an active device remotely so a new device can be logged in."""
    user_id = current["user_id"]
    target_device_id = req.device_id.strip()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE user_devices
                SET is_active = FALSE, refresh_token_hash = NULL
                WHERE user_id = %s AND device_id = %s
                RETURNING id, device_name;
                """,
                (user_id, target_device_id)
            )
            revoked = cur.fetchone()
            conn.commit()

    if not revoked:
        raise HTTPException(status_code=404, detail="Device not found or already revoked")

    return {
        "success": True,
        "message": f"Device '{revoked['device_name']}' has been logged out successfully.",
        "revoked_device_id": target_device_id
    }

# ==============================================================================
# PLANS & SUBSCRIPTIONS (ABA CENTRAL PAYMENT)
# ==============================================================================

@app.get("/api/plans")
def list_plans():
    """Lists available subscription plans."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT code, name, price_usd, daily_minute_limit, max_devices FROM plans ORDER BY price_usd ASC;")
            rows = cur.fetchall()
    return {"plans": rows}

@app.get("/api/subscriptions/current")
def get_current_subscription(current=Depends(get_current_user_and_device)):
    """Restores plan, expiration, and remaining quota from PostgreSQL."""
    user_id = current["user_id"]
    with get_db_connection() as conn:
        sub = get_user_active_subscription(conn, user_id)
        usage = get_user_today_usage(conn, user_id)

    return {
        "has_active_subscription": sub is not None,
        "subscription": sub,
        "usage_today": usage
    }

@app.post("/api/subscriptions/checkout")
def create_subscription_checkout(
    req: CheckoutRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Creates an ABA KHQR payment session via Central Payment API.
    Supports both logged-in users and anonymous/guest users seamlessly.
    Returns dynamic KHQR QR string, QR base64 image, and ABA Mobile app deeplink.
    """
    user_id = None
    tokens = None
    user_info = None

    if authorization and authorization.startswith("Bearer "):
        try:
            token = authorization.split(" ")[1]
            payload = verify_token(token, expected_type="access")
            user_id = payload.get("sub")
        except Exception as e:
            logger.warning(f"Checkout token extraction warning: {e}")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # If not authenticated, bind or create persistent guest user based on device_id
            if not user_id:
                clean_device_id = req.device_id or f"guest_dev_{uuid.uuid4().hex[:12]}"
                # Check if device is already registered
                cur.execute(
                    "SELECT user_id FROM user_devices WHERE device_id = %s AND is_active = TRUE ORDER BY last_active_at DESC LIMIT 1;",
                    (clean_device_id,)
                )
                dev_row = cur.fetchone()
                if dev_row:
                    user_id = dev_row["user_id"]
                    cur.execute("SELECT id, email, full_name FROM users WHERE id = %s;", (user_id,))
                    user_info = cur.fetchone()
                else:
                    user_id = str(uuid.uuid4())
                    guest_email = f"guest_{clean_device_id[:16]}@device.3saj.app"
                    guest_name = req.device_name or "Android User"
                    cur.execute(
                        """
                        INSERT INTO users (id, email, full_name, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, TRUE, NOW(), NOW())
                        RETURNING id, email, full_name;
                        """,
                        (user_id, guest_email, guest_name)
                    )
                    user_info = cur.fetchone()

                # Generate access tokens for this device
                tokens = create_tokens(user_id, user_info["email"] if user_info else f"guest_{clean_device_id[:8]}", clean_device_id)
                register_device_session(
                    conn=conn,
                    user_id=user_id,
                    device_id=clean_device_id,
                    device_name=req.device_name or "Android Device",
                    platform=req.platform or "android",
                    refresh_token=tokens["refresh_token"]
                )

            plan_code = req.plan_code.upper().strip()
            cur.execute("SELECT code, name, price_usd FROM plans WHERE code = %s;", (plan_code,))
            plan = cur.fetchone()
            if not plan:
                raise HTTPException(status_code=404, detail=f"Plan '{plan_code}' not found")

            amount = float(plan["price_usd"])

    # Call Central Payment API (reusing existing central payment server)
    try:
        payment_data = create_central_payment(
            amount=amount,
            customer_reference=user_id,
            plan_code=plan_code,
            plan_title=plan["name"]
        )
    except Exception as e:
        logger.error(f"Failed to initiate central payment: {e}")
        raise HTTPException(status_code=502, detail=f"Central payment gateway error: {str(e)}")

    resp = {
        "payment_id": payment_data.get("payment_id") or payment_data.get("id"),
        "transaction_id": payment_data.get("transaction_id"),
        "amount": amount,
        "currency": "USD",
        "plan_code": plan_code,
        "plan_name": plan["name"],
        "qr_string": payment_data.get("qr_string"),
        "qr_image": payment_data.get("qr_image"),
        "abapay_deeplink": payment_data.get("abapay_deeplink"),
        "expires_at": payment_data.get("expires_at")
    }

    if tokens:
        resp["tokens"] = tokens
    if user_info:
        resp["user"] = {
            "id": user_info["id"],
            "email": user_info["email"],
            "full_name": user_info["full_name"]
        }

    return resp

@app.get("/api/subscriptions/verify/{payment_id}")
def verify_and_activate_subscription(
    payment_id: str,
    authorization: Optional[str] = Header(None)
):
    """
    Polls Central Payment API for payment status.
    If PAID, immediately activates 30-day subscription for the user in PostgreSQL.
    """
    user_id = None
    if authorization and authorization.startswith("Bearer "):
        try:
            token = authorization.split(" ")[1]
            payload = verify_token(token, expected_type="access")
            user_id = payload.get("sub")
        except Exception:
            pass

    # 1. Query Central Payment authoritative status
    payment_status = check_central_payment_status(payment_id)
    raw_status = payment_status.get("status")

    if raw_status in ("PAID", "COMPLETED"):
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if not user_id:
                    # Look up customer_reference from payments table or Central Payment response
                    cur.execute(
                        "SELECT customer_reference FROM payments WHERE id = %s OR transaction_id = %s;",
                        (payment_id, payment_id)
                    )
                    pay_row = cur.fetchone()
                    if pay_row and pay_row["customer_reference"]:
                        user_id = pay_row["customer_reference"]
                    else:
                        user_id = payment_status.get("customer_reference")

            if not user_id:
                raise HTTPException(status_code=400, detail="Cannot associate payment with a user account")

            # Extract plan_code from metadata, or accurately resolve from payment amount
            metadata = payment_status.get("metadata") or {}
            plan_code = metadata.get("plan_code")
            if not plan_code and payment_status.get("amount") is not None:
                amt = float(payment_status["amount"])
                if amt >= 14.0:
                    plan_code = "UNLIMITED"
                elif amt >= 9.5:
                    plan_code = "PRO_MAX"
                elif amt >= 7.5:
                    plan_code = "PRO"
                elif amt >= 4.5:
                    plan_code = "FLASH"
            if not plan_code:
                plan_code = "PRO"

            # Activate subscription
            activation_result = activate_paid_subscription(
                conn=conn,
                payment_id=payment_id,
                user_id=user_id,
                plan_code=plan_code
            )
            current_sub = get_user_active_subscription(conn, user_id)

        return {
            "success": True,
            "status": "PAID",
            "message": "Payment verified and subscription activated successfully!",
            "activation": activation_result,
            "subscription": current_sub
        }
    elif raw_status in ("FAILED", "EXPIRED"):
        return {
            "success": False,
            "status": raw_status,
            "message": f"Payment {raw_status.lower()}. Please try again."
        }
    else:
        return {
            "success": False,
            "status": "PENDING",
            "message": "Payment is still pending. Awaiting confirmation from ABA PayWay."
        }

@app.get("/api/subscriptions/history")
def get_subscription_history(current=Depends(get_current_user_and_device)):
    """Returns payment and subscription history for user."""
    user_id = current["user_id"]
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.plan_code, p.name AS plan_name, p.price_usd, s.payment_id,
                       s.status, s.started_at, s.expires_at, s.created_at
                FROM subscriptions s
                JOIN plans p ON s.plan_code = p.code
                WHERE s.user_id = %s
                ORDER BY s.created_at DESC;
                """,
                (user_id,)
            )
            rows = cur.fetchall()

    history = [
        {
            "id": r["id"],
            "plan_code": r["plan_code"],
            "plan_name": r["plan_name"],
            "price_usd": r["price_usd"],
            "payment_id": r["payment_id"],
            "status": r["status"],
            "started_at": r["started_at"].isoformat() if r["started_at"] else None,
            "expires_at": r["expires_at"].isoformat() if r["expires_at"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]
    return {"history": history}

# ==============================================================================
# USAGE & QUOTA ENFORCEMENT ENDPOINTS
# ==============================================================================

@app.get("/api/usage/today")
def get_daily_usage(current=Depends(get_current_user_and_device)):
    """Retrieves usage recorded today for the user in Cambodia time (Asia/Phnom_Penh)."""
    user_id = current["user_id"]
    with get_db_connection() as conn:
        sub = get_user_active_subscription(conn, user_id)
        usage = get_user_today_usage(conn, user_id)

    daily_limit = sub["daily_minute_limit"] if sub else 0
    minutes_used = usage["minutes_used"]
    remaining = max(0.0, round(daily_limit - minutes_used, 1)) if daily_limit is not None else None

    return {
        "date": usage["date"],
        "plan_code": sub["plan_code"] if sub else None,
        "daily_limit_minutes": daily_limit,
        "minutes_used": minutes_used,
        "minutes_remaining": remaining,
        "seconds_until_midnight_reset": usage["seconds_until_reset"],
        "is_unlimited": sub["is_unlimited"] if sub else False
    }

@app.post("/api/usage/reserve")
def reserve_quota(req: ReserveQuotaRequest, current=Depends(get_current_user_and_device)):
    """
    Validates user's entitlement and reserves translation quota server-side.
    Enforces daily quota reset at midnight Cambodia time.
    Prevents duplicate usage deductions via idempotency token.
    """
    user_id = current["user_id"]
    with get_db_connection() as conn:
        result = check_and_reserve_quota(
            conn=conn,
            user_id=user_id,
            video_duration_seconds=req.video_duration_seconds,
            idempotency_token=req.idempotency_token,
            project_id=req.project_id
        )
    return result

@app.post("/api/usage/commit")
def commit_quota(req: CommitQuotaRequest, current=Depends(get_current_user_and_device)):
    """
    Commits usage deduction upon successful translation completion.
    Idempotent: guarantees single deduction even if client retries.
    """
    user_id = current["user_id"]
    with get_db_connection() as conn:
        result = commit_quota_deduction(
            conn=conn,
            user_id=user_id,
            idempotency_token=req.idempotency_token
        )
    return result

# ==============================================================================
# VIDEO & SUBTITLE EXTRACTION (yt-dlp)
# ==============================================================================

def convert_vtt_to_srt(vtt_text: str) -> str:
    """Converts WebVTT format text to standard SRT format."""
    lines = vtt_text.splitlines()
    srt_lines = []
    counter = 1
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("WEBVTT") or line.startswith("NOTE") or not line:
            i += 1
            continue
        break

    time_pattern = re.compile(
        r"(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})"
    )

    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        match = time_pattern.search(line)
        if match:
            parts = line.split("-->")
            start = parts[0].strip().split()[0].replace(".", ",")
            end = parts[1].strip().split()[0].replace(".", ",")

            if start.count(":") == 1:
                start = "00:" + start
            if end.count(":") == 1:
                end = "00:" + end

            srt_lines.append(str(counter))
            srt_lines.append(f"{start} --> {end}")
            counter += 1

            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                clean_text = re.sub(r"<[^>]+>", "", lines[i].strip())
                if clean_text:
                    text_lines.append(clean_text)
                i += 1

            srt_lines.append("\n".join(text_lines))
            srt_lines.append("")
        else:
            i += 1

    return "\n".join(srt_lines)

@app.post("/extract", response_model=ExtractResponse)
def extract_media(req: ExtractRequest):
    raw_url = req.url.strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="Video URL is required")

    if raw_url.lower().endswith(".mp4"):
        file_name = raw_url.split("/")[-1].replace(".mp4", "")
        return ExtractResponse(
            title=file_name or "Direct_Video",
            videoUrl=raw_url,
            srtContent="1\n00:00:01,000 --> 00:00:05,000\n[Direct Video - Enter dialogue to translate]\n\n"
        )

    ydl_opts = {
        "format": "best[ext=mp4]/best",
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(raw_url, download=False)
    except Exception as e:
        logger.error(f"yt-dlp extraction error for {raw_url}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract media: {str(e)}")

    if not info:
        raise HTTPException(status_code=404, detail="No media information found for this URL.")

    if "entries" in info:
        entries = list(info.get("entries", []))
        if entries and entries[0]:
            info = entries[0]
        else:
            raise HTTPException(status_code=404, detail="No videos found in playlist.")

    title = info.get("title") or "Imported_Video"
    duration = info.get("duration")
    thumbnail = info.get("thumbnail")

    video_url = None
    formats = info.get("formats", [])

    progressive_mp4s = [
        f for f in formats
        if f.get("ext") == "mp4"
        and f.get("vcodec") != "none"
        and f.get("acodec") != "none"
        and f.get("url")
    ]
    if progressive_mp4s:
        progressive_mp4s.sort(key=lambda x: x.get("height") or 0, reverse=True)
        video_url = progressive_mp4s[0].get("url")

    if not video_url:
        combined = [
            f for f in formats
            if f.get("vcodec") != "none"
            and f.get("acodec") != "none"
            and f.get("url")
        ]
        if combined:
            combined.sort(key=lambda x: x.get("height") or 0, reverse=True)
            video_url = combined[0].get("url")

    if not video_url:
        video_url = info.get("url")

    if not video_url:
        raise HTTPException(status_code=500, detail="Could not resolve downloadable video stream URL.")

    srt_content = None
    subtitles = info.get("subtitles") or {}
    auto_captions = info.get("automatic_captions") or {}

    candidate_subs = None
    for lang in ["zh-Hans", "zh-Hant", "zh", "en", "km"]:
        if lang in subtitles:
            candidate_subs = subtitles[lang]
            break
    if not candidate_subs:
        if subtitles:
            first_lang = next(iter(subtitles))
            candidate_subs = subtitles[first_lang]

    if not candidate_subs:
        for lang in ["zh-Hans", "zh", "en", "km"]:
            if lang in auto_captions:
                candidate_subs = auto_captions[lang]
                break
        if not candidate_subs and auto_captions:
            first_lang = next(iter(auto_captions))
            candidate_subs = auto_captions[first_lang]

    if candidate_subs:
        vtt_entry = next((s for s in candidate_subs if s.get("ext") == "vtt"), None)
        srt_entry = next((s for s in candidate_subs if s.get("ext") == "srt"), None)
        target_sub = srt_entry or vtt_entry or candidate_subs[0]

        if target_sub and target_sub.get("url"):
            try:
                sub_res = requests.get(target_sub["url"], timeout=10)
                if sub_res.status_code == 200:
                    raw_sub = sub_res.text
                    if target_sub.get("ext") == "vtt" or "WEBVTT" in raw_sub:
                        srt_content = convert_vtt_to_srt(raw_sub)
                    else:
                        srt_content = raw_sub
            except Exception as e:
                logger.warning(f"Failed to download subtitles: {e}")

    if not srt_content:
        srt_content = (
            "1\n00:00:00,500 --> 00:00:05,000\n[Dialogue 1 - Tap to edit or translate]\n\n"
        )

    return ExtractResponse(
        title=title,
        videoUrl=video_url,
        srtContent=srt_content,
        thumbnailUrl=thumbnail,
        durationSeconds=duration
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
