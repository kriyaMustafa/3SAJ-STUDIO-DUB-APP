-- 3SAJ Studio App Account & Subscription Schema
-- Database: PostgreSQL (Neon)

-- 1. Plans table (Centralized Plan Configuration)
CREATE TABLE IF NOT EXISTS plans (
    code VARCHAR(32) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    price_usd DOUBLE PRECISION NOT NULL,
    daily_minute_limit INTEGER NULL,
    max_devices INTEGER NOT NULL DEFAULT 2,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed plans: Flash ($5/150m), Pro ($8/300m), Pro Max ($10/600m), Unlimited ($15/unlimited)
INSERT INTO plans (code, name, price_usd, daily_minute_limit, max_devices, is_active)
VALUES
    ('FLASH', 'Flash Plan', 5.00, 150, 2, TRUE),
    ('PRO', 'Pro Plan', 8.00, 300, 2, TRUE),
    ('PRO_MAX', 'Pro Max Plan', 10.00, 600, 2, TRUE),
    ('UNLIMITED', 'Unlimited Plan', 15.00, NULL, 2, TRUE)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    price_usd = EXCLUDED.price_usd,
    daily_minute_limit = EXCLUDED.daily_minute_limit,
    max_devices = EXCLUDED.max_devices;

-- 2. Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(128) NULL,
    hashed_password VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);

-- 3. User Auth Identities table (Account Linking for Email/Password + Google OAuth)
CREATE TABLE IF NOT EXISTS user_auth_identities (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sign_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_user UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS ix_auth_identities_user_id ON user_auth_identities(user_id);

-- 4. User Devices table (Max 2 active sessions enforcement)
CREATE TABLE IF NOT EXISTS user_devices (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(128) NOT NULL,
    device_name VARCHAR(128) NOT NULL,
    platform VARCHAR(32) NOT NULL,
    refresh_token_hash VARCHAR(128) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_device UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS ix_user_devices_user_active ON user_devices(user_id, is_active);

-- 5. Subscriptions table (References Central Payment payments.id)
CREATE TABLE IF NOT EXISTS subscriptions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_code VARCHAR(32) NOT NULL REFERENCES plans(code),
    payment_id VARCHAR(36) NULL REFERENCES payments(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS ix_subscriptions_expires_at ON subscriptions(expires_at);

-- 6. Usage Records table (Asia/Phnom_Penh Daily Quota Tracking)
CREATE TABLE IF NOT EXISTS usage_records (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,
    seconds_used INTEGER NOT NULL DEFAULT 0,
    minutes_used DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_usage_date UNIQUE (user_id, usage_date)
);
CREATE INDEX IF NOT EXISTS ix_usage_records_user_date ON usage_records(user_id, usage_date);

-- 7. Translation Jobs table (Idempotent duration reservation and deduction)
CREATE TABLE IF NOT EXISTS translation_jobs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id VARCHAR(128) NULL,
    video_duration_seconds INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    idempotency_token VARCHAR(128) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_translation_jobs_user_status ON translation_jobs(user_id, status);
