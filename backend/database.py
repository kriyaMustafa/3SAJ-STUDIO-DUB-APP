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

DEFAULT_DATABASE_URL = "postgresql://neondb_owner:npg_HgUyNbTe61iL@ep-raspy-unit-aoqcnerj-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
DATABASE_URL = os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL

def get_db_connection():
    """Returns a psycopg connection with dictionary row factory."""
    db_url = DATABASE_URL
    if "sslmode" not in db_url:
        db_url += ("&" if "?" in db_url else "?") + "sslmode=require"
    conn = psycopg.connect(db_url, row_factory=dict_row)
    return conn
