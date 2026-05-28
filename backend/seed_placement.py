"""Seed placement_records table from the two Excel files."""
import os
import sqlite3
from pathlib import Path

import pandas as pd

BASE = Path(__file__).parent
DB = BASE / "placeiq.db"
DATA = BASE / "data"

TIER1_NAMES = {
    "iit bombay", "iit delhi", "iit madras", "iit kanpur", "iit kharagpur",
    "iit roorkee", "iit hyderabad", "iit bhu varanasi", "bits pilani (main)",
    "nit trichy", "nit surathkal", "nit warangal",
}


def _tier(name: str) -> str:
    return "tier1" if str(name).lower().strip() in TIER1_NAMES else "tier2"


def load_tier1() -> pd.DataFrame:
    path = DATA / "PlaceIQ_Placement_Database.xlsx"
    # Row 0 = title, Row 1 = info, Row 2 = headers
    df = pd.read_excel(path, sheet_name="Placement Database", skiprows=2, header=0)
    rename = {
        "College Name": "college_name",
        "Company Name": "company_name",
        "Role / Profile": "role_profile",
        "Category / Tier": "category_tier",
        "CTC Min (LPA)": "ctc_min",
        "CTC Max (LPA)": "ctc_max",
        "Avg Selection Headcount": "avg_headcount",
        "Hiring Rounds": "hiring_rounds",
        "Key Topics Tested": "key_topics",
        "Typical Visit Month": "visit_month",
        "Source / Verification": "source",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    df["data_year"] = 2024
    df["year"] = "2024"
    df["data_tier"] = df["college_name"].apply(lambda n: _tier(str(n)) if pd.notna(n) else "tier1")
    return df


def load_tier2() -> pd.DataFrame:
    path = DATA / "PlaceIQ_Full_Database_v2.xlsx"
    xl = pd.ExcelFile(path)
    sheet = next((s for s in xl.sheet_names if "tier 2" in s.lower() or "year" in s.lower()), xl.sheet_names[0])
    df = pd.read_excel(path, sheet_name=sheet, skiprows=2, header=0)
    rename = {
        "College Name": "college_name",
        "Company Name": "company_name",
        "Role / Profile": "role_profile",
        "Category / Tier": "category_tier",
        "CTC Min (LPA)": "ctc_min",
        "CTC Max (LPA)": "ctc_max",
        "Avg Selection Headcount": "avg_headcount",
        "Hiring Rounds": "hiring_rounds",
        "Key Topics Tested": "key_topics",
        "Typical Visit Month": "visit_month",
        "Source / Verification": "source",
        "Year": "data_year",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    if "data_year" not in df.columns:
        df["data_year"] = 2024
    df["year"] = df["data_year"].apply(lambda y: str(int(y)) if pd.notna(y) else "2024")
    df["data_tier"] = df["college_name"].apply(lambda n: _tier(str(n)) if pd.notna(n) else "tier2")
    return df


COLS = [
    "college_name", "company_name", "role_profile", "category_tier",
    "ctc_min", "ctc_max", "avg_headcount", "hiring_rounds", "key_topics",
    "visit_month", "source", "data_year", "year", "data_tier",
]


def main():
    df1 = load_tier1()
    df2 = load_tier2()
    df = pd.concat([df1, df2], ignore_index=True)

    # Ensure all columns exist
    for col in COLS:
        if col not in df.columns:
            df[col] = None

    df = df[COLS]
    df = df.dropna(subset=["college_name", "company_name"])
    df = df.where(pd.notna(df), None)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS placement_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            college_name TEXT NOT NULL,
            company_name TEXT NOT NULL,
            role_profile TEXT,
            category_tier TEXT,
            ctc_min REAL,
            ctc_max REAL,
            avg_headcount INTEGER,
            hiring_rounds TEXT,
            key_topics TEXT,
            visit_month TEXT,
            source TEXT,
            data_year INTEGER DEFAULT 2024,
            year TEXT DEFAULT '2024',
            data_tier TEXT DEFAULT 'tier2'
        )
    """)

    # Add columns if table existed without them
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(placement_records)").fetchall()}
    for col, defn in [("data_year", "INTEGER DEFAULT 2024"), ("year", "TEXT DEFAULT '2024'"), ("data_tier", "TEXT DEFAULT 'tier2'")]:
        if col not in existing_cols:
            conn.execute(f"ALTER TABLE placement_records ADD COLUMN {col} {defn}")

    conn.execute("DELETE FROM placement_records")

    rows = [
        (
            row["college_name"], row["company_name"], row["role_profile"], row["category_tier"],
            row["ctc_min"], row["ctc_max"],
            int(row["avg_headcount"]) if pd.notna(row["avg_headcount"]) and row["avg_headcount"] is not None else None,
            row["hiring_rounds"], row["key_topics"], row["visit_month"], row["source"],
            int(row["data_year"]) if pd.notna(row["data_year"]) and row["data_year"] is not None else 2024,
            row["year"], row["data_tier"],
        )
        for _, row in df.iterrows()
    ]

    conn.executemany("""
        INSERT INTO placement_records
        (college_name, company_name, role_profile, category_tier, ctc_min, ctc_max,
         avg_headcount, hiring_rounds, key_topics, visit_month, source, data_year, year, data_tier)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, rows)
    conn.commit()

    total = len(rows)
    colleges = df["college_name"].nunique()
    print(f"Seeded {total} records from {colleges} colleges")
    conn.close()


if __name__ == "__main__":
    main()
