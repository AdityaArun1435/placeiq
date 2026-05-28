"""
Placement Probability ML Model
--------------------------------
XGBoost regressor trained on real placement_records + college_stats data from Supabase.
1,240 real training rows covering company-level placement data.

Usage:
    python -m backend.ml.placement_model        # trains and saves model
    from backend.ml.placement_model import predict_placement
"""

import logging
import sys
from datetime import date
from pathlib import Path

import joblib
import numpy as np

_log = logging.getLogger("placement_model")

_ML_DIR = Path(__file__).parent
_BACKEND_DIR = _ML_DIR.parent
_PROJECT_DIR = _BACKEND_DIR.parent
_MODEL_PATH = _ML_DIR / "model.pkl"
_ENCODERS_PATH = _ML_DIR / "encoders.pkl"

if str(_PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(_PROJECT_DIR))

from database import get_connection  # noqa: E402

# ── Tier assignment ────────────────────────────────────────────────────────────

def _rank_to_tier(rank) -> str:
    if rank is None:
        return "Tier 3"
    r = int(rank)
    if r <= 10:
        return "Tier 1"
    if r <= 50:
        return "Tier 2"
    if r <= 100:
        return "Tier 3"
    return "Tier 4"


_TIER_SCORE = {"Tier 1": 1, "Tier 2": 2, "Tier 3": 3, "Tier 4": 4}

_KNOWN_BRANCHES = [
    "Computer Science", "Information Technology", "Electronics",
    "Electrical", "Mechanical", "Civil", "Chemical", "Data Science",
    "AI/ML", "Biotechnology", "Other",
]

_KNOWN_ROLES = [
    "Software Engineer", "Data Scientist", "Data Analyst",
    "Product Manager", "DevOps Engineer", "ML Engineer",
    "Frontend Developer", "Backend Developer", "Full Stack Developer",
    "Cybersecurity", "Other",
]

_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def _encode_month(visit_month: str) -> int:
    """Extract integer month from strings like 'August' or 'August–September'."""
    if not visit_month or visit_month.lower() in ("", "none", "nan"):
        return 9
    first = visit_month.replace("–", "-").replace("—", "-").split("-")[0].strip().lower()
    return _MONTH_MAP.get(first, 9)


# ── Training data ─────────────────────────────────────────────────────────────

def load_training_data():
    """
    Returns a DataFrame built from real placement_records joined with college_stats.
    Labels are derived from ctc_avg and avg_headcount thresholds.
    """
    import pandas as pd

    try:
        con = get_connection()
        pr_df = pd.read_sql_query(
            """SELECT p.college_name, p.data_tier, p.ctc_min, p.ctc_max,
                      p.avg_headcount, p.category_tier, p.visit_month,
                      c.avg_ctc          AS college_avg_ctc,
                      c.total_offers     AS college_total_offers
               FROM placement_records p
               LEFT JOIN college_stats c
                 ON lower(c.college_name) = lower(p.college_name)
                AND c.year = '2024'""",
            con,
        )
        con.close()
    except Exception as exc:
        _log.error(f"Failed to load training data from Supabase: {exc}")
        raise

    rows = []
    for _, r in pr_df.iterrows():
        ctc_avg = (float(r["ctc_min"] or 0) + float(r["ctc_max"] or 0)) / 2.0
        headcount = float(r["avg_headcount"] or 0)

        if ctc_avg > 20 and headcount > 50:
            label = 0.85
        elif ctc_avg > 10 and headcount > 20:
            label = 0.70
        elif ctc_avg > 6:
            label = 0.55
        else:
            label = 0.35

        rows.append({
            "college_tier": 1 if str(r["data_tier"]).lower() == "tier1" else 2,
            "ctc_avg": ctc_avg,
            "avg_headcount": headcount,
            "category_tier": str(r["category_tier"] or "Other"),
            "visit_month": _encode_month(str(r["visit_month"] or "")),
            "college_avg_ctc": float(r["college_avg_ctc"] if r["college_avg_ctc"] is not None else ctc_avg),
            "college_total_offers": float(r["college_total_offers"] if r["college_total_offers"] is not None else headcount),
            "label": label,
        })

    df = pd.DataFrame(rows)
    _log.info(f"Loaded {len(df)} real training rows from placement_records")
    return df


# ── Buckets (kept for predict breakdown) ──────────────────────────────────────

def _lc_bucket(val: str) -> int:
    return {"0": 0, "1-50": 1, "51-200": 2, "200+": 3}.get(val, 0)


def _proj_bucket(val: str) -> int:
    return {"0": 0, "1-2": 1, "3-5": 2, "5+": 3}.get(val, 0)


def _hack_bucket(val: str) -> int:
    return {"0": 0, "1-2": 1, "3+": 2}.get(val, 0)


# ── Train ─────────────────────────────────────────────────────────────────────

def train_model() -> dict:
    """
    Train XGBRegressor on real Supabase data and save model.pkl + encoders.pkl.
    Returns {"rmse": float, "r2": float, "n_samples": int}.
    """
    from sklearn.metrics import mean_squared_error, r2_score
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import LabelEncoder
    from xgboost import XGBRegressor

    df = load_training_data()

    encoders: dict[str, LabelEncoder] = {}
    le = LabelEncoder()
    df["category_tier"] = le.fit_transform(df["category_tier"].astype(str))
    encoders["category_tier"] = le

    feature_cols = [
        "college_tier", "ctc_avg", "avg_headcount",
        "category_tier", "visit_month",
        "college_avg_ctc", "college_total_offers",
    ]
    X = df[feature_cols].values.astype(float)
    y = df["label"].values.astype(float)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    model = XGBRegressor(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbosity=0,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
    r2 = float(r2_score(y_test, y_pred))

    joblib.dump(model, _MODEL_PATH)
    joblib.dump(encoders, _ENCODERS_PATH)

    _log.info(f"XGBoost trained on {len(df)} real placement records. R2: {r2:.3f}")
    _log.info(f"Model saved — RMSE={rmse:.4f}, R²={r2:.3f}, n={len(df)}")
    return {"rmse": rmse, "r2": r2, "n_samples": len(df)}


# ── Predict helpers ───────────────────────────────────────────────────────────

_ROLE_TO_CATEGORY = {
    "Software Engineer":    "Core Tech / Product",
    "Backend Developer":    "Core Tech / Product",
    "Full Stack Developer": "Core Tech / Product",
    "Frontend Developer":   "Core Tech / Product",
    "DevOps Engineer":      "Core Tech / Product",
    "Cybersecurity":        "Core Tech / Product",
    "Data Scientist":       "Tier 1 – Elite Tech",
    "ML Engineer":          "Tier 1 – Elite Tech",
    "Data Analyst":         "Product MNC",
    "Product Manager":      "Product MNC",
    "Other":                "Core Tech / Product",
}

_TIER_DEFAULT_CTC       = {"Tier 1": 40.0, "Tier 2": 14.0, "Tier 3": 6.5, "Tier 4": 4.0}
_TIER_DEFAULT_OFFERS    = {"Tier 1": 350.0, "Tier 2": 800.0, "Tier 3": 1200.0, "Tier 4": 600.0}
_TIER_DEFAULT_HEADCOUNT = {"Tier 1": 20.0, "Tier 2": 40.0, "Tier 3": 65.0, "Tier 4": 90.0}


def _lookup_college_stats(college_name: str) -> dict:
    """Fetch avg_ctc and total_offers for a college from college_stats (2024)."""
    try:
        from database import db_type
        con = get_connection()
        ph = "%s" if db_type == "supabase" else "?"
        cur = con.cursor()
        cur.execute(
            f"SELECT avg_ctc, total_offers FROM college_stats "
            f"WHERE lower(college_name) = lower({ph}) AND year='2024' LIMIT 1",
            (college_name.strip(),),
        )
        row = cur.fetchone()
        con.close()
        if row:
            return {"avg_ctc": row[0], "total_offers": row[1]}
    except Exception:
        pass
    return {}


def _lookup_avg_headcount(college_name: str) -> float | None:
    """Compute average headcount across placement_records for a college."""
    try:
        from database import db_type
        con = get_connection()
        ph = "%s" if db_type == "supabase" else "?"
        cur = con.cursor()
        cur.execute(
            f"SELECT AVG(avg_headcount) FROM placement_records "
            f"WHERE lower(college_name) = lower({ph})",
            (college_name.strip(),),
        )
        row = cur.fetchone()
        con.close()
        if row and row[0] is not None:
            return float(row[0])
    except Exception:
        pass
    return None


# ── Predict ───────────────────────────────────────────────────────────────────

def predict_placement(profile: dict) -> dict:
    """
    Predict placement probability for a student profile.

    Args:
        profile: dict with keys: college, branch, cgpa, skills (list),
                 targetRole, hasInternship, leetcodeCount, projectsCount,
                 hackathons, certifications (optional)

    Returns:
        {"score": int, "tier": str, "confidence": str, "breakdown": dict}

    Raises:
        FileNotFoundError if model.pkl / encoders.pkl are missing.
    """
    if not _MODEL_PATH.exists() or not _ENCODERS_PATH.exists():
        raise FileNotFoundError("ML model not trained yet")

    model = joblib.load(_MODEL_PATH)
    encoders: dict = joblib.load(_ENCODERS_PATH)

    college = str(profile.get("college", ""))
    tier = _lookup_tier(college)
    college_tier_enc = {"Tier 1": 1, "Tier 2": 2}.get(tier, 3)

    stats = _lookup_college_stats(college)
    college_avg_ctc = float(stats.get("avg_ctc") or _TIER_DEFAULT_CTC.get(tier, 6.5))
    college_total_offers = float(stats.get("total_offers") or _TIER_DEFAULT_OFFERS.get(tier, 800.0))
    avg_headcount = _lookup_avg_headcount(college) or _TIER_DEFAULT_HEADCOUNT.get(tier, 50.0)
    ctc_avg = college_avg_ctc

    target_role = str(profile.get("targetRole") or profile.get("target_role") or "Other")
    category_str = _ROLE_TO_CATEGORY.get(target_role, "Core Tech / Product")

    le = encoders.get("category_tier")
    if le is not None and category_str in le.classes_:
        category_enc = int(le.transform([category_str])[0])
    else:
        category_enc = 0

    visit_month = date.today().month

    X = np.array([[
        college_tier_enc, ctc_avg, avg_headcount,
        category_enc, visit_month,
        college_avg_ctc, college_total_offers,
    ]], dtype=float)

    raw = float(model.predict(X)[0])
    score = int(np.clip(round(raw * 100), 0, 100))

    confidence = _lookup_confidence(college)

    # Student-level breakdown for transparency
    cgpa = float(profile.get("cgpa") or 6.0)
    skills = profile.get("skills") or []
    skills_count = len(skills) if isinstance(skills, list) else 0
    has_internship = 1 if str(profile.get("hasInternship", profile.get("has_internship", "no"))) == "yes" else 0
    leetcode_raw = str(profile.get("leetcodeCount") or profile.get("leetcode_count") or "0")
    projects_raw = str(profile.get("projectsCount") or profile.get("projects_count") or "0")
    hackathons_raw = str(profile.get("hackathons") or "0")
    certifications_raw = str(profile.get("certifications") or "0")

    tier_base = {"Tier 1": 25, "Tier 2": 15, "Tier 3": 5, "Tier 4": 0}.get(tier, 5)
    cgpa_contribution = round((cgpa / 10) * 25, 1)
    skills_contribution = round((min(skills_count, 15) / 15) * 20, 1)
    internship_contribution = 8 if has_internship else 0
    lc_contribution = [0, 4, 8, 12][_lc_bucket(leetcode_raw)]
    proj_contribution = [0, 5, 9, 12][_proj_bucket(projects_raw)]
    hack_contribution = [0, 3, 6][_hack_bucket(hackathons_raw)]
    cert_pts = {"0": 0, "1-2": 2, "3+": 4}.get(certifications_raw, 0)

    breakdown = {
        "college_tier": {"value": tier, "points": tier_base, "description": f"{tier} college"},
        "cgpa": {"value": cgpa, "points": cgpa_contribution, "description": f"CGPA {cgpa}/10"},
        "skills": {"value": skills_count, "points": skills_contribution, "description": f"{skills_count} skills listed"},
        "internship": {"value": "Yes" if has_internship else "No", "points": internship_contribution, "description": "Internship experience"},
        "leetcode": {"value": leetcode_raw, "points": lc_contribution, "description": f"LeetCode: {leetcode_raw} problems"},
        "projects": {"value": projects_raw, "points": proj_contribution, "description": f"{projects_raw} projects"},
        "hackathons": {"value": hackathons_raw, "points": hack_contribution, "description": f"Hackathons: {hackathons_raw}"},
        "certifications": {"value": certifications_raw, "points": cert_pts, "description": f"Certifications: {certifications_raw}"},
    }

    return {"score": score, "tier": tier, "confidence": confidence, "breakdown": breakdown}


def _lookup_tier(college_name: str) -> str:
    try:
        from database import db_type
        con = get_connection()
        ph = "%s" if db_type == "supabase" else "?"
        cur = con.cursor()
        cur.execute(
            f"SELECT nirf_rank FROM nirf_placements WHERE lower(college_name) = lower({ph})",
            (college_name.strip(),),
        )
        row = cur.fetchone()
        con.close()
        if row and row[0] is not None:
            return _rank_to_tier(row[0])
    except Exception:
        pass
    name_lower = college_name.lower()
    if any(kw in name_lower for kw in ("iit", "nit", "bits", "iisc", "amrita")):
        return "Tier 1"
    if any(kw in name_lower for kw in ("vit", "manipal", "srm", "kiit", "thapar")):
        return "Tier 2"
    return "Tier 3"


def _lookup_confidence(college_name: str) -> str:
    try:
        from database import db_type
        con = get_connection()
        ph = "%s" if db_type == "supabase" else "?"
        cur = con.cursor()
        cur.execute(
            f"SELECT COUNT(*) FROM nirf_placements WHERE lower(college_name) = lower({ph})",
            (college_name.strip(),),
        )
        row = cur.fetchone()
        con.close()
        if row and row[0] > 0:
            return "high"
    except Exception:
        pass
    return "medium"


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    metrics = train_model()
    print(f"Model trained. RMSE: {metrics['rmse']:.4f} R2: {metrics['r2']:.3f}")
