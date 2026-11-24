import os
import re
import json
import uuid
import datetime
import logging
import tempfile
import base64
import html
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, Header, status, Request, Response
from fastapi.responses import StreamingResponse, HTMLResponse, RedirectResponse
from urllib.parse import quote_plus, unquote_plus
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
import requests
import yt_dlp
try:
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests
    HAS_GOOGLE_AUTH = True
except Exception:
    HAS_GOOGLE_AUTH = False
    google_id_token = None
    google_requests = None

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
    commit_quota_deduction,
    calculate_upgrade_proration
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
    revoke_device_id: Optional[str] = None

GOOGLE_WEB_CLIENT_ID = os.environ.get(
    "GOOGLE_WEB_CLIENT_ID",
    "76120676265-nh7sstgffij29s3qukarj5eil28rbfj0.apps.googleusercontent.com"
)

class GoogleAuthRequest(BaseModel):
    id_token: Optional[str] = None
    email: Optional[str] = None
    google_id: Optional[str] = None
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    device_id: str
    device_name: Optional[str] = "Android Device"
    platform: Optional[str] = "android"
    revoke_device_id: Optional[str] = None

class WebGoogleCompleteRequest(BaseModel):
    session_id: str
    device_id: str
    device_name: Optional[str] = "Android Device"
    id_token: str
    revoke_device_id: Optional[str] = None

class WebEmailLoginRequest(BaseModel):
    session_id: str
    device_id: str
    device_name: Optional[str] = "Android Device"
    email: str
    password: str
    revoke_device_id: Optional[str] = None

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
# HEALTH & CONFIG (Supports GET, HEAD, POST, OPTIONS for Uptime Monitors)
# ==============================================================================

@app.api_route("/", methods=["GET", "HEAD", "POST", "OPTIONS"])
@app.api_route("/health", methods=["GET", "HEAD", "POST", "OPTIONS"])
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
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Manual email registration is disabled. Please sign in with Google."
    )

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

        # If user explicitly requested to revoke an existing device to free up slot
        if req.revoke_device_id:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE user_devices SET is_active = FALSE, refresh_token_hash = NULL WHERE user_id = %s AND device_id = %s;",
                    (user_id, req.revoke_device_id.strip())
                )
                conn.commit()

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
    Google OAuth 2.0 verification & instant authorization (Option A).
    Verifies Google ID Token against Google Identity Services.
    Auto-creates the user account in PostgreSQL and links Google identity.
    """
    if not req.device_id:
        raise HTTPException(status_code=400, detail="Device ID is required")

    email = req.email.strip().lower() if req.email else None
    google_id = req.google_id
    full_name = req.full_name

    # 1. Cryptographically verify id_token if provided
    if req.id_token:
        verified = False
        if HAS_GOOGLE_AUTH and google_id_token is not None:
            try:
                id_info = google_id_token.verify_oauth2_token(
                    req.id_token,
                    google_requests.Request(),
                    GOOGLE_WEB_CLIENT_ID
                )
                email = id_info.get("email", "").lower().strip()
                google_id = id_info.get("sub")
                full_name = id_info.get("name") or full_name
                verified = True
            except Exception as e:
                logger.warning(f"google-auth verify failed ({e}), attempting tokeninfo endpoint fallback...")

        if not verified:
            try:
                resp = requests.get(
                    f"https://oauth2.googleapis.com/tokeninfo?id_token={req.id_token}",
                    timeout=8
                )
                if resp.status_code == 200:
                    id_info = resp.json()
                    email = id_info.get("email", "").lower().strip()
                    google_id = id_info.get("sub")
                    full_name = id_info.get("name") or full_name
                else:
                    raise HTTPException(status_code=401, detail="Invalid Google ID Token")
            except HTTPException:
                raise
            except Exception as net_err:
                raise HTTPException(status_code=401, detail=f"Failed to verify Google token: {net_err}")

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid verified Google email required")
    if not google_id:
        raise HTTPException(status_code=400, detail="Google User ID required")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Ensure users table has google_id column if not exists
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);")

            # 1. Check if identity already linked in user_auth_identities
            cur.execute(
                "SELECT user_id FROM user_auth_identities WHERE provider = 'google' AND provider_user_id = %s;",
                (google_id,)
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
                    cur.execute(
                        "UPDATE users SET google_id = %s, updated_at = NOW() WHERE id = %s AND google_id IS NULL;",
                        (google_id, user_id)
                    )
                    # Link Google identity
                    cur.execute(
                        """
                        INSERT INTO user_auth_identities (id, user_id, provider, provider_user_id, provider_email, created_at, last_sign_in_at)
                        VALUES (%s, %s, 'google', %s, %s, NOW(), NOW())
                        ON CONFLICT (provider, provider_user_id) DO UPDATE SET last_sign_in_at = NOW();
                        """,
                        (str(uuid.uuid4()), user_id, google_id, email)
                    )
                else:
                    # 3. Create new user account (password_hash is nullable)
                    user_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO users (id, email, full_name, google_id, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, TRUE, NOW(), NOW())
                        RETURNING id, email, full_name;
                        """,
                        (user_id, email, full_name or email.split("@")[0], google_id)
                    )
                    user = cur.fetchone()

                    # Link Google identity
                    cur.execute(
                        """
                        INSERT INTO user_auth_identities (id, user_id, provider, provider_user_id, provider_email, created_at, last_sign_in_at)
                        VALUES (%s, %s, 'google', %s, %s, NOW(), NOW());
                        """,
                        (str(uuid.uuid4()), user_id, google_id, email)
                    )
            conn.commit()

        if not user or not user["is_active"]:
            raise HTTPException(status_code=403, detail="User account is suspended")

        # If user explicitly requested to revoke an existing device to free up slot
        if req.revoke_device_id:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE user_devices SET is_active = FALSE, refresh_token_hash = NULL WHERE user_id = %s AND device_id = %s;",
                    (user_id, req.revoke_device_id.strip())
                )
                conn.commit()

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
                "user_id": user["id"],
                "email": user["email"],
                "full_name": user["full_name"]
            },
            "device": device,
            "tokens": tokens,
            "subscription": subscription
        }

def ensure_web_auth_table():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS web_auth_sessions (
                        session_id VARCHAR(64) PRIMARY KEY,
                        device_id VARCHAR(128) NOT NULL,
                        device_name VARCHAR(128),
                        platform VARCHAR(32) DEFAULT 'android',
                        status VARCHAR(32) DEFAULT 'pending',
                        user_data JSONB,
                        tokens JSONB,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '15 minutes')
                    );
                """)
                conn.commit()
    except Exception as e:
        logger.warning(f"Error ensuring web_auth_sessions table: {e}")

@app.get("/api/auth/google/web", response_class=HTMLResponse)
def google_web_login_page(session_id: str, device_id: str, device_name: Optional[str] = "Android Device"):
    """
    Renders browser-based Google OAuth login page for devices without Google Play Services (e.g. Huawei, Honor).
    """
    ensure_web_auth_table()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO web_auth_sessions (session_id, device_id, device_name, status, created_at, expires_at)
                VALUES (%s, %s, %s, 'pending', NOW(), NOW() + INTERVAL '15 minutes')
                ON CONFLICT (session_id) DO UPDATE SET device_id = %s, device_name = %s, status = 'pending', expires_at = NOW() + INTERVAL '15 minutes';
                """,
                (session_id, device_id, device_name, device_id, device_name)
            )
            conn.commit()

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Sign In - 3SAJ Studio</title>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
    body {{
      background: #0B1120;
      color: #F8FAFC;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 16px;
    }}
    .card {{
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 28px 22px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }}
    .badge {{
      display: inline-block;
      background: rgba(56, 189, 248, 0.15);
      color: #38BDF8;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 12px;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 800;
      color: #FFFFFF;
      margin-bottom: 6px;
    }}
    p {{
      color: #94A3B8;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 22px;
    }}
    .google-btn-wrapper {{
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 16px;
      min-height: 48px;
    }}
    .divider {{
      display: flex;
      align-items: center;
      margin: 18px 0;
      color: #64748B;
      font-size: 11px;
      font-weight: 700;
    }}
    .divider::before, .divider::after {{
      content: "";
      flex: 1;
      height: 1px;
      background: #334155;
    }}
    .divider span {{
      padding: 0 10px;
    }}
    .input-field {{
      width: 100%;
      background: #0F172A;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 14px;
      color: #FFFFFF;
      font-size: 14px;
      margin-bottom: 10px;
      outline: none;
    }}
    .input-field:focus {{
      border-color: #38BDF8;
    }}
    .btn-email-submit {{
      width: 100%;
      background: #0284C7;
      color: #FFFFFF;
      border: none;
      border-radius: 10px;
      padding: 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }}
    .btn-email-submit:hover {{
      background: #0369A1;
    }}
    #status-msg {{
      margin-top: 14px;
      font-size: 13px;
      color: #38BDF8;
      min-height: 20px;
    }}
    .btn-return {{
      display: none;
      margin-top: 14px;
      background: #10B981;
      color: #FFFFFF;
      text-decoration: none;
      font-weight: 700;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 14px;
      width: 100%;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Account Sign-In</div>
    <h1>3SAJ STUDIO</h1>
    <p>Sign in to sync your subscription and translation quota on this device.</p>

    <!-- Google Sign-In Container -->
    <div class="google-btn-wrapper">
      <div id="google-signin-btn"></div>
    </div>
    <div id="g_id_onload"
         data-client_id="{GOOGLE_WEB_CLIENT_ID}"
         data-callback="handleCredentialResponse"
         data-auto_prompt="false">
    </div>

    <!-- Email Fallback Form -->
    <div class="divider"><span>OR SIGN IN WITH EMAIL</span></div>
    <form id="email-form" onsubmit="handleEmailSubmit(event)">
      <input type="email" id="email-input" class="input-field" placeholder="Email Address" required />
      <input type="password" id="pass-input" class="input-field" placeholder="Password" required />
      <button type="submit" id="btn-submit-email" class="btn-email-submit">Sign In to 3SAJ Studio</button>
    </form>

    <div id="status-msg"></div>
    <a id="btn-return" class="btn-return" href="#">Open 3SAJ Studio App</a>
  </div>

  <script>
    window.onload = function() {{
      try {{
        if (window.google && google.accounts && google.accounts.id) {{
          google.accounts.id.initialize({{
            client_id: "{GOOGLE_WEB_CLIENT_ID}",
            callback: handleCredentialResponse,
            auto_select: false
          }});
          google.accounts.id.renderButton(
            document.getElementById("google-signin-btn"),
            {{
              theme: "filled_blue",
              size: "large",
              text: "continue_with",
              shape: "pill",
              width: 280,
              logo_alignment: "left"
            }}
          );
        }}
      }} catch (e) {{
        console.warn("GIS init error:", e);
      }}
    }};

    async function handleCredentialResponse(response) {{
      const statusBox = document.getElementById('status-msg');
      const returnBtn = document.getElementById('btn-return');
      statusBox.innerText = 'Verifying with Google...';

      try {{
        const res = await fetch('/api/auth/google/web/complete', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{
            session_id: '{session_id}',
            device_id: '{device_id}',
            device_name: '{device_name}',
            id_token: response.credential
          }})
        }});

        const data = await res.json();
        if (res.ok && data.success) {{
          statusBox.innerHTML = '<span style="color:#10B981;font-weight:bold;">Sign-in successful!</span><br><span style="font-size:12px;color:#94A3B8;">Returning to 3SAJ Studio...</span>';
          returnBtn.href = data.redirect_url;
          returnBtn.style.display = 'block';
          window.location.href = data.redirect_url;
        }} else {{
          statusBox.innerHTML = '<span style="color:#EF4444;">' + (data.detail || 'Sign-in failed. Please try again.') + '</span>';
        }}
      }} catch (err) {{
        statusBox.innerHTML = '<span style="color:#EF4444;">Connection error. Please try again.</span>';
      }}
    }}

    async function handleEmailSubmit(e) {{
      e.preventDefault();
      const statusBox = document.getElementById('status-msg');
      const returnBtn = document.getElementById('btn-return');
      const submitBtn = document.getElementById('btn-submit-email');
      const email = document.getElementById('email-input').value.trim();
      const password = document.getElementById('pass-input').value;

      statusBox.innerText = 'Signing in...';
      submitBtn.disabled = true;

      try {{
        const res = await fetch('/api/auth/google/web/email-login', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{
            session_id: '{session_id}',
            device_id: '{device_id}',
            device_name: '{device_name}',
            email: email,
            password: password
          }})
        }});

        const data = await res.json();
        if (res.ok && data.success) {{
          statusBox.innerHTML = '<span style="color:#10B981;font-weight:bold;">Sign-in successful!</span><br><span style="font-size:12px;color:#94A3B8;">Returning to 3SAJ Studio...</span>';
          returnBtn.href = data.redirect_url;
          returnBtn.style.display = 'block';
          window.location.href = data.redirect_url;
        }} else {{
          statusBox.innerHTML = '<span style="color:#EF4444;">' + (data.detail || 'Sign-in failed. Please check credentials.') + '</span>';
        }}
      }} catch (err) {{
        statusBox.innerHTML = '<span style="color:#EF4444;">Connection error. Please try again.</span>';
      }} finally {{
        submitBtn.disabled = false;
      }}
    }}
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)

@app.post("/api/auth/google/web/complete")
def complete_web_google_auth(req: WebGoogleCompleteRequest):
    """Completes web Google Sign-In and stores authenticated tokens for the session."""
    auth_req = GoogleAuthRequest(
        id_token=req.id_token,
        device_id=req.device_id,
        device_name=req.device_name,
        platform="android",
        revoke_device_id=req.revoke_device_id
    )
    auth_result = google_auth(auth_req)

    user = auth_result["user"]
    tokens = auth_result["tokens"]

    ensure_web_auth_table()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE web_auth_sessions
                SET status = 'authenticated',
                    user_data = %s,
                    tokens = %s
                WHERE session_id = %s;
                """,
                (json.dumps(user), json.dumps(tokens), req.session_id)
            )
            conn.commit()

    redirect_url = f"sajstudio://auth/callback?session_id={req.session_id}&access_token={tokens['access_token']}&refresh_token={tokens['refresh_token']}&user_id={user['id']}&email={quote_plus(user['email'])}&full_name={quote_plus(user['full_name'] or '')}"

    return {
        "success": True,
        "redirect_url": redirect_url,
        "user": user,
        "tokens": tokens
    }

@app.post("/api/auth/google/web/email-login")
def complete_web_email_login(req: WebEmailLoginRequest):
    """Allows email/password login from the browser to authenticate the mobile session."""
    login_req = LoginRequest(
        email=req.email,
        password=req.password,
        device_id=req.device_id,
        device_name=req.device_name,
        platform="android",
        revoke_device_id=req.revoke_device_id
    )
    auth_result = login_user(login_req)

    user = auth_result["user"]
    tokens = auth_result["tokens"]

    ensure_web_auth_table()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE web_auth_sessions
                SET status = 'authenticated',
                    user_data = %s,
                    tokens = %s
                WHERE session_id = %s;
                """,
                (json.dumps(user), json.dumps(tokens), req.session_id)
            )
            conn.commit()

    redirect_url = f"sajstudio://auth/callback?session_id={req.session_id}&access_token={tokens['access_token']}&refresh_token={tokens['refresh_token']}&user_id={user['id']}&email={quote_plus(user['email'])}&full_name={quote_plus(user['full_name'] or '')}"

    return {
        "success": True,
        "redirect_url": redirect_url,
        "user": user,
        "tokens": tokens
    }

@app.get("/api/auth/session/check")
def check_web_auth_session(session_id: str):
    """Poll endpoint for mobile app to check if web authentication completed."""
    ensure_web_auth_table()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, user_data, tokens, expires_at FROM web_auth_sessions WHERE session_id = %s;",
                (session_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Session not found")

            if row["status"] == "authenticated":
                user_data = row["user_data"]
                if isinstance(user_data, str):
                    user_data = json.loads(user_data)
                tokens = row["tokens"]
                if isinstance(tokens, str):
                    tokens = json.loads(tokens)
                return {
                    "status": "authenticated",
                    "user": user_data,
                    "tokens": tokens
                }
            return {"status": row["status"]}

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
        "user": {
            "id": user_id,
            "user_id": user_id,
            "email": current["email"],
            "full_name": current["full_name"],
            "device_id": current["device_id"],
            "device_name": current["device_name"]
        },
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
def list_plans(authorization: Optional[str] = Header(None)):
    """Lists available subscription plans with prorated upgrade quotes and downgrade locks."""
    user_id = None
    if authorization and authorization.startswith("Bearer "):
        try:
            token = authorization.split(" ")[1]
            payload = verify_token(token, expected_type="access")
            user_id = payload.get("sub")
        except Exception:
            pass

    with get_db_connection() as conn:
        current_sub = get_user_active_subscription(conn, user_id) if user_id else None
        with conn.cursor() as cur:
            cur.execute("SELECT code, name, price_usd, daily_minute_limit, max_devices FROM plans ORDER BY price_usd ASC;")
            rows = cur.fetchall()

    enriched_plans = []
    for r in rows:
        plan_price = float(r["price_usd"])
        proration = calculate_upgrade_proration(current_sub, plan_price)
        is_cur = bool(current_sub and current_sub["plan_code"] == r["code"])

        enriched_plans.append({
            "code": r["code"],
            "name": r["name"],
            "price_usd": plan_price,
            "daily_minute_limit": r["daily_minute_limit"],
            "max_devices": r["max_devices"],
            "is_current": is_cur,
            "is_upgrade": proration["is_upgrade"],
            "is_downgrade": proration["is_downgrade"],
            "can_select": not is_cur and not proration["is_downgrade"],
            "final_price": proration["final_price"] if proration["is_upgrade"] else plan_price,
            "remaining_credit": proration["remaining_credit"],
            "remaining_days": proration["remaining_days"],
            "blocked_reason": proration.get("blocked_reason")
        })

    return {
        "plans": enriched_plans,
        "current_subscription": current_sub
    }

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
    Enforces prorated upgrade pricing and blocks plan downgrades until expiration.
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

                tokens = create_tokens(user_id, user_info["email"] if user_info else f"guest_{clean_device_id[:8]}", clean_device_id)
                register_device_session(
                    conn=conn,
                    user_id=user_id,
                    device_id=clean_device_id,
                    device_name=req.device_name or "Android Device",
                    platform=req.platform or "android",
                    refresh_token=tokens["refresh_token"]
                )

            # Query target plan
            plan_code = req.plan_code.upper().strip()
            cur.execute("SELECT code, name, price_usd FROM plans WHERE code = %s;", (plan_code,))
            plan = cur.fetchone()
            if not plan:
                raise HTTPException(status_code=404, detail=f"Plan '{plan_code}' not found")

            # Check active subscription and calculate prorated upgrade or block downgrade
            current_sub = get_user_active_subscription(conn, user_id)
            proration = calculate_upgrade_proration(current_sub, float(plan["price_usd"]))

            # REQUIREMENT 3: Block Plan Downgrades Until Expiration
            if proration["is_downgrade"]:
                expiry_display = current_sub["expires_at"][:10] if current_sub and current_sub.get("expires_at") else "expiration"
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Plan downgrades are not permitted while your current {current_sub['plan_name']} plan is active. Please wait until your subscription expires on {expiry_display}."
                )

            # REQUIREMENT 2: Prorated Upgrade Pricing
            amount = float(proration["final_price"])
            is_upgrade = bool(proration["is_upgrade"])
            remaining_credit = float(proration["remaining_credit"])
            remaining_days = int(proration["remaining_days"])

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

    payment_id = payment_data.get("payment_id") or payment_data.get("id")

    # Authoritatively record target plan_code, upgrade status, and credit in payments table
    meta_json = json.dumps({
        "channel": "mobile_app",
        "app_code": "STUDIO_APP",
        "plan_code": plan_code,
        "plan_title": plan["name"],
        "user_id": user_id,
        "is_upgrade": is_upgrade,
        "remaining_credit": remaining_credit,
        "upgrade_price": amount
    })

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE payments
                SET extra_metadata = %s::json
                WHERE id = %s OR transaction_id = %s;
                """,
                (meta_json, payment_id, payment_id)
            )
            conn.commit()

    resp = {
        "payment_id": payment_id,
        "transaction_id": payment_data.get("transaction_id"),
        "amount": amount,
        "currency": "USD",
        "plan_code": plan_code,
        "plan_name": plan["name"],
        "is_upgrade": is_upgrade,
        "remaining_credit": remaining_credit,
        "remaining_days": remaining_days,
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
    plan_code: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """
    Polls Central Payment API for payment status.
    If PAID, immediately activates 30-day subscription for the user in PostgreSQL.
    Accurately switches active plan to the new tier and resets billing cycle to fresh 30 days.
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
                # 1. Retrieve authoritative payment row from PostgreSQL payments table
                cur.execute(
                    "SELECT id, amount, extra_metadata, customer_reference FROM payments WHERE id = %s OR transaction_id = %s;",
                    (payment_id, payment_id)
                )
                pay_row = cur.fetchone()

                target_user_id = user_id
                if not target_user_id:
                    if pay_row and pay_row.get("customer_reference"):
                        target_user_id = pay_row["customer_reference"]
                    else:
                        target_user_id = payment_status.get("customer_reference")

                if not target_user_id:
                    raise HTTPException(status_code=400, detail="Cannot associate payment with a user account")

                # 2. Retrieve authoritative plan_code from payments.extra_metadata or query/amount
                resolved_plan_code = None
                if pay_row and pay_row.get("extra_metadata"):
                    meta = pay_row["extra_metadata"]
                    if isinstance(meta, str):
                        try:
                            import json
                            meta = json.loads(meta)
                        except Exception:
                            meta = {}
                    if isinstance(meta, dict) and meta.get("plan_code"):
                        resolved_plan_code = str(meta["plan_code"]).upper().strip()

                if not resolved_plan_code:
                    meta = payment_status.get("metadata") or {}
                    if isinstance(meta, dict) and meta.get("plan_code"):
                        resolved_plan_code = str(meta["plan_code"]).upper().strip()

                if not resolved_plan_code and plan_code:
                    clean_code = str(plan_code).upper().strip()
                    if clean_code in ("FLASH", "PRO", "PRO_MAX", "UNLIMITED"):
                        resolved_plan_code = clean_code

                if not resolved_plan_code:
                    check_amt = None
                    if pay_row and pay_row.get("amount") is not None:
                        check_amt = float(pay_row["amount"])
                    elif payment_status.get("amount") is not None:
                        check_amt = float(payment_status["amount"])

                    if check_amt is not None:
                        if check_amt >= 14.0:
                            resolved_plan_code = "UNLIMITED"
                        elif check_amt >= 9.5:
                            resolved_plan_code = "PRO_MAX"
                        elif check_amt >= 7.0:
                            resolved_plan_code = "PRO"
                        else:
                            resolved_plan_code = "FLASH"

                if not resolved_plan_code:
                    resolved_plan_code = "FLASH"

            # 3. Activate subscription with authoritative plan code
            activation_result = activate_paid_subscription(
                conn=conn,
                payment_id=payment_id,
                user_id=target_user_id,
                plan_code=resolved_plan_code
            )
            current_sub = get_user_active_subscription(conn, target_user_id)

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

def convert_ttml_to_srt(ttml_text: str) -> str:
    """Converts TTML / XML subtitles to clean standard SRT format."""
    p_pattern = re.compile(r'<p\s+begin="([^"]+)"\s+end="([^"]+)"[^>]*>(.*?)</p>', re.DOTALL | re.IGNORECASE)
    matches = p_pattern.findall(ttml_text)
    if not matches:
        return ttml_text

    srt_blocks = []
    counter = 1

    def format_timestamp(ts: str) -> str:
        ts = ts.strip().replace(".", ",")
        if ts.count(":") == 1:
            ts = "00:" + ts
        parts = ts.split(",")
        if len(parts) == 2:
            ms = parts[1][:3].ljust(3, "0")
            return f"{parts[0]},{ms}"
        return f"{ts},000"

    for begin, end, body in matches:
        text = re.sub(r'<br\s*/?>', '\n', body, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', '', text)
        text = html.unescape(text).strip()
        if not text:
            continue

        start_time = format_timestamp(begin)
        end_time = format_timestamp(end)

        srt_blocks.append(f"{counter}\n{start_time} --> {end_time}\n{text}\n")
        counter += 1

    return "\n".join(srt_blocks)

def extract_tiktok_media(url: str) -> dict:
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.tiktok.com/'
    }
    session = requests.Session()
    r = session.get(url, headers=headers, allow_redirects=True, timeout=15)
    if r.status_code != 200:
        raise Exception(f"Failed to access TikTok page (status {r.status_code})")

    html = r.text
    # 1. Search in __UNIVERSAL_DATA_FOR_REHYDRATION__
    m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', html)
    if m:
        try:
            data = json.loads(m.group(1))
            default_scope = data.get('__DEFAULT_SCOPE__', {})
            item_info = default_scope.get('webapp.video-detail', {}).get('itemInfo', {}).get('itemStruct', {})
            title = item_info.get('desc') or 'TikTok_Video'
            video = item_info.get('video', {})
            play_url = video.get('playAddr') or video.get('downloadAddr')
            if play_url:
                return {
                    'title': title,
                    'play_url': play_url,
                    'thumbnail_url': video.get('cover'),
                    'duration': video.get('duration')
                }
        except Exception as e:
            logger.warning(f"Error parsing TikTok rehydration data: {e}")

    # 2. Search in SIGI_STATE
    m2 = re.search(r'<script id="SIGI_STATE"[^>]*>(.*?)</script>', html)
    if m2:
        try:
            data = json.loads(m2.group(1))
            item_module = data.get('ItemModule', {})
            for item_id, item in item_module.items():
                video = item.get('video', {})
                play_url = video.get('playAddr') or video.get('downloadAddr')
                if play_url:
                    return {
                        'title': item.get('desc') or 'TikTok_Video',
                        'play_url': play_url,
                        'thumbnail_url': video.get('cover'),
                        'duration': video.get('duration')
                    }
        except Exception as e:
            logger.warning(f"Error parsing TikTok SIGI_STATE: {e}")

    raise Exception("Could not find playable video link in TikTok page")

@app.get("/api/video/tiktok")
def stream_tiktok_video(url: str):
    """
    Proxies TikTok CDN video stream with required cookies and Range headers
    so client devices can download MP4 reliably without 403 Forbidden.
    """
    raw_url = unquote_plus(url)
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.tiktok.com/'
    }
    # Warm up session on TikTok page to get valid session cookies
    r_page = session.get(raw_url, headers=headers, allow_redirects=True, timeout=15)
    html = r_page.text

    play_url = None
    m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', html)
    if m:
        try:
            data = json.loads(m.group(1))
            default_scope = data.get('__DEFAULT_SCOPE__', {})
            item_info = default_scope.get('webapp.video-detail', {}).get('itemInfo', {}).get('itemStruct', {})
            video = item_info.get('video', {})
            play_url = video.get('playAddr') or video.get('downloadAddr')
        except Exception:
            pass

    if not play_url:
        m2 = re.search(r'<script id="SIGI_STATE"[^>]*>(.*?)</script>', html)
        if m2:
            try:
                data = json.loads(m2.group(1))
                item_module = data.get('ItemModule', {})
                for item_id, item in item_module.items():
                    video = item.get('video', {})
                    play_url = video.get('playAddr') or video.get('downloadAddr')
                    if play_url:
                        break
            except Exception:
                pass

    if not play_url:
        raise HTTPException(status_code=404, detail="Video stream URL not found on TikTok page.")

    stream_headers = {
        'User-Agent': headers['User-Agent'],
        'Referer': 'https://www.tiktok.com/',
        'Range': 'bytes=0-'
    }
    upstream = session.get(play_url, headers=stream_headers, stream=True, timeout=25)
    if upstream.status_code not in (200, 206):
        raise HTTPException(status_code=upstream.status_code, detail="TikTok CDN rejected streaming request")

    def iter_chunks():
        for chunk in upstream.iter_content(chunk_size=64 * 1024):
            if chunk:
                yield chunk

    resp_headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "video/mp4",
    }
    if "Content-Range" in upstream.headers:
        parts = upstream.headers["Content-Range"].split("/")
        if len(parts) == 2 and parts[1].isdigit():
            resp_headers["Content-Length"] = parts[1]
    elif "Content-Length" in upstream.headers:
        resp_headers["Content-Length"] = upstream.headers["Content-Length"]

    return StreamingResponse(iter_chunks(), media_type="video/mp4", headers=resp_headers)

@app.api_route("/api/video/stream", methods=["GET", "HEAD"])
def stream_video(request: Request, url: str):
    """
    Proxies video stream from upstream CDNs (YouTube, TikTok, etc.)
    with Range support and clean headers to avoid 403 Forbidden or CORS issues.
    """
    raw_url = unquote_plus(url)
    upstream_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    }
    client_range = request.headers.get("Range")
    if client_range:
        upstream_headers['Range'] = client_range
    else:
        upstream_headers['Range'] = 'bytes=0-'

    if "youtube.com" in raw_url or "googlevideo.com" in raw_url:
        upstream_headers['Referer'] = 'https://www.youtube.com/'
        upstream_headers['Origin'] = 'https://www.youtube.com'

    if request.method == "HEAD":
        try:
            head_res = requests.head(raw_url, headers=upstream_headers, timeout=15)
            resp_headers = {
                "Accept-Ranges": "bytes",
                "Content-Type": head_res.headers.get("Content-Type", "video/mp4"),
            }
            if "Content-Length" in head_res.headers:
                resp_headers["Content-Length"] = head_res.headers["Content-Length"]
            return Response(status_code=head_res.status_code if head_res.status_code in (200, 206) else 200, headers=resp_headers)
        except Exception:
            return Response(status_code=200, headers={"Accept-Ranges": "bytes", "Content-Type": "video/mp4"})

    try:
        upstream = requests.get(raw_url, headers=upstream_headers, stream=True, timeout=30)
    except Exception as e:
        logger.error(f"Upstream stream connection error: {e}")
        raise HTTPException(status_code=502, detail="Could not connect to video stream provider")

    if upstream.status_code not in (200, 206):
        logger.warning(f"Upstream stream failed with status {upstream.status_code} for {raw_url[:60]}")
        raise HTTPException(status_code=upstream.status_code, detail="Remote video server rejected streaming request")

    def iter_chunks():
        for chunk in upstream.iter_content(chunk_size=128 * 1024):
            if chunk:
                yield chunk

    resp_headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": upstream.headers.get("Content-Type", "video/mp4"),
    }
    if "Content-Range" in upstream.headers:
        resp_headers["Content-Range"] = upstream.headers["Content-Range"]
    if "Content-Length" in upstream.headers:
        resp_headers["Content-Length"] = upstream.headers["Content-Length"]

    return StreamingResponse(
        iter_chunks(),
        status_code=upstream.status_code,
        media_type="video/mp4",
        headers=resp_headers
    )

def extract_youtube_id(url: str) -> Optional[str]:
    patterns = [
        r'(?:v=|\/v\/|youtu\.be\/|embed\/|shorts\/|watch\?v=|\&v=)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None

def extract_youtube_invidious(video_id: str) -> Optional[dict]:
    instances = [
        "https://yewtu.be",
        "https://invidious.nerdvpn.de",
        "https://invidious.private.coffee",
        "https://inv.nadeko.net",
        "https://invidious.projectsegfau.lt",
        "https://invidious.drgns.space",
    ]
    for instance in instances:
        try:
            api_url = f"{instance}/api/v1/videos/{video_id}"
            resp = requests.get(
                api_url,
                timeout=8,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                    "Accept": "application/json"
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                title = data.get("title") or "YouTube Video"
                duration = data.get("lengthSeconds")
                thumbnail = None
                if data.get("videoThumbnails"):
                    thumbnail = data["videoThumbnails"][-1].get("url")

                format_streams = data.get("formatStreams", [])
                mp4_streams = [
                    s for s in format_streams
                    if s.get("container") == "mp4" or "mp4" in s.get("type", "")
                ]
                video_url = None
                if mp4_streams:
                    video_url = mp4_streams[-1].get("url") or mp4_streams[0].get("url")
                elif format_streams:
                    video_url = format_streams[-1].get("url") or format_streams[0].get("url")

                if not video_url and data.get("adaptiveFormats"):
                    for af in data["adaptiveFormats"]:
                        if "mp4" in af.get("type", "") and af.get("url"):
                            video_url = af.get("url")
                            break

                srt_content = None
                captions = data.get("captions", [])
                if captions:
                    chosen_cap = None
                    for lang_code in ["zh", "zh-hans", "zh-hant", "en", "km"]:
                        for cap in captions:
                            if lang_code in cap.get("languageCode", "").lower():
                                chosen_cap = cap
                                break
                        if chosen_cap:
                            break
                    if not chosen_cap and captions:
                        chosen_cap = captions[0]

                    if chosen_cap and chosen_cap.get("url"):
                        cap_url = chosen_cap["url"]
                        if cap_url.startswith("/"):
                            cap_url = f"{instance}{cap_url}"
                        try:
                            cap_res = requests.get(cap_url, timeout=6)
                            if cap_res.status_code == 200:
                                raw_sub = cap_res.text
                                if "WEBVTT" in raw_sub:
                                    srt_content = convert_vtt_to_srt(raw_sub)
                                elif "<?xml" in raw_sub or "<tt" in raw_sub:
                                    srt_content = convert_ttml_to_srt(raw_sub)
                                else:
                                    srt_content = raw_sub
                        except Exception as ex:
                            logger.warning(f"Error fetching Invidious caption: {ex}")

                if video_url:
                    return {
                        "title": title,
                        "video_url": video_url,
                        "srt_content": srt_content,
                        "duration": duration,
                        "thumbnail": thumbnail,
                    }
        except Exception as e:
            logger.warning(f"Invidious instance {instance} failed for {video_id}: {e}")
            continue
    return None

def extract_youtube_piped(video_id: str) -> Optional[dict]:
    instances = [
        "https://api.piped.private.coffee",
        "https://pipedapi.adminforge.de",
        "https://api.piped.yt",
        "https://pipedapi.kavin.rocks",
    ]
    for instance in instances:
        try:
            api_url = f"{instance}/streams/{video_id}"
            resp = requests.get(
                api_url,
                timeout=8,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                title = data.get("title") or "YouTube Video"
                duration = data.get("duration")
                thumbnail = data.get("thumbnailUrl")
                v_streams = data.get("videoStreams", [])

                # Filter out odycdn/lbry links which fail on direct download
                valid_streams = [
                    s for s in v_streams
                    if s.get("url") and "odycdn" not in s.get("url") and "lbry" not in s.get("url")
                ]

                # Look for muxed streams with audio & video
                muxed = [s for s in valid_streams if not s.get("videoOnly")]
                video_url = None
                if muxed:
                    # Prefer videoplayback proxy streams
                    proxied = [s for s in muxed if "videoplayback" in s.get("url")]
                    video_url = (proxied[0] if proxied else muxed[0]).get("url")
                elif valid_streams:
                    mp4s = [s for s in valid_streams if s.get("format") in ("MPEG_4", "MP4")]
                    video_url = (mp4s[0] if mp4s else valid_streams[0]).get("url")

                srt_content = None
                subtitles = data.get("subtitles", [])
                if subtitles:
                    chosen_sub = None
                    for lang in ["zh", "en", "km"]:
                        for s in subtitles:
                            if lang in s.get("code", "").lower():
                                chosen_sub = s
                                break
                        if chosen_sub:
                            break
                    if not chosen_sub and subtitles:
                        chosen_sub = subtitles[0]
                    if chosen_sub and chosen_sub.get("url"):
                        try:
                            sub_res = requests.get(chosen_sub["url"], timeout=6)
                            if sub_res.status_code == 200:
                                raw = sub_res.text
                                if "WEBVTT" in raw:
                                    srt_content = convert_vtt_to_srt(raw)
                                elif "<?xml" in raw or "<tt" in raw:
                                    srt_content = convert_ttml_to_srt(raw)
                                else:
                                    srt_content = raw
                        except Exception:
                            pass

                if video_url:
                    return {
                        "title": title,
                        "video_url": video_url,
                        "srt_content": srt_content,
                        "duration": duration,
                        "thumbnail": thumbnail,
                    }
        except Exception as e:
            logger.warning(f"Piped instance {instance} failed for {video_id}: {e}")
            continue
    return None

def extract_youtube_cobalt(url: str) -> Optional[dict]:
    cobalt_endpoints = [
        "https://co.wuk.sh/api/json",
        "https://cobalt.api.hyper.lol",
    ]
    for endpoint in cobalt_endpoints:
        try:
            resp = requests.post(
                endpoint,
                json={
                    "url": url,
                    "videoQuality": "720",
                    "youtubeVideoCodec": "h264",
                    "youtubeVideoContainer": "mp4"
                },
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("url"):
                    return {
                        "title": "YouTube Video",
                        "video_url": data.get("url"),
                        "srt_content": None,
                        "duration": None,
                        "thumbnail": None
                    }
        except Exception as e:
            logger.warning(f"Cobalt endpoint {endpoint} failed: {e}")
            continue
    return None

@app.post("/extract", response_model=ExtractResponse)
def extract_media(req: ExtractRequest):
    raw_url = req.url.strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="Video URL is required")

    backend_base = os.environ.get("BACKEND_URL", "https://threesaj-studio-dub-app-734y.onrender.com").rstrip("/")

    if raw_url.lower().endswith(".mp4"):
        file_name = raw_url.split("/")[-1].replace(".mp4", "")
        return ExtractResponse(
            title=file_name or "Direct_Video",
            videoUrl=raw_url,
            srtContent="1\n00:00:01,000 --> 00:00:05,000\n[Direct Video - Enter dialogue to translate]\n\n"
        )

    # 1. Native TikTok Extractor & Stream Proxy (fast, reliable, bypasses Cloudflare/anti-bot)
    is_tiktok = any(d in raw_url.lower() for d in ["tiktok.com", "douyin.com", "vt.tiktok.com"])
    if is_tiktok:
        try:
            tiktok_info = extract_tiktok_media(raw_url)
            stream_url = f"{backend_base}/api/video/tiktok?url={quote_plus(raw_url)}"
            return ExtractResponse(
                title=tiktok_info["title"],
                videoUrl=stream_url,
                thumbnailUrl=tiktok_info.get("thumbnail_url"),
                durationSeconds=tiktok_info.get("duration"),
                srtContent="1\n00:00:00,500 --> 00:00:05,000\n[TikTok Video - Enter dialogue to translate]\n\n"
            )
        except Exception as e:
            logger.warning(f"Native TikTok extraction failed ({e}), falling back to yt-dlp...")

    is_youtube = any(d in raw_url.lower() for d in ["youtube.com", "youtu.be", "youtube-nocookie.com"])

    # Setup cookies if configured via environment or local file
    cookie_file = None
    yt_cookies_env = os.environ.get("YOUTUBE_COOKIES") or os.environ.get("YT_COOKIES")
    if yt_cookies_env:
        try:
            temp_cookie_path = os.path.join(tempfile.gettempdir(), "yt_cookies.txt")
            try:
                decoded = base64.b64decode(yt_cookies_env).decode("utf-8")
                if "youtube.com" in decoded or "Netscape" in decoded:
                    yt_cookies_env = decoded
            except Exception:
                pass
            with open(temp_cookie_path, "w", encoding="utf-8") as f:
                f.write(yt_cookies_env)
            cookie_file = temp_cookie_path
        except Exception as ce:
            logger.warning(f"Could not write cookie file from env: {ce}")
    elif os.path.exists("cookies.txt"):
        cookie_file = "cookies.txt"

    ydl_opts = {
        "format": "best[ext=mp4]/best",
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": raw_url,
        },
        "extractor_args": {
            "youtube": {
                "player_client": ["ios", "android_vr", "mweb", "tv"],
                "player_skip": ["web", "configs"],
            },
        },
    }
    if cookie_file:
        ydl_opts["cookiefile"] = cookie_file

    info = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(raw_url, download=False)
    except Exception as e:
        err_str = str(e)
        logger.warning(f"yt-dlp primary extraction failed for {raw_url}: {err_str}")
        if is_youtube:
            logger.info("Attempting multi-layer fallback extractors for YouTube...")
            yt_id = extract_youtube_id(raw_url)
            fallback_res = None
            if yt_id:
                fallback_res = extract_youtube_invidious(yt_id)
                if not fallback_res:
                    fallback_res = extract_youtube_piped(yt_id)
            if not fallback_res:
                fallback_res = extract_youtube_cobalt(raw_url)

            if fallback_res and fallback_res.get("video_url"):
                v_url = fallback_res["video_url"]
                # Wrap through streaming proxy only if googlevideo link is tied to server IP
                if "googlevideo.com" in v_url and "proxy.piped" not in v_url:
                    v_url = f"{backend_base}/api/video/stream?url={quote_plus(v_url)}"

                return ExtractResponse(
                    title=fallback_res.get("title") or "YouTube_Video",
                    videoUrl=v_url,
                    srtContent=fallback_res.get("srt_content") or "1\n00:00:00,500 --> 00:00:05,000\n[Dialogue 1 - Tap to edit or translate]\n\n",
                    thumbnailUrl=fallback_res.get("thumbnail"),
                    durationSeconds=int(fallback_res["duration"]) if fallback_res.get("duration") else None
                )

        raise HTTPException(status_code=500, detail=f"Failed to extract media: {err_str}")

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

    # If yt-dlp extracted media metadata but video stream link failed, try fallbacks
    if not video_url and is_youtube:
        yt_id = extract_youtube_id(raw_url)
        fallback_res = extract_youtube_invidious(yt_id) if yt_id else None
        if not fallback_res and yt_id:
            fallback_res = extract_youtube_piped(yt_id)
        if fallback_res and fallback_res.get("video_url"):
            video_url = fallback_res["video_url"]

    if not video_url:
        raise HTTPException(status_code=500, detail="Could not resolve downloadable video stream URL.")

    # Proxy YouTube video streams through backend to avoid client IP binding 403 Forbidden
    if video_url and "googlevideo.com" in video_url and "proxy.piped" not in video_url:
        video_url = f"{backend_base}/api/video/stream?url={quote_plus(video_url)}"

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
                    elif "<?xml" in raw_sub or "<tt" in raw_sub:
                        srt_content = convert_ttml_to_srt(raw_sub)
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
