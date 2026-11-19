import os
from pathlib import Path
import psycopg
from psycopg.rows import dict_row

# Automatically load from local .env if present (ignored in git)
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required. Please set it in your Render environment.")

def get_db_connection():
    """Returns a psycopg connection with dictionary row factory."""
    db_url = DATABASE_URL
    if "sslmode" not in db_url:
        db_url += ("&" if "?" in db_url else "?") + "sslmode=require"
    conn = psycopg.connect(db_url, row_factory=dict_row)
    return conn
