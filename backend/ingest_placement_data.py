"""
Parse PlaceIQ Excel placement data files and load into SQLite.
Run once (or re-run to refresh) — clears tables before inserting.
"""
import sqlite3
import statistics
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).parent / "placeiq.db"
DATA_DIR = Path(__file__).parent / "data"

TIER1_FILE  = DATA_DIR / "PlaceIQ_Placement_Database.xlsx"
TIER2_FILE  = DATA_DIR / "PlaceIQ_Full_Database_v2.xlsx"
TIER1_SHEET = "Placement Database"
TIER2_SHEET = "Tier 2 – Year-wise"   # en-dash in the real sheet name

# Column name -> DB field mapping
TIER1_COLS = [
    "College Name",
    "Company Name",
    "Role / Profile",
    "Category / Tier",
    "CTC Min (LPA)",
    "CTC Max (LPA)",
    "Avg Selection Headcount",
    "Hiring Rounds",
    "Key Topics Tested",
    "Typical Visit Month",
    "Source / Verification",
]

TIER2_COLS = [
    "College Name",
    "Company Name",
    "Role / Profile",
    "Category / Tier",
    "CTC Min (LPA)",
    "CTC Max (LPA)",
    "Avg Selection Headcount",
    "Year",
    "Hiring Rounds",
    "Key Topics Tested",
    "Typical Visit Month",
    "Source / Verification",
]


def create_tables(conn: sqlite3.Connection):
    conn.executescript("""
        DROP TABLE IF EXISTS placement_records;
        DROP TABLE IF EXISTS college_stats;

        CREATE TABLE placement_records (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            college_name    TEXT NOT NULL,
            company_name    TEXT,
            role_profile    TEXT,
            category_tier   TEXT,
            ctc_min         REAL,
            ctc_max         REAL,
            avg_headcount   REAL,
            year            TEXT,
            hiring_rounds   TEXT,
            key_topics      TEXT,
            visit_month     TEXT,
            source          TEXT,
            data_tier       TEXT
        );

        CREATE TABLE college_stats (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            college_name    TEXT NOT NULL,
            year            TEXT,
            total_companies INTEGER,
            highest_ctc     REAL,
            lowest_ctc      REAL,
            avg_ctc         REAL,
            median_ctc      REAL,
            total_offers    REAL,
            data_tier       TEXT
        );
    """)
    conn.commit()


def load_tier1(conn: sqlite3.Connection) -> int:
    df = pd.read_excel(TIER1_FILE, sheet_name=TIER1_SHEET, header=2)
    # Drop rows where College Name is NaN
    df = df.dropna(subset=["College Name"])
    df["Year"] = "avg_2022_2024"

    rows = []
    for _, r in df.iterrows():
        rows.append((
            str(r.get("College Name", "")).strip(),
            str(r.get("Company Name", "")).strip() if pd.notna(r.get("Company Name")) else None,
            str(r.get("Role / Profile", "")).strip() if pd.notna(r.get("Role / Profile")) else None,
            str(r.get("Category / Tier", "")).strip() if pd.notna(r.get("Category / Tier")) else None,
            float(r["CTC Min (LPA)"]) if pd.notna(r.get("CTC Min (LPA)")) else None,
            float(r["CTC Max (LPA)"]) if pd.notna(r.get("CTC Max (LPA)")) else None,
            float(r["Avg Selection Headcount"]) if pd.notna(r.get("Avg Selection Headcount")) else None,
            "avg_2022_2024",
            str(r.get("Hiring Rounds", "")).strip() if pd.notna(r.get("Hiring Rounds")) else None,
            str(r.get("Key Topics Tested", "")).strip() if pd.notna(r.get("Key Topics Tested")) else None,
            str(r.get("Typical Visit Month", "")).strip() if pd.notna(r.get("Typical Visit Month")) else None,
            str(r.get("Source / Verification", "")).strip() if pd.notna(r.get("Source / Verification")) else None,
            "tier1",
        ))

    conn.executemany("""
        INSERT INTO placement_records
            (college_name, company_name, role_profile, category_tier, ctc_min, ctc_max,
             avg_headcount, year, hiring_rounds, key_topics, visit_month, source, data_tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()
    return len(rows)


def load_tier2(conn: sqlite3.Connection) -> int:
    df = pd.read_excel(TIER2_FILE, sheet_name=TIER2_SHEET, header=2)
    df = df.dropna(subset=["College Name"])

    rows = []
    for _, r in df.iterrows():
        year_val = r.get("Year")
        year_str = str(int(year_val)) if pd.notna(year_val) else None
        rows.append((
            str(r.get("College Name", "")).strip(),
            str(r.get("Company Name", "")).strip() if pd.notna(r.get("Company Name")) else None,
            str(r.get("Role / Profile", "")).strip() if pd.notna(r.get("Role / Profile")) else None,
            str(r.get("Category / Tier", "")).strip() if pd.notna(r.get("Category / Tier")) else None,
            float(r["CTC Min (LPA)"]) if pd.notna(r.get("CTC Min (LPA)")) else None,
            float(r["CTC Max (LPA)"]) if pd.notna(r.get("CTC Max (LPA)")) else None,
            float(r["Avg Selection Headcount"]) if pd.notna(r.get("Avg Selection Headcount")) else None,
            year_str,
            str(r.get("Hiring Rounds", "")).strip() if pd.notna(r.get("Hiring Rounds")) else None,
            str(r.get("Key Topics Tested", "")).strip() if pd.notna(r.get("Key Topics Tested")) else None,
            str(r.get("Typical Visit Month", "")).strip() if pd.notna(r.get("Typical Visit Month")) else None,
            str(r.get("Source / Verification", "")).strip() if pd.notna(r.get("Source / Verification")) else None,
            "tier2",
        ))

    conn.executemany("""
        INSERT INTO placement_records
            (college_name, company_name, role_profile, category_tier, ctc_min, ctc_max,
             avg_headcount, year, hiring_rounds, key_topics, visit_month, source, data_tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()
    return len(rows)


def compute_stats(conn: sqlite3.Connection) -> int:
    cur = conn.execute("""
        SELECT college_name, year, data_tier,
               company_name, ctc_min, ctc_max, avg_headcount
        FROM placement_records
    """)
    rows = cur.fetchall()

    # group by (college_name, year, data_tier)
    from collections import defaultdict
    groups: dict = defaultdict(list)
    for college, year, tier, company, ctc_min, ctc_max, headcount in rows:
        groups[(college, year, tier)].append({
            "company": company,
            "ctc_min": ctc_min,
            "ctc_max": ctc_max,
            "headcount": headcount,
        })

    stat_rows = []
    for (college, year, tier), records in groups.items():
        companies = {r["company"] for r in records if r["company"]}
        total_companies = len(companies)

        ctc_avgs = [
            (r["ctc_min"] + r["ctc_max"]) / 2
            for r in records
            if r["ctc_min"] is not None and r["ctc_max"] is not None
        ]
        ctc_maxes = [r["ctc_max"] for r in records if r["ctc_max"] is not None]
        ctc_mins  = [r["ctc_min"] for r in records if r["ctc_min"] is not None]
        headcounts = [r["headcount"] for r in records if r["headcount"] is not None]

        highest_ctc = max(ctc_maxes) if ctc_maxes else None
        lowest_ctc  = min(ctc_mins)  if ctc_mins  else None
        avg_ctc     = round(sum(ctc_avgs) / len(ctc_avgs), 2) if ctc_avgs else None
        median_ctc  = round(statistics.median(ctc_avgs), 2)   if ctc_avgs else None
        total_offers = round(sum(headcounts), 1) if headcounts else None

        stat_rows.append((
            college, year, total_companies,
            highest_ctc, lowest_ctc, avg_ctc, median_ctc,
            total_offers, tier,
        ))

    conn.executemany("""
        INSERT INTO college_stats
            (college_name, year, total_companies, highest_ctc, lowest_ctc,
             avg_ctc, median_ctc, total_offers, data_tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, stat_rows)
    conn.commit()
    return len(stat_rows)


def main():
    conn = sqlite3.connect(DB_PATH)
    print(f"Database: {DB_PATH}")

    print("Creating tables...")
    create_tables(conn)

    print("Loading Tier 1 data...")
    n1 = load_tier1(conn)
    print(f"  Inserted {n1} Tier 1 rows into placement_records")

    print("Loading Tier 2 data...")
    n2 = load_tier2(conn)
    print(f"  Inserted {n2} Tier 2 rows into placement_records")

    print("Computing college_stats...")
    ns = compute_stats(conn)
    print(f"  Inserted {ns} rows into college_stats")

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
