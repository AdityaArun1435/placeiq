"""
Migration 001 — SQLite → Supabase PostgreSQL
---------------------------------------------
Reads all tables from backend/placeiq.db and recreates them in Supabase.

Safe to re-run:
  - CREATE TABLE IF NOT EXISTS
  - INSERT ... ON CONFLICT DO NOTHING

Run with:
    python -m backend.migrations.001_initial
"""

import json
import os
import sqlite3
import sys
from pathlib import Path

# Ensure backend/ is on the path so we can import database.py
_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv

load_dotenv(_BACKEND_DIR / ".env")

_SQLITE_PATH = _BACKEND_DIR / "placeiq.db"

# ── Type mapping: SQLite → PostgreSQL ─────────────────────────────────────────

def _pg_type(sqlite_type: str, is_pk: bool) -> str:
    t = (sqlite_type or "TEXT").upper().strip()
    if is_pk and ("INT" in t or t == "INTEGER"):
        return "SERIAL"
    if "INT" in t:
        return "INTEGER"
    if "REAL" in t or "FLOAT" in t or "DOUBLE" in t or "NUMERIC" in t:
        return "NUMERIC"
    if "BOOL" in t:
        return "BOOLEAN"
    if "JSON" in t:
        return "JSONB"
    if "DATE" in t or "TIME" in t:
        return "TIMESTAMP"
    # TEXT, VARCHAR, CHAR, CLOB → TEXT
    return "TEXT"


# ── DDL builder ───────────────────────────────────────────────────────────────

def _build_pg_ddl(table: str, sqlite_con: sqlite3.Connection) -> str:
    """Build a PostgreSQL CREATE TABLE IF NOT EXISTS statement."""
    cur = sqlite_con.cursor()

    # Get column info: cid, name, type, notnull, dflt_value, pk
    columns = cur.execute(f"PRAGMA table_info({table})").fetchall()
    # Get unique constraints from SQLite index info
    unique_sets: list[list[str]] = []
    indexes = cur.execute(
        f"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='{table}' AND sql IS NOT NULL"
    ).fetchall()
    for (idx_name,) in indexes:
        idx_info = cur.execute(f"PRAGMA index_info({idx_name})").fetchall()
        idx_cols = [row[2] for row in idx_info]
        idx_unique = cur.execute(
            f"SELECT \"unique\" FROM pragma_index_list('{table}') WHERE name='{idx_name}'"
        ).fetchone()
        if idx_unique and idx_unique[0]:
            unique_sets.append(idx_cols)

    col_defs: list[str] = []
    pk_cols: list[str] = []

    for cid, name, col_type, notnull, dflt_value, is_pk in columns:
        if is_pk:
            pk_cols.append(name)
        pg_t = _pg_type(col_type, is_pk and len([c for c in columns if c[5]]) == 1)

        parts = [f'"{name}"', pg_t]
        if notnull and pg_t != "SERIAL":
            parts.append("NOT NULL")
        col_defs.append(" ".join(parts))

    # Composite PK
    if len(pk_cols) > 1:
        pk_str = ", ".join(f'"{c}"' for c in pk_cols)
        col_defs.append(f"PRIMARY KEY ({pk_str})")

    # Unique constraints (skip single-column ones that are already UNIQUE on the column itself)
    for uc in unique_sets:
        if len(uc) > 1:
            uc_str = ", ".join(f'"{c}"' for c in uc)
            col_defs.append(f"UNIQUE ({uc_str})")

    col_block = ",\n    ".join(col_defs)
    return f'CREATE TABLE IF NOT EXISTS "{table}" (\n    {col_block}\n);'


# ── Data migration ────────────────────────────────────────────────────────────

def _migrate_table(
    table: str,
    sqlite_con: sqlite3.Connection,
    pg_con,
) -> int:
    sqlite_cur = sqlite_con.cursor()
    pg_cur = pg_con.cursor()

    # Get column names (skip auto-increment PK so Postgres generates its own)
    cols_info = sqlite_cur.execute(f"PRAGMA table_info({table})").fetchall()

    # Detect single-column AUTOINCREMENT PK to skip it
    pk_cols = [c for c in cols_info if c[5]]  # c[5] = pk flag
    auto_pk = pk_cols[0][1] if len(pk_cols) == 1 else None

    data_cols = [c[1] for c in cols_info if c[1] != auto_pk]

    if not data_cols:
        return 0

    rows = sqlite_cur.execute(f"SELECT {', '.join(data_cols)} FROM \"{table}\"").fetchall()
    if not rows:
        return 0

    ph_list = ", ".join(["%s"] * len(data_cols))
    col_list = ", ".join(f'"{c}"' for c in data_cols)
    insert_sql = (
        f'INSERT INTO "{table}" ({col_list}) VALUES ({ph_list}) ON CONFLICT DO NOTHING'
    )

    inserted = 0
    for row in rows:
        # Normalise values: ensure JSON columns are proper strings
        processed = []
        for val, col_info in zip(row, [c for c in cols_info if c[1] != auto_pk]):
            col_type = (col_info[2] or "").upper()
            if "JSON" in col_type and isinstance(val, (list, dict)):
                val = json.dumps(val)
            processed.append(val)

        pg_cur.execute(insert_sql, processed)
        inserted += 1

    pg_con.commit()
    return inserted


# ── Entry point ───────────────────────────────────────────────────────────────

def run():
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url.startswith("postgresql"):
        print("ERROR: DATABASE_URL is not set or is not a PostgreSQL URL.")
        print("       Set DATABASE_URL=postgresql://... in backend/.env and retry.")
        sys.exit(1)

    if not _SQLITE_PATH.exists():
        print(f"ERROR: SQLite file not found at {_SQLITE_PATH}")
        sys.exit(1)

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2-binary is not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

    print(f"Source : {_SQLITE_PATH}")
    print(f"Target : Supabase ({db_url[:40]}...)")
    print()

    sqlite_con = sqlite3.connect(str(_SQLITE_PATH))
    pg_con = psycopg2.connect(db_url)
    pg_cur = pg_con.cursor()

    # List all user tables from SQLite
    tables = [
        row[0]
        for row in sqlite_con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]

    if not tables:
        print("No tables found in SQLite database.")
        sqlite_con.close()
        pg_con.close()
        return

    for table in tables:
        print(f"Migrating table '{table}'...", end=" ", flush=True)

        # Create table in Postgres
        ddl = _build_pg_ddl(table, sqlite_con)
        pg_cur.execute(ddl)
        pg_con.commit()

        # Migrate rows
        n = _migrate_table(table, sqlite_con, pg_con)
        print(f"done ({n} rows)")

    # Reset sequences for SERIAL columns
    print()
    print("Resetting sequences...")
    for table in tables:
        cols_info = sqlite_con.cursor().execute(f"PRAGMA table_info({table})").fetchall()
        pk_cols = [c for c in cols_info if c[5]]
        if len(pk_cols) == 1:
            pk_name = pk_cols[0][1]
            pg_t = _pg_type(pk_cols[0][2], True)
            if pg_t == "SERIAL":
                seq_name = f"{table}_{pk_name}_seq"
                pg_cur.execute(
                    f"SELECT setval('{seq_name}', COALESCE((SELECT MAX(\"{pk_name}\") FROM \"{table}\"), 1))"
                )
                pg_con.commit()
                print(f"  Reset sequence for {table}.{pk_name}")

    sqlite_con.close()
    pg_con.close()

    print()
    print("Migration complete. All tables copied to Supabase.")


if __name__ == "__main__":
    run()
