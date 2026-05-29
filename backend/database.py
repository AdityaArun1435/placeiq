import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

_SQLITE_PATH = Path(__file__).parent / "placeiq.db"

db_type = "sqlite"
supabase_client = None

if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        supabase_client.table("user_profiles").select("id").limit(1).execute()
        db_type = "supabase"
        print("[DB] Connected to Supabase via REST API")
    except Exception as e:
        print(f"[DB] Supabase REST failed: {e} — falling back to SQLite")
        supabase_client = None

# SQLAlchemy is kept for SQLite fallback and ORM model definitions
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

_sqlalchemy_url = f"sqlite:///{_SQLITE_PATH}"
if db_type == "sqlite":
    print(f"[DB] Using SQLite at {_SQLITE_PATH}")

engine = create_engine(_sqlalchemy_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_supabase():
    return supabase_client


def is_supabase():
    return db_type == "supabase"


def get_connection():
    """Return a raw sqlite3 connection (local fallback only)."""
    conn = sqlite3.connect(str(_SQLITE_PATH))
    return conn
