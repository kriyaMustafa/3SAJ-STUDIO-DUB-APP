import os
import hashlib
import uuid
import datetime
from typing import Optional, Dict, Any, List
import bcrypt
import jwt
from fastapi import HTTPException, status, Header, Depends
from database import get_db_connection

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is required. Please set it in your Render environment.")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours access token
REFRESH_TOKEN_EXPIRE_DAYS = 30  # 30 days refresh token

def hash_password(password: str) -> str:
    """Hashes a password with bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against the bcrypt hash."""
    if not hashed_password:
        return False
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def hash_token(token: str) -> str:
    """SHA-256 hash for storing refresh tokens safely."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def create_tokens(user_id: str, email: str, device_id: str) -> Dict[str, Any]:
    """Generates access and refresh tokens for a user and device session."""
    now = datetime.datetime.now(datetime.timezone.utc)
    access_exp = now + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_exp = now + datetime.timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    access_payload = {
        "sub": user_id,
        "email": email,
        "device_id": device_id,
        "type": "access",
        "exp": int(access_exp.timestamp()),
        "iat": int(now.timestamp())
    }
    refresh_payload = {
        "sub": user_id,
        "device_id": device_id,
        "type": "refresh",
        "exp": int(refresh_exp.timestamp()),
        "iat": int(now.timestamp())
    }

    access_token = jwt.encode(access_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    refresh_token = jwt.encode(refresh_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60
    }

def verify_token(token: str, expected_type: str = "access") -> Dict[str, Any]:
    """Decodes and validates a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != expected_type:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid token type: expected {expected_type}"
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )

def get_current_user_and_device(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """FastAPI dependency to extract current user and device from Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header"
        )
    parts = authorization.split(" ", 1)
    if len(parts) < 2 or not parts[1].strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing token in Authorization header"
        )
    raw_token = parts[1].strip()
    payload = verify_token(raw_token, expected_type="access")
    user_id = payload.get("sub")
    device_id = payload.get("device_id")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Check user
            cur.execute("SELECT id, email, full_name, is_active FROM users WHERE id = %s;", (user_id,))
            user = cur.fetchone()
            if not user or not user["is_active"]:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User account inactive or not found"
                )

            # Check device is still active
            cur.execute(
                "SELECT id, device_id, device_name, is_active FROM user_devices WHERE user_id = %s AND device_id = %s;",
                (user_id, device_id)
            )
            device = cur.fetchone()
            if not device or not device["is_active"]:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Device session revoked or expired. Please sign in again."
                )

            # Update last_active_at
            cur.execute(
                "UPDATE user_devices SET last_active_at = NOW() WHERE user_id = %s AND device_id = %s;",
                (user_id, device_id)
            )
            conn.commit()

    return {
        "user_id": user_id,
        "email": user["email"],
        "full_name": user["full_name"],
        "device_id": device_id,
        "device_name": device["device_name"]
    }

def register_device_session(
    conn,
    user_id: str,
    device_id: str,
    device_name: str,
    platform: str,
    refresh_token: str
) -> Dict[str, Any]:
    """
    Registers a device session enforcing a strict MAX 2 active devices per account.
    If the device is already registered, refreshes its session.
    If registering a 3rd active device, raises HTTP 403 with current devices list.
    """
    with conn.cursor() as cur:
        # Check if this exact device_id is already registered for this user
        cur.execute(
            "SELECT id, is_active, device_name FROM user_devices WHERE user_id = %s AND device_id = %s;",
            (user_id, device_id)
        )
        existing_device = cur.fetchone()

        # Count active devices excluding the current one if re-authenticating
        cur.execute(
            "SELECT id, device_id, device_name, platform, last_active_at FROM user_devices WHERE user_id = %s AND is_active = TRUE ORDER BY last_active_at DESC;",
            (user_id,)
        )
        active_devices = cur.fetchall()

        token_hash = hash_token(refresh_token)

        if existing_device:
            # Reactivate and update existing device session
            cur.execute(
                """
                UPDATE user_devices
                SET device_name = %s,
                    platform = %s,
                    refresh_token_hash = %s,
                    is_active = TRUE,
                    last_active_at = NOW()
                WHERE user_id = %s AND device_id = %s
                RETURNING id, device_id, device_name, platform, is_active;
                """,
                (device_name, platform, token_hash, user_id, device_id)
            )
            device = cur.fetchone()
            conn.commit()
            return device

        # New device attempting registration: check active device count
        if len(active_devices) >= 2:
            formatted_devices = [
                {
                    "device_id": d["device_id"],
                    "device_name": d["device_name"],
                    "platform": d["platform"],
                    "last_active_at": d["last_active_at"].isoformat() if d["last_active_at"] else None
                }
                for d in active_devices
            ]
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error_code": "DEVICE_LIMIT_EXCEEDED",
                    "message": "Maximum 2 active devices allowed per account. Please log out an existing device first to use this phone.",
                    "active_devices": formatted_devices
                }
            )

        # Register new device
        new_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO user_devices (id, user_id, device_id, device_name, platform, refresh_token_hash, is_active, last_active_at, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW(), NOW())
            RETURNING id, device_id, device_name, platform, is_active;
            """,
            (new_id, user_id, device_id, device_name, platform, token_hash)
        )
        device = cur.fetchone()
        conn.commit()
        return device
