"""
college_lookup.py
-----------------
Fuzzy-match a user-supplied college name against the nirf_placements table
and return enriched stats (tier, placement rate, salaries).

Falls back to keyword heuristics when the DB has no data.
"""

import sys
from difflib import get_close_matches
from pathlib import Path

_PROJECT_DIR = Path(__file__).parent.parent.parent
if str(_PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(_PROJECT_DIR))

from backend.database import get_connection, db_type  # noqa: E402

_TIER_KEYWORDS: list[tuple[list[str], str]] = [
    (["iit", "iisc", "bits pilani", "nit trichy", "nit warangal"], "Tier 1"),
    (["nit", "iiit", "vit", "manipal", "srm", "thapar", "dtu", "nsit"], "Tier 2"),
    (["amity", "lovely", "chandigarh", "chitkara", "lpu"], "Tier 3"),
]

# Short-name → full NIRF college name for common inputs
_COLLEGE_ALIASES: dict[str, str] = {
    "VIT Vellore":          "Vellore Institute of Technology",
    "VIT":                  "Vellore Institute of Technology",
    "VIT Chennai":          "Vellore Institute of Technology Chennai",
    "VIT Bhopal":           "Vellore Institute of Technology Bhopal",
    "VIT AP":               "VIT-AP University",
    "VIT-AP":               "VIT-AP University",
    "SRM KTR":              "SRM Institute of Science and Technology",
    "SRM Kattankulathur":   "SRM Institute of Science and Technology",
    "SRM Chennai":          "SRM Institute of Science and Technology",
    "SRM":                  "SRM Institute of Science and Technology",
    "BITS Pilani":          "Birla Institute of Technology and Science Pilani",
    "BITS Goa":             "Birla Institute of Technology and Science Goa",
    "BITS Hyderabad":       "Birla Institute of Technology and Science Hyderabad",
    "MIT Manipal":          "Manipal Institute of Technology",
    "Manipal":              "Manipal Institute of Technology",
    "NIT Trichy":           "National Institute of Technology Tiruchirappalli",
    "NIT Warangal":         "National Institute of Technology Warangal",
    "NIT Surathkal":        "National Institute of Technology Karnataka Surathkal",
    "NIT Calicut":          "National Institute of Technology Calicut",
    "NIT Rourkela":         "National Institute of Technology Rourkela",
    "NIT Kurukshetra":      "National Institute of Technology Kurukshetra",
    "NIT Allahabad":        "Motilal Nehru National Institute of Technology Allahabad",
    "MNNIT":                "Motilal Nehru National Institute of Technology Allahabad",
    "NIT Bhopal":           "Maulana Azad National Institute of Technology Bhopal",
    "MANIT":                "Maulana Azad National Institute of Technology Bhopal",
    "IIT Madras":           "Indian Institute of Technology Madras",
    "IIT Delhi":            "Indian Institute of Technology Delhi",
    "IIT Bombay":           "Indian Institute of Technology Bombay",
    "IIT Kanpur":           "Indian Institute of Technology Kanpur",
    "IIT Roorkee":          "Indian Institute of Technology Roorkee",
    "IIT Kharagpur":        "Indian Institute of Technology Kharagpur",
    "IIT Guwahati":         "Indian Institute of Technology Guwahati",
    "IIT Hyderabad":        "Indian Institute of Technology Hyderabad",
    "IIT Indore":           "Indian Institute of Technology Indore",
    "IIT Patna":            "Indian Institute of Technology Patna",
    "IIT BHU":              "Indian Institute of Technology BHU Varanasi",
    "IIT (BHU)":            "Indian Institute of Technology BHU Varanasi",
    "IIT Dhanbad":          "Indian Institute of Technology ISM Dhanbad",
    "ISM Dhanbad":          "Indian Institute of Technology ISM Dhanbad",
    "Amrita Coimbatore":    "Amrita School of Engineering Coimbatore",
    "Amrita CBE":           "Amrita School of Engineering Coimbatore",
    "Amrita Chennai":       "Amrita School of Engineering Chennai",
    "Amrita Bengaluru":     "Amrita Vishwa Vidyapeetham Bangalore",
    "Thapar":               "Thapar Institute of Engineering and Technology",
    "PSG Tech":             "PSG College of Technology",
    "CEG Anna University":  "College of Engineering Anna University",
    "CEG Guindy":           "College of Engineering Anna University",
    "COEP":                 "College of Engineering Pune",
    "PESU":                 "PES University",
    "PES University":       "PES University",
    "RVCE":                 "RV College of Engineering",
    "BMSCE":                "BMS College of Engineering",
    "MSRIT":                "MS Ramaiah Institute of Technology",
    "Jadavpur":             "Jadavpur University",
    "Thapar University":    "Thapar Institute of Engineering and Technology",
    "SSN College":          "SSN College of Engineering",
    "SSN":                  "SSN College of Engineering",
    "KEC Erode":            "Kongu Engineering College",
    "SKCET":                "Sri Krishna College of Engineering and Technology",
    "REC Chennai":          "Rajalakshmi Engineering College",
}


def _keyword_tier(name: str) -> str:
    n = name.lower()
    for keywords, tier in _TIER_KEYWORDS:
        if any(kw in n for kw in keywords):
            return tier
    return "Tier 4"


def _fetch_all_names() -> list[str]:
    try:
        con = get_connection()
        try:
            cur = con.cursor()
            cur.execute("SELECT DISTINCT college_name FROM nirf_placements")
            return [row[0] for row in cur.fetchall()]
        finally:
            con.close()
    except Exception:
        return []


def get_college_stats(college_name: str) -> dict:
    """
    Fuzzy-match college_name against nirf_placements and return:
    {
        college_name, nirf_rank, college_tier,
        placement_rate, median_salary, mean_salary, highest_salary,
        graduating_students_count, matched (bool)
    }
    Returns a best-effort dict with matched=False when no DB row found.
    """
    if not college_name:
        return _fallback(college_name)

    # Try exact alias first
    resolved = _COLLEGE_ALIASES.get(college_name)

    all_names = _fetch_all_names()
    if not all_names:
        return _fallback(college_name)

    # If alias resolved, check it exists in DB; otherwise fuzzy-match
    if resolved and resolved in all_names:
        best = resolved
    else:
        # Try fuzzy on both the original name and any alias-resolved name
        candidates = [college_name]
        if resolved:
            candidates.append(resolved)
        best = None
        for candidate in candidates:
            hits = get_close_matches(candidate, all_names, n=1, cutoff=0.6)
            if hits:
                best = hits[0]
                break

    if not best:
        return _fallback(college_name)

    ph = "%s" if db_type == "supabase" else "?"
    try:
        con = get_connection()
        try:
            cur = con.cursor()
            cur.execute(
                f"SELECT college_name, nirf_rank, college_tier, placement_rate, "
                f"median_salary, mean_salary, highest_salary, graduating_students_count "
                f"FROM nirf_placements WHERE college_name = {ph} "
                f"ORDER BY year DESC LIMIT 1",
                (best,),
            )
            row = cur.fetchone()
        finally:
            con.close()

        if not row:
            return _fallback(college_name)

        return {
            "college_name": row[0],
            "nirf_rank": row[1],
            "college_tier": row[2] or _keyword_tier(row[0]),
            "placement_rate": row[3],
            "median_salary": row[4],
            "mean_salary": row[5],
            "highest_salary": row[6],
            "graduating_students_count": row[7],
            "matched": True,
        }
    except Exception:
        return _fallback(college_name)


def get_college_tier(college_name: str) -> str:
    """Return college tier string. Uses DB first, keyword heuristic as fallback."""
    stats = get_college_stats(college_name)
    return stats.get("college_tier") or _keyword_tier(college_name)


def _fallback(college_name: str) -> dict:
    return {
        "college_name": college_name,
        "nirf_rank": None,
        "college_tier": _keyword_tier(college_name),
        "placement_rate": None,
        "median_salary": None,
        "mean_salary": None,
        "highest_salary": None,
        "graduating_students_count": None,
        "matched": False,
    }


import json as _json


def _fetch_placement_sources_from_db(college_name: str) -> list[dict]:
    """Return placement_sources rows for the best fuzzy match of college_name."""
    resolved = _COLLEGE_ALIASES.get(college_name)
    try:
        con = get_connection()
        try:
            cur = con.cursor()
            cur.execute("SELECT DISTINCT college_name FROM placement_sources")
            all_names = [r[0] for r in cur.fetchall()]
            if not all_names:
                return []
            matched = None
            if resolved and resolved in all_names:
                matched = resolved
            else:
                candidates = [college_name]
                if resolved:
                    candidates.append(resolved)
                for candidate in candidates:
                    hits = get_close_matches(candidate, all_names, n=1, cutoff=0.6)
                    if hits:
                        matched = hits[0]
                        break
            if not matched:
                return []
            ph = "%s" if db_type == "supabase" else "?"
            cur.execute(
                f"SELECT source_name, placement_rate, median_salary, highest_salary, "
                f"top_companies, year, url "
                f"FROM placement_sources WHERE college_name = {ph} ORDER BY source_name",
                (matched,),
            )
            rows = cur.fetchall()
            result = []
            for r in rows:
                companies: list = []
                try:
                    companies = _json.loads(r[4]) if r[4] else []
                except Exception:
                    pass
                result.append({
                    "source_name": r[0],
                    "placement_rate": r[1],
                    "median_salary": r[2],
                    "highest_salary": r[3],
                    "top_companies": companies,
                    "year": r[5],
                    "url": r[6],
                })
            return result
        finally:
            con.close()
    except Exception:
        return []


def get_all_college_stats(college_name: str) -> dict:
    """
    Unified college stats combining NIRF 2024 + Shiksha + Careers360.
    Returns combined_placement_rate and combined_median_salary as averages
    across all available data sources.
    """
    nirf_data = get_college_stats(college_name)
    sources = _fetch_placement_sources_from_db(college_name)

    shiksha_data: dict | None = None
    careers360_data: dict | None = None
    for s in sources:
        sname = (s.get("source_name") or "").lower()
        if "shiksha" in sname:
            shiksha_data = s
        elif "careers360" in sname or "career360" in sname:
            careers360_data = s

    rates: list[float] = []
    salaries: list[float] = []

    if nirf_data.get("matched") and nirf_data.get("placement_rate") is not None:
        rates.append(float(nirf_data["placement_rate"]))
    if nirf_data.get("matched") and nirf_data.get("median_salary") is not None:
        salaries.append(float(nirf_data["median_salary"]))
    for s in sources:
        if s.get("placement_rate") is not None:
            rates.append(float(s["placement_rate"]))
        if s.get("median_salary") is not None:
            salaries.append(float(s["median_salary"]))

    combined_placement_rate = round(sum(rates) / len(rates), 1) if rates else None
    combined_median_salary = round(sum(salaries) / len(salaries), 2) if salaries else None

    return {
        "college_name": nirf_data["college_name"],
        "college_tier": nirf_data["college_tier"],
        "nirf_rank": nirf_data.get("nirf_rank"),
        "matched": nirf_data.get("matched", False) or bool(sources),
        "nirf_data": nirf_data if nirf_data.get("matched") else None,
        "shiksha_data": shiksha_data,
        "careers360_data": careers360_data,
        "all_sources": sources,
        "combined_placement_rate": combined_placement_rate,
        "combined_median_salary": combined_median_salary,
        "sources_count": len(rates),
    }
