import os
import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_HgUyNbTe61iL@ep-raspy-unit-aoqcnerj-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
)

def get_db_connection():
    """Returns a psycopg connection with dictionary row factory."""
    # Ensure sslmode is require
    db_url = DATABASE_URL
    if "sslmode" not in db_url:
        db_url += ("&" if "?" in db_url else "?") + "sslmode=require"
    conn = psycopg.connect(db_url, row_factory=dict_row)
    return conn
