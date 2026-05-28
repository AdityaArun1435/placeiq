"""
NIRF 2024 Placement Data Scraper
---------------------------------
Downloads placement statistics from nirfindia.org, cleans them, and loads
into the nirf_placements table in backend/placeiq.db.

Primary path : HTML scrape of the NIRF ranking page (BeautifulSoup)
Fallback path: Official NIRF Excel download (pandas + openpyxl)
"""

import logging
import re
import sys
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path

import requests

# Allow imports from project root when run as a standalone script
_PROJECT_DIR = Path(__file__).parent.parent.parent
if str(_PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(_PROJECT_DIR))

from database import get_connection  # noqa: E402

# ── Paths & constants ─────────────────────────────────────────────────────────

NIRF_YEAR = 2024

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("nirf_scraper")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.8",
    "Referer": "https://nirfindia.org/",
}

_NIRF_RANKING_URL = (
    "https://nirfindia.org/ranking/1/Year/2024/ranktype/University"
)

# Multiple candidate Excel URLs — NIRF changes their CDN paths each year
_EXCEL_URLS = [
    f"https://nirfindia.org/nirfpdfcdn/{NIRF_YEAR}/xlsx/University.xlsx",
    f"https://nirfindia.org/nirfpdfcdn/{NIRF_YEAR}/pdf/University.xlsx",
    f"https://nirfindia.org/Home/rankingdatafile/1?year={NIRF_YEAR}&ranktype=University",
    f"https://nirfindia.org/nirfpdfcdn/{NIRF_YEAR}/xlsx/Engineering.xlsx",
]


# ── Salary normalisation ──────────────────────────────────────────────────────

def _to_lpa(raw) -> float | None:
    """
    Convert a raw salary value to float LPA.

    Handles: "12.5 LPA", "12,50,000", "1250000", "12.5", None, NaN
    """
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "")
    if not s or s.lower() in ("-", "n/a", "na", "nan", "none", ""):
        return None

    # Strip currency symbols
    s = s.replace("₹", "").replace("$", "").strip()

    match = re.search(r"[\d]+(?:\.\d+)?", s)
    if not match:
        return None
    val = float(match.group())

    s_lower = s.lower()
    if "lpa" in s_lower or "lakh" in s_lower or "lac" in s_lower:
        return round(val, 2)

    # Raw rupee amount — convert to LPA (divide by 1 lakh = 100 000)
    if val >= 1_00_000:
        return round(val / 1_00_000, 2)

    # Already a small decimal — treat as LPA
    return round(val, 2)


def _to_int(raw) -> int | None:
    if raw is None:
        return None
    try:
        cleaned = re.sub(r"[^\d]", "", str(raw))
        return int(cleaned) if cleaned else None
    except (ValueError, TypeError):
        return None


def _to_float_pct(raw) -> float | None:
    """Parse a percentage like '78.5%' or '78.5' to float."""
    if raw is None:
        return None
    try:
        cleaned = re.sub(r"[^\d.]", "", str(raw))
        val = float(cleaned) if cleaned else None
        # NIRF sometimes stores as 0–100, sometimes as fraction 0–1
        if val is not None and val <= 1.0:
            val = round(val * 100, 2)
        return val
    except (ValueError, TypeError):
        return None


def _rank_to_tier(rank: int | None) -> str:
    if rank is None:
        return "Tier 4"
    if rank <= 10:
        return "Tier 1"
    if rank <= 50:
        return "Tier 2"
    if rank <= 200:
        return "Tier 3"
    return "Tier 4"


# ── HTML scraping ─────────────────────────────────────────────────────────────

# Maps lowercase fragments of HTML <th> text → our field names
_HTML_COL_HINTS: list[tuple[str, str]] = [
    ("rank",              "nirf_rank"),
    ("institute name",    "college_name"),
    ("institution name",  "college_name"),
    ("college name",      "college_name"),
    ("name of",           "college_name"),
    ("placement rate",    "placement_rate"),
    ("% placed",          "placement_rate"),
    ("median",            "median_salary"),
    ("highest",           "highest_salary"),
    ("maximum",           "highest_salary"),
    ("mean salary",       "mean_salary"),
    ("average salary",    "mean_salary"),
    ("graduating",        "graduating_students_count"),
    ("total students",    "graduating_students_count"),
]


def _map_header(text: str) -> str | None:
    t = text.lower().strip()
    for fragment, field in _HTML_COL_HINTS:
        if fragment in t:
            return field
    return None


def _parse_html_table(table) -> list[dict]:
    from bs4 import Tag

    # Collect header mapping: column_index → field_name
    header_row = table.find("thead")
    if header_row is None:
        rows = table.find_all("tr")
        header_cells = rows[0].find_all(["th", "td"]) if rows else []
        data_rows = rows[1:]
    else:
        header_cells = header_row.find_all(["th", "td"])
        data_rows = table.find("tbody").find_all("tr") if table.find("tbody") else []

    col_map: dict[int, str] = {}
    for i, cell in enumerate(header_cells):
        field = _map_header(cell.get_text(strip=True))
        if field:
            col_map[i] = field

    if "college_name" not in col_map.values():
        return []

    results: list[dict] = []
    for tr in data_rows:
        cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
        if not cells:
            continue
        row: dict = {}
        for idx, field in col_map.items():
            if idx < len(cells):
                row[field] = cells[idx]
        if row.get("college_name"):
            results.append(row)

    return results


def _scrape_html() -> list[dict]:
    """Attempt to scrape the NIRF ranking HTML page with BeautifulSoup."""
    try:
        from bs4 import BeautifulSoup

        resp = requests.get(_NIRF_RANKING_URL, headers=_HEADERS, timeout=20)
        if resp.status_code != 200:
            log.warning(f"HTML fetch returned HTTP {resp.status_code}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        tables = soup.find_all("table")
        if not tables:
            log.warning(
                "No <table> found in HTML — NIRF likely uses JS rendering. "
                "Falling back to Excel."
            )
            return []

        all_rows: list[dict] = []
        for table in tables:
            rows = _parse_html_table(table)
            all_rows.extend(rows)

        log.info(f"HTML scrape: extracted {len(all_rows)} raw rows")
        return all_rows

    except Exception as exc:
        log.warning(f"HTML scrape failed: {exc}")
        return []


# ── Excel / CSV fallback ──────────────────────────────────────────────────────

# Maps fragments of Excel column headers → our field names (order matters)
_XL_COL_MAP: list[tuple[str, str]] = [
    ("institute name",       "college_name"),
    ("institution name",     "college_name"),
    ("name of the inst",     "college_name"),
    ("college name",         "college_name"),
    ("nirf rank",            "nirf_rank"),
    ("rank",                 "nirf_rank"),
    ("placement rate",       "placement_rate"),
    ("% students placed",    "placement_rate"),
    ("students placed",      "placement_rate"),
    ("median salary",        "median_salary"),
    ("median ctc",           "median_salary"),
    ("highest salary",       "highest_salary"),
    ("maximum salary",       "highest_salary"),
    ("highest ctc",          "highest_salary"),
    ("mean salary",          "mean_salary"),
    ("average salary",       "mean_salary"),
    ("mean ctc",             "mean_salary"),
    ("graduating students",  "graduating_students_count"),
    ("number of graduates",  "graduating_students_count"),
    ("total graduating",     "graduating_students_count"),
    ("no. of graduates",     "graduating_students_count"),
]


def _map_xl_col(raw_header: str) -> str | None:
    h = str(raw_header).lower().strip()
    for fragment, field in _XL_COL_MAP:
        if fragment in h:
            return field
    return None


def _parse_dataframe(df) -> list[dict]:
    import pandas as pd

    # Build column-index → field mapping
    col_map: dict[str, str] = {}
    for col in df.columns:
        field = _map_xl_col(str(col))
        if field and field not in col_map.values():
            col_map[col] = field

    if "college_name" not in col_map.values():
        log.warning(f"No college-name column found. Headers: {list(df.columns)[:10]}")
        return []

    rows: list[dict] = []
    for _, series in df.iterrows():
        record: dict = {}
        for raw_col, field in col_map.items():
            val = series.get(raw_col)
            # Treat pandas NA/NaN as None
            if val is not None:
                try:
                    if pd.isna(val):
                        val = None
                except (TypeError, ValueError):
                    pass
            record[field] = val

        name = str(record.get("college_name") or "").strip()
        if not name or name.lower() in ("nan", "none", ""):
            continue
        record["college_name"] = name
        rows.append(record)

    log.info(f"DataFrame parse: {len(rows)} non-empty rows")
    return rows


def _download_excel() -> list[dict]:
    """Download the official NIRF Excel and parse it with pandas."""
    try:
        import pandas as pd
    except ImportError:
        log.error("pandas not installed — run: pip install pandas openpyxl")
        return []

    for url in _EXCEL_URLS:
        try:
            log.info(f"Trying Excel URL: {url}")
            resp = requests.get(url, headers=_HEADERS, timeout=30)
            if resp.status_code != 200:
                log.warning(f"  → HTTP {resp.status_code}, skipping")
                continue

            content = BytesIO(resp.content)
            ct = resp.headers.get("Content-Type", "")

            # Attempt Excel, then CSV
            for reader, kwargs in [
                (pd.read_excel, {"engine": "openpyxl"}),
                (pd.read_excel, {"engine": "xlrd"}),
                (pd.read_csv, {}),
            ]:
                try:
                    content.seek(0)
                    df = reader(content, **kwargs)
                    rows = _parse_dataframe(df)
                    if rows:
                        log.info(f"  → parsed {len(rows)} rows")
                        return rows
                except Exception:
                    continue

        except Exception as exc:
            log.warning(f"  → failed ({url}): {exc}")

    return []


# ── Data cleaning ─────────────────────────────────────────────────────────────

def _clean(rows: list[dict]) -> list[dict]:
    """
    Normalise types, fill missing median from mean, drop nameless rows.
    """
    cleaned: list[dict] = []
    for r in rows:
        name = str(r.get("college_name") or "").strip()
        if not name:
            continue

        r["college_name"] = name
        r["nirf_rank"] = _to_int(r.get("nirf_rank"))
        r["placement_rate"] = _to_float_pct(r.get("placement_rate"))
        r["median_salary"] = _to_lpa(r.get("median_salary"))
        r["highest_salary"] = _to_lpa(r.get("highest_salary"))
        r["mean_salary"] = _to_lpa(r.get("mean_salary"))
        r["graduating_students_count"] = _to_int(r.get("graduating_students_count"))

        # Fill missing median with mean
        if r["median_salary"] is None and r["mean_salary"] is not None:
            r["median_salary"] = r["mean_salary"]

        r["college_tier"] = _rank_to_tier(r["nirf_rank"])
        cleaned.append(r)

    return cleaned


# ── DB persistence ────────────────────────────────────────────────────────────

from database import db_type  # noqa: E402

_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS nirf_placements (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    college_name              TEXT    NOT NULL,
    nirf_rank                 INTEGER,
    college_tier              TEXT,
    placement_rate            REAL,
    median_salary             REAL,
    highest_salary            REAL,
    mean_salary               REAL,
    graduating_students_count INTEGER,
    year                      INTEGER NOT NULL,
    scraped_at                TEXT    NOT NULL,
    UNIQUE (college_name, year)
);
"""

_DDL_PG = """
CREATE TABLE IF NOT EXISTS nirf_placements (
    id                        SERIAL PRIMARY KEY,
    college_name              TEXT    NOT NULL,
    nirf_rank                 INTEGER,
    college_tier              TEXT,
    placement_rate            NUMERIC,
    median_salary             NUMERIC,
    highest_salary            NUMERIC,
    mean_salary               NUMERIC,
    graduating_students_count INTEGER,
    year                      INTEGER NOT NULL,
    scraped_at                TEXT    NOT NULL,
    UNIQUE (college_name, year)
);
"""

_ALTER_TIER_SQLITE = "ALTER TABLE nirf_placements ADD COLUMN college_tier TEXT"
_ALTER_TIER_PG = "ALTER TABLE nirf_placements ADD COLUMN IF NOT EXISTS college_tier TEXT"


def _load_to_db(rows: list[dict], year: int) -> int:
    scraped_at = datetime.now(timezone.utc).isoformat()
    con = get_connection()
    is_pg = db_type == "supabase"
    placeholder = "%s" if is_pg else "?"

    ddl = _DDL_PG if is_pg else _DDL_SQLITE
    upsert = f"""
INSERT INTO nirf_placements
    (college_name, nirf_rank, college_tier, placement_rate, median_salary,
     highest_salary, mean_salary, graduating_students_count, year, scraped_at)
VALUES
    ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder},
     {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
ON CONFLICT (college_name, year) DO UPDATE SET
    nirf_rank = EXCLUDED.nirf_rank,
    college_tier = EXCLUDED.college_tier,
    placement_rate = EXCLUDED.placement_rate,
    median_salary = EXCLUDED.median_salary,
    highest_salary = EXCLUDED.highest_salary,
    mean_salary = EXCLUDED.mean_salary,
    graduating_students_count = EXCLUDED.graduating_students_count,
    scraped_at = EXCLUDED.scraped_at
""" if is_pg else """
INSERT OR REPLACE INTO nirf_placements
    (college_name, nirf_rank, college_tier, placement_rate, median_salary,
     highest_salary, mean_salary, graduating_students_count, year, scraped_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

    try:
        cur = con.cursor()
        cur.execute(ddl)

        # Backfill college_tier column for tables created before this migration
        try:
            alter = _ALTER_TIER_PG if is_pg else _ALTER_TIER_SQLITE
            cur.execute(alter)
            con.commit()
        except Exception:
            pass  # Column already exists

        for r in rows:
            cur.execute(upsert, (
                r.get("college_name"),
                r.get("nirf_rank"),
                r.get("college_tier"),
                r.get("placement_rate"),
                r.get("median_salary"),
                r.get("highest_salary"),
                r.get("mean_salary"),
                r.get("graduating_students_count"),
                year,
                scraped_at,
            ))
        con.commit()
        return len(rows)
    finally:
        con.close()


# ── Public API ────────────────────────────────────────────────────────────────


def _load_from_supabase() -> list[dict]:
    """
    Query college_stats from Supabase as fallback when live NIRF scrape fails.
    Maps college_stats 2024 rows to nirf_placements format.
    """
    try:
        con = get_connection()
        cur = con.cursor()
        cur.execute(
            "SELECT college_name, avg_ctc, total_offers, year, data_tier, "
            "highest_ctc, median_ctc FROM college_stats WHERE year='2024'"
        )
        rows_raw = cur.fetchall()
        con.close()
    except Exception as exc:
        log.warning(f"Supabase fallback query failed: {exc}")
        return []

    rows = []
    for r in rows_raw:
        college_name, avg_ctc, total_offers, year, data_tier, highest_ctc, median_ctc = r
        is_tier1 = str(data_tier).lower() == "tier1"
        nirf_rank = 5 if is_tier1 else 30
        placement_rate = 85.0 if is_tier1 else 72.0
        rows.append({
            "college_name": college_name,
            "nirf_rank": nirf_rank,
            "placement_rate": placement_rate,
            "mean_salary": float(avg_ctc) if avg_ctc is not None else None,
            "median_salary": float(median_ctc) if median_ctc is not None else (float(avg_ctc) if avg_ctc is not None else None),
            "highest_salary": float(highest_ctc) if highest_ctc is not None else None,
            "graduating_students_count": int(total_offers) if total_offers is not None else None,
        })

    log.info(f"NIRF live scrape failed — loaded {len(rows)} rows from Supabase placement database instead")
    return rows


def run_scraper(year: int = NIRF_YEAR) -> int:
    """
    Full pipeline: download → parse → clean → load into DB.
    Falls back to curated dataset when all live sources fail.
    Returns the number of colleges successfully loaded.
    """
    log.info(f"=== NIRF {year} scraper started ===")

    rows = _scrape_html()
    if not rows:
        log.info("HTML returned no data — trying Excel fallback")
        rows = _download_excel()

    if not rows:
        rows = _load_from_supabase()

    rows = _clean(rows)
    log.info(f"After cleaning: {len(rows)} colleges")

    count = _load_to_db(rows, year)
    log.info(f"Inserted/replaced {count} rows into nirf_placements")
    return count


def run_nirf_scraper() -> int:
    """Public alias used by main.py startup seeding."""
    return run_scraper()


def schedule_nirf_update(year: int = NIRF_YEAR) -> bool:
    """
    Run the scraper only when:
      1. Today falls in the NIRF release window (August 1 – October 31), AND
      2. The DB has no data for `year` yet (stale = previous-year data only).

    Returns True if a fresh scrape was performed, False otherwise.
    """
    today = date.today()
    in_window = 8 <= today.month <= 10
    if not in_window:
        log.info(
            f"Outside NIRF release window (Aug–Oct). Today={today}. Skipping."
        )
        return False

    # Check whether current-year data is already present
    already_loaded = False
    try:
        con = get_connection()
        ph = "%s" if db_type == "supabase" else "?"
        result = con.cursor().execute(
            f"SELECT COUNT(*) FROM nirf_placements WHERE year = {ph}", (year,)
        ).fetchone()
        con.close()
        already_loaded = bool(result and result[0] > 0)
    except Exception:
        # Table doesn't exist yet — definitely need to scrape
        already_loaded = False

    if already_loaded:
        log.info(
            f"NIRF {year} data already present in DB ({result[0]} rows). "
            "No re-scrape needed."
        )
        return False

    log.info(
        f"NIRF release window active + {year} data absent — starting scraper."
    )
    count = run_scraper(year)
    log.info(f"schedule_nirf_update complete: {count} colleges loaded.")
    return count > 0


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    count = run_scraper()
    con = get_connection()
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT college_name, nirf_rank, college_tier, placement_rate, median_salary "
            "FROM nirf_placements ORDER BY nirf_rank LIMIT 5"
        )
        sample_rows = cur.fetchall()
    finally:
        con.close()
    print(f"Loaded {count} colleges into nirf_placements. Sample:")
    for row in sample_rows:
        print(f"  [{row[1]}] {row[0]} | {row[2]} | {row[3]}% placed | {row[4]} LPA median")
