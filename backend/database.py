import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

_SQLITE_PATH = Path(__file__).parent / "placeiq.db"
_DB_URL = os.getenv("DATABASE_URL", "")

# ── Determine active database ─────────────────────────────────────────────────

db_type: str  # "supabase" | "sqlite"
_sqlalchemy_url: str

if _DB_URL.startswith("postgresql"):
    try:
        import psycopg2
        _probe = psycopg2.connect(_DB_URL, connect_timeout=5)
        _probe.close()
        _sqlalchemy_url = _DB_URL
        db_type = "supabase"
        print("[DB] Connected to Supabase")
    except Exception as _exc:
        print(f"[DB] Supabase connection failed ({_exc}) — falling back to SQLite")
        _sqlalchemy_url = f"sqlite:///{_SQLITE_PATH}"
        db_type = "sqlite"
else:
    _sqlalchemy_url = f"sqlite:///{_SQLITE_PATH}"
    db_type = "sqlite"
    print("[DB] Using SQLite fallback")

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
        return psycopg2.connect(_DB_URL)
    return sqlite3.connect(str(_SQLITE_PATH))
