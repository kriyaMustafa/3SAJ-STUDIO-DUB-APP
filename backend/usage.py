import uuid
import datetime
import zoneinfo
from typing import Dict, Any, Optional
from fastapi import HTTPException, status

CAMBODIA_TZ = zoneinfo.ZoneInfo("Asia/Phnom_Penh")

def get_cambodia_now() -> datetime.datetime:
    """Returns the current datetime in Asia/Phnom_Penh timezone."""
    return datetime.datetime.now(CAMBODIA_TZ)

def get_cambodia_today() -> datetime.date:
    """Returns today's date in Asia/Phnom_Penh timezone."""
    return get_cambodia_now().date()

def get_seconds_until_midnight_cambodia() -> int:
    """Calculates exact seconds remaining until midnight in Cambodia."""
    now = get_cambodia_now()
    tomorrow = now.date() + datetime.timedelta(days=1)
    midnight = datetime.datetime.combine(tomorrow, datetime.time.min, tzinfo=CAMBODIA_TZ)
    diff = (midnight - now).total_seconds()
    return max(0, int(diff))

def get_user_active_subscription(conn, user_id: str) -> Optional[Dict[str, Any]]:
    """Fetches user's active subscription and plan details from PostgreSQL."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.plan_code, s.payment_id, s.status, s.started_at, s.expires_at,
                   p.name AS plan_name, p.price_usd, p.daily_minute_limit, p.max_devices
            FROM subscriptions s
            JOIN plans p ON s.plan_code = p.code
            WHERE s.user_id = %s
              AND s.status = 'ACTIVE'
              AND s.expires_at > NOW()
            ORDER BY p.price_usd DESC, s.created_at DESC
            LIMIT 1;
            """,
            (user_id,)
        )
        sub = cur.fetchone()
        if not sub:
            return None

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        diff_ms = (sub["expires_at"] - now_utc).total_seconds()
        days_remaining = max(0, int(diff_ms // 86400))
        hours_remaining = max(0, int((diff_ms % 86400) // 3600))

        return {
            "subscription_id": sub["id"],
            "plan_code": sub["plan_code"],
            "plan_name": sub["plan_name"],
            "price_usd": sub["price_usd"],
            "daily_minute_limit": sub["daily_minute_limit"],
            "max_devices": sub["max_devices"],
            "expires_at": sub["expires_at"].isoformat() if sub["expires_at"] else None,
            "days_remaining": days_remaining,
            "hours_remaining": hours_remaining,
            "is_unlimited": sub["daily_minute_limit"] is None
        }

def get_user_today_usage(conn, user_id: str) -> Dict[str, Any]:
    """Retrieves usage recorded today for the user in Cambodia time."""
    today = get_cambodia_today()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT seconds_used, minutes_used FROM usage_records WHERE user_id = %s AND usage_date = %s;",
            (user_id, today)
        )
        row = cur.fetchone()
        seconds_used = row["seconds_used"] if row else 0
        minutes_used = row["minutes_used"] if row else 0.0

        return {
            "date": today.isoformat(),
            "seconds_used": seconds_used,
            "minutes_used": round(minutes_used, 1),
            "seconds_until_reset": get_seconds_until_midnight_cambodia()
        }

def check_and_reserve_quota(
    conn,
    user_id: str,
    video_duration_seconds: int,
    idempotency_token: str,
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Validates user's entitlement and reserves translation quota server-side.
    Enforces daily quota reset at midnight Cambodia time.
    Prevents duplicate usage deductions via idempotency token.
    """
    sub = get_user_active_subscription(conn, user_id)
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "NO_ACTIVE_SUBSCRIPTION",
                "message": "You do not have an active subscription. Please subscribe to Flash, Pro, Pro Max, or Unlimited to translate."
            }
        )

    # Check if this exact job was already reserved or processed
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, status, video_duration_seconds FROM translation_jobs WHERE idempotency_token = %s;",
            (idempotency_token,)
        )
        existing_job = cur.fetchone()
        if existing_job:
            return {
                "allowed": True,
                "already_reserved": True,
                "job_id": existing_job["id"],
                "plan": sub
            }

    # If plan is UNLIMITED, skip daily cap check
    if sub["is_unlimited"]:
        # Log translation job
        job_id = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO translation_jobs (id, user_id, project_id, video_duration_seconds, status, idempotency_token, created_at)
                VALUES (%s, %s, %s, %s, 'RESERVED', %s, NOW());
                """,
                (job_id, user_id, project_id, video_duration_seconds, idempotency_token)
            )
            conn.commit()
        return {
            "allowed": True,
            "job_id": job_id,
            "is_unlimited": True,
            "plan": sub
        }

    # Capped Plan quota check
    daily_limit_minutes = sub["daily_minute_limit"]
    usage = get_user_today_usage(conn, user_id)
    current_minutes_used = usage["minutes_used"]
    video_minutes = round(video_duration_seconds / 60.0, 1)
    projected_minutes = current_minutes_used + video_minutes
    remaining_minutes = max(0.0, round(daily_limit_minutes - current_minutes_used, 1))

    if projected_minutes > daily_limit_minutes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error_code": "QUOTA_EXCEEDED",
                "message": (
                    f"Daily translation quota of {daily_limit_minutes} minutes exceeded! "
                    f"Remaining today: {remaining_minutes} min. This video requires {video_minutes} min. "
                    f"Quota resets at midnight Cambodia time, or you can upgrade to a higher plan."
                ),
                "daily_limit_minutes": daily_limit_minutes,
                "minutes_used_today": current_minutes_used,
                "remaining_minutes": remaining_minutes,
                "video_minutes": video_minutes,
                "seconds_until_reset": usage["seconds_until_reset"]
            }
        )

    # Reserve job
    job_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO translation_jobs (id, user_id, project_id, video_duration_seconds, status, idempotency_token, created_at)
            VALUES (%s, %s, %s, %s, 'RESERVED', %s, NOW());
            """,
            (job_id, user_id, project_id, video_duration_seconds, idempotency_token)
        )
        conn.commit()

    return {
        "allowed": True,
        "job_id": job_id,
        "is_unlimited": False,
        "remaining_minutes_after_job": round(daily_limit_minutes - projected_minutes, 1),
        "plan": sub
    }

def commit_quota_deduction(conn, user_id: str, idempotency_token: str) -> Dict[str, Any]:
    """
    Commits usage deduction upon successful translation completion.
    Idempotent: guarantees single deduction even if client retries.
    """
    today = get_cambodia_today()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, status, video_duration_seconds FROM translation_jobs WHERE idempotency_token = %s;",
            (idempotency_token,)
        )
        job = cur.fetchone()
        if not job:
            return {"committed": False, "reason": "Job not found"}

        if job["status"] == "COMPLETED":
            return {"committed": True, "already_committed": True}

        # Mark job completed
        cur.execute(
            "UPDATE translation_jobs SET status = 'COMPLETED' WHERE id = %s;",
            (job["id"],)
        )

        duration_sec = job["video_duration_seconds"]

        # Upsert usage record for today
        usage_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO usage_records (id, user_id, usage_date, seconds_used, minutes_used, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (user_id, usage_date) DO UPDATE SET
                seconds_used = usage_records.seconds_used + EXCLUDED.seconds_used,
                minutes_used = (usage_records.seconds_used + EXCLUDED.seconds_used) / 60.0,
                updated_at = NOW()
            RETURNING seconds_used, minutes_used;
            """,
            (usage_id, user_id, today, duration_sec, duration_sec / 60.0)
        )
        updated_usage = cur.fetchone()
        conn.commit()

        return {
            "committed": True,
            "seconds_used_today": updated_usage["seconds_used"],
            "minutes_used_today": round(updated_usage["minutes_used"], 1)
        }
