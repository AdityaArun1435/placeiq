"""
college_recruiters_scraper.py
------------------------------
Scrapes real company recruiter lists for a given college from:
  - Collegedunia
  - Shiksha
  - Careers360
  - AmbitionBox
  - Quora (via Google search snippets)

Results are cached in college_recruiter_cache table (30-day expiry).
"""
import json
import logging
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import quote_plus

_PROJECT_DIR = Path(__file__).parent.parent.parent
if str(_PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(_PROJECT_DIR))

from database import get_connection, db_type

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

CACHE_TTL_DAYS = 30

# Known Indian campus recruiters used for text-matching across all sources
KNOWN_COMPANIES = [
    "TCS", "Infosys", "Wipro", "HCL Technologies", "Cognizant", "Accenture",
    "Capgemini", "Tech Mahindra", "Mphasis", "Hexaware", "Mastech Digital",
    "Amazon", "Microsoft", "Google", "Adobe", "Oracle", "IBM", "SAP",
    "Zoho", "Freshworks", "Flipkart", "Swiggy", "Zomato", "Ola",
    "Paytm", "Razorpay", "CRED", "Dream11", "Nykaa", "Meesho", "Groww",
    "Zerodha", "Upstox", "PhonePe", "Juspay",
    "Qualcomm", "Samsung", "Intel", "Texas Instruments", "NXP Semiconductors",
    "Goldman Sachs", "Morgan Stanley", "JP Morgan", "Barclays", "Deutsche Bank",
    "McKinsey", "BCG", "Bain", "Deloitte", "EY", "KPMG", "PwC",
    "L&T", "Bosch", "Siemens", "ABB", "Honeywell", "GE",
    "ISRO", "DRDO", "BHEL", "HAL", "ONGC", "NTPC", "IOCL", "BPCL",
    "Persistent Systems", "KPIT Technologies", "LTIMindtree", "Mindtree",
    "Zensar Technologies", "Cyient", "Sonata Software",
    "VMware", "Cisco", "Juniper Networks", "Palo Alto Networks",
    "Uber", "LinkedIn", "Apple", "Netflix", "PayPal", "Visa", "Mastercard",
    "Sprinklr", "Media.net", "Tower Research", "Optiver", "WorldQuant",
    "Tata Motors", "Mahindra", "Hero MotoCorp", "Bajaj Auto",
    "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra",
    "Nagarro", "GlobalLogic", "Publicis Sapient",
    "Reliance Industries", "Adani Group",
    "Mu Sigma", "Tiger Analytics", "Fractal Analytics",
    "BrowserStack", "Postman", "Chargebee",
    "Nokia", "Ericsson", "CommScope",
    "Schneider Electric", "Emerson",
    "EXL Service", "WNS Global", "Genpact",
    "Walmart", "Target Corporation",
    "Tata Steel", "JSW Steel",
    "Infobip", "CleverTap", "MoEngage",
]

_COMPANY_RE = re.compile(
    r'\b(' + '|'.join(re.escape(c) for c in KNOWN_COMPANIES) + r')\b',
    re.IGNORECASE,
)

# Map lowercase → canonical form for dedup
_CANONICAL = {c.lower(): c for c in KNOWN_COMPANIES}


def _extract_from_text(text: str) -> list[str]:
    found = set()
    for m in _COMPANY_RE.finditer(text):
        canonical = _CANONICAL.get(m.group(0).lower())
        if canonical:
            found.add(canonical)
    return list(found)


def _get(url: str, timeout: int = 8) -> str | None:
    try:
        import requests
        resp = requests.get(url, headers=_HEADERS, timeout=timeout)
        if resp.status_code == 200:
            return resp.text
    except Exception as e:
        log.debug("GET %s: %s", url, e)
    return None


def _scrape_collegedunia(college_name: str) -> list[dict]:
    results = []
    html = _get(f"https://collegedunia.com/search?search={quote_plus(college_name + ' placement')}")
    if not html:
        return results

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")

    # Try to find a placement page link
    placement_link = None
    first_word = college_name.split()[0].lower()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "placement" in href.lower() and first_word in href.lower():
            placement_link = href if href.startswith("http") else "https://collegedunia.com" + href
            break

    if placement_link:
        page_html = _get(placement_link)
        if page_html:
            html = page_html

    soup2 = BeautifulSoup(html, "html.parser")
    # Check recruiter-specific sections first
    for tag in soup2.find_all(["section", "div", "ul"], class_=re.compile(r'recruit|company|employer|placer', re.I)):
        for c in _extract_from_text(tag.get_text(" ")):
            results.append({"company": c, "source": "Collegedunia"})
    # Also scan full page text
    for c in _extract_from_text(soup2.get_text(" ")):
        results.append({"company": c, "source": "Collegedunia"})

    return _dedup(results)


def _scrape_shiksha(college_name: str) -> list[dict]:
    results = []
    html = _get(f"https://www.shiksha.com/search?q={quote_plus(college_name + ' placement')}")
    if not html:
        return results

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")

    placement_link = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "placement" in href.lower() and any(
            kw in href.lower() for kw in ("university", "college", "institute", "technology")
        ):
            placement_link = href if href.startswith("http") else "https://www.shiksha.com" + href
            break

    if placement_link:
        page_html = _get(placement_link)
        if page_html:
            html = page_html

    for c in _extract_from_text(html):
        results.append({"company": c, "source": "Shiksha"})

    return _dedup(results)


def _scrape_careers360(college_name: str) -> list[dict]:
    results = []
    html = _get(f"https://engineering.careers360.com/search?q={quote_plus(college_name + ' placement')}")
    if not html:
        return results

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")

    # Try to follow the first placement link
    placement_link = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "placement" in href.lower():
            placement_link = href if href.startswith("http") else "https://engineering.careers360.com" + href
            break

    if placement_link:
        page_html = _get(placement_link)
        if page_html:
            html = page_html

    for c in _extract_from_text(html):
        results.append({"company": c, "source": "Careers360"})

    return _dedup(results)


def _scrape_ambitionbox(college_name: str) -> list[dict]:
    results = []
    html = _get(f"https://www.ambitionbox.com/reviews?query={quote_plus(college_name)}")
    if not html:
        return results

    for c in _extract_from_text(html):
        results.append({"company": c, "source": "AmbitionBox"})

    return _dedup(results)


def _scrape_google_quora(college_name: str) -> list[dict]:
    results = []
    query = college_name + " placement companies site:quora.com"
    html = _get(f"https://www.google.com/search?q={quote_plus(query)}")
    if not html:
        return results

    for c in _extract_from_text(html):
        results.append({"company": c, "source": "Quora (via Google)"})

    return _dedup(results)


def _dedup(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for item in items:
        key = item["company"].lower()
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def _ensure_cache_table():
    con = get_connection()
    try:
        cur = con.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS college_recruiter_cache (
                college_name TEXT PRIMARY KEY,
                companies_json TEXT NOT NULL,
                scraped_at TEXT NOT NULL
            )
        """)
        con.commit()
    finally:
        con.close()


def _get_cached(college_name: str) -> list[dict] | None:
    con = get_connection()
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT companies_json, scraped_at FROM college_recruiter_cache WHERE college_name = ?",
            (college_name.lower().strip(),),
        )
        row = cur.fetchone()
        if not row:
            return None
        scraped_at = datetime.fromisoformat(row[1])
        if scraped_at.tzinfo is None:
            scraped_at = scraped_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - scraped_at > timedelta(days=CACHE_TTL_DAYS):
            return None
        return json.loads(row[0])
    except Exception:
        return None
    finally:
        con.close()


def _save_cache(college_name: str, companies: list[dict]):
    ph = "?" if db_type == "sqlite" else "%s"
    con = get_connection()
    try:
        cur = con.cursor()
        cur.execute(
            f"INSERT OR REPLACE INTO college_recruiter_cache (college_name, companies_json, scraped_at) "
            f"VALUES ({ph},{ph},{ph})",
            (
                college_name.lower().strip(),
                json.dumps(companies),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        con.commit()
    except Exception as e:
        log.warning("Cache save failed: %s", e)
    finally:
        con.close()


def get_college_recruiters(college_name: str) -> list[dict]:
    """
    Return recruiter companies for a college scraped from public sources.
    Each item: {"company": str, "source": str}.
    Cached for 30 days.
    """
    _ensure_cache_table()

    cached = _get_cached(college_name)
    if cached is not None:
        log.info("Recruiter cache hit for %s: %d companies", college_name, len(cached))
        return cached

    log.info("Scraping recruiters for: %s", college_name)
    all_results: list[dict] = []
    seen: set[str] = set()

    for source_label, fn in [
        ("Collegedunia", _scrape_collegedunia),
        ("Shiksha", _scrape_shiksha),
        ("Careers360", _scrape_careers360),
        ("AmbitionBox", _scrape_ambitionbox),
        ("Quora", _scrape_google_quora),
    ]:
        try:
            items = fn(college_name)
            added = 0
            for item in items:
                key = item["company"].lower()
                if key not in seen:
                    seen.add(key)
                    all_results.append(item)
                    added += 1
            log.info("%s → %d new companies for %s", source_label, added, college_name)
        except Exception as e:
            log.warning("%s scraper failed for %s: %s", source_label, college_name, e)

    _save_cache(college_name, all_results)
    log.info("Total: %d unique companies scraped for %s", len(all_results), college_name)
    return all_results
