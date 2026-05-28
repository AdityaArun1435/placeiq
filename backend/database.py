import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

direct = os.getenv("DIRECT_DATABASE_URL", "NOT_SET")
print(f"[DB DEBUG] DIRECT_DATABASE_URL = {direct[:40] if direct != 'NOT_SET' else 'NOT SET'}")

_SQLITE_PATH = Path(__file__).parent / "placeiq.db"
_DB_URL = os.getenv("DATABASE_URL", "")
_DIRECT_URL = os.getenv("DIRECT_DATABASE_URL", "")

print(f"[DB] DATABASE_URL starts with:        {_DB_URL[:30] if _DB_URL else 'NOT SET'}")
print(f"[DB] DIRECT_DATABASE_URL starts with: {_DIRECT_URL[:30] if _DIRECT_URL else 'NOT SET'}")

# ── Determine active database ─────────────────────────────────────────────────

def _try_connect(url: str) -> bool:
    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=8)
    conn.close()
    return True

db_type: str  # "supabase" | "sqlite"
_sqlalchemy_url: str | None = None
_active_pg_url: str = ""

_is_pg = _DB_URL.startswith("postgresql") or _DB_URL.startswith("postgres") or \
         _DIRECT_URL.startswith("postgresql") or _DIRECT_URL.startswith("postgres")

if _is_pg:
    # Try 1: DIRECT_DATABASE_URL (port 5432, bypasses pooler)
    if _DIRECT_URL:
        try:
            _try_connect(_DIRECT_URL)
            _sqlalchemy_url = _DIRECT_URL
            _active_pg_url = _DIRECT_URL
            db_type = "supabase"
            print("[DB] Connected to Supabase (direct)")
        except Exception as _e1:
            print(f"[DB] Direct URL failed: {_e1}")

    # Try 2: DATABASE_URL as-is (port 6543 transaction pooler)
    if not _sqlalchemy_url and _DB_URL:
        try:
            _try_connect(_DB_URL)
            _sqlalchemy_url = _DB_URL
            _active_pg_url = _DB_URL
            db_type = "supabase"
            print("[DB] Connected to Supabase (pooler port 6543)")
        except Exception as _e2:
            print(f"[DB] Pooler (6543) failed: {_e2}")

    # Try 3: swap pooler host/port → direct port 5432
    if not _sqlalchemy_url and _DB_URL:
        try:
            import re as _re
            _fallback_url = _re.sub(r":6543/", ":5432/", _DB_URL)
            _fallback_url = _re.sub(r"([^@]+)@[^/]*pooler\.supabase\.com",
                                    lambda m: m.group(0).replace(
                                        m.group(0).split("@")[1],
                                        _re.sub(r"postgres\.(\w+)", r"db.\1.supabase.co", m.group(0).split("@")[1])
                                    ), _fallback_url)
            _try_connect(_fallback_url)
            _sqlalchemy_url = _fallback_url
            _active_pg_url = _fallback_url
            db_type = "supabase"
            print("[DB] Connected to Supabase (direct port 5432 derived)")
        except Exception as _e3:
            print(f"[DB] Derived direct (5432) failed: {_e3}")

if not _sqlalchemy_url:
    print("[DB] All Supabase connections failed — falling back to SQLite")
    _sqlalchemy_url = f"sqlite:///{_SQLITE_PATH}"
    db_type = "sqlite"

# ── SQLAlchemy setup (used by main.py ORM) ────────────────────────────────────

_connect_args = {"check_same_thread": False} if db_type == "sqlite" else {}
engine = create_engine(_sqlalchemy_url, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Raw connection (used by scrapers / ML) ────────────────────────────────────

def get_connection():
    """Return a raw DB-API 2.0 connection to the active database."""
    if db_type == "supabase":
        import psycopg2
        return psycopg2.connect(_active_pg_url)
    return sqlite3.connect(str(_SQLITE_PATH))
