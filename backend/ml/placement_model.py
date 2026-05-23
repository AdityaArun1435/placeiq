"""
Placement Probability ML Model
--------------------------------
XGBoost regressor trained on nirf_placements + user_profiles data.
Falls back to synthetic training data when the DB table is empty.

Usage:
    python -m backend.ml.placement_model        # trains and saves model
    from backend.ml.placement_model import predict_placement
"""

import json
import logging
import sys
from pathlib import Path

import joblib
import numpy as np

_log = logging.getLogger("placement_model")

_ML_DIR = Path(__file__).parent
_BACKEND_DIR = _ML_DIR.parent
_PROJECT_DIR = _BACKEND_DIR.parent
_MODEL_PATH = _ML_DIR / "model.pkl"
_ENCODERS_PATH = _ML_DIR / "encoders.pkl"

# Allow imports from project root when run as a script
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


# ── Training data ─────────────────────────────────────────────────────────────

def load_training_data():
    """
    Returns (X, y) numpy arrays.

    Priority:
      1. nirf_placements rows joined with user_profiles (real data)
      2. If fewer than 20 real rows, pad with synthetic rows derived from
         the rule-based scoring formula in _fallback_score.
    """
    import pandas as pd

    rows = []

    # Real data from nirf_placements + user_profiles
    try:
        con = get_connection()
        nirf_df = pd.read_sql_query(
            "SELECT college_name, nirf_rank, placement_rate FROM nirf_placements",
            con,
        )
        users_df = pd.read_sql_query(
            """SELECT college, branch, cgpa, skills, target_role,
                      placement_score, has_internship, leetcode_count,
                      projects_count, hackathons
               FROM user_profiles""",
            con,
        )
        con.close()

        # Build a lookup: college_name → (nirf_rank, placement_rate)
        nirf_lookup = {}
        for _, row in nirf_df.iterrows():
            nirf_lookup[str(row["college_name"]).strip().lower()] = (
                row["nirf_rank"],
                row["placement_rate"],
            )

        for _, u in users_df.iterrows():
            college_key = str(u.get("college", "")).strip().lower()
            nirf_rank, placement_rate = nirf_lookup.get(college_key, (None, None))

            # Use nirf placement_rate as label if available, else use stored score
            if placement_rate is not None:
                label = float(placement_rate)
            else:
                label = float(u.get("placement_score") or 50)

            try:
                skills_list = json.loads(u["skills"]) if isinstance(u["skills"], str) else (u["skills"] or [])
            except Exception:
                skills_list = []

            rows.append({
                "tier": _rank_to_tier(nirf_rank),
                "branch": str(u.get("branch") or "Other"),
                "cgpa": float(u.get("cgpa") or 6.0),
                "skills_count": len(skills_list),
                "target_role": str(u.get("target_role") or "Other"),
                "has_internship": 1 if str(u.get("has_internship", "no")) == "yes" else 0,
                "leetcode": _lc_bucket(str(u.get("leetcode_count") or "0")),
                "projects": _proj_bucket(str(u.get("projects_count") or "0")),
                "hackathons": _hack_bucket(str(u.get("hackathons") or "0")),
                "label": label,
            })
    except Exception as exc:
        _log.warning(f"Could not load real training data: {exc}")

    if len(rows) < 20:
        _log.info(f"Only {len(rows)} real rows — padding with synthetic data")
        rows.extend(_synthetic_rows())

    df = pd.DataFrame(rows)
    _log.info(f"Training dataset: {len(df)} rows")
    return df


def _lc_bucket(val: str) -> int:
    return {"0": 0, "1-50": 1, "51-200": 2, "200+": 3}.get(val, 0)


def _proj_bucket(val: str) -> int:
    return {"0": 0, "1-2": 1, "3-5": 2, "5+": 3}.get(val, 0)


def _hack_bucket(val: str) -> int:
    return {"0": 0, "1-2": 1, "3+": 2}.get(val, 0)


def _synthetic_rows() -> list[dict]:
    """Generate ~400 synthetic training rows covering the placement score space."""
    rng = np.random.default_rng(42)
    rows = []

    tier_base = {"Tier 1": 75, "Tier 2": 55, "Tier 3": 35, "Tier 4": 20}

    for tier, base in tier_base.items():
        for _ in range(100):
            cgpa = float(rng.uniform(4.5, 10.0))
            skills_count = int(rng.integers(0, 16))
            has_internship = int(rng.integers(0, 2))
            leetcode = int(rng.integers(0, 4))
            projects = int(rng.integers(0, 4))
            hackathons = int(rng.integers(0, 3))
            branch = rng.choice(_KNOWN_BRANCHES)
            role = rng.choice(_KNOWN_ROLES)

            # Rule-based label (mirrors _fallback_score logic)
            cgpa_pts = (cgpa / 10) * 25
            skills_pts = (min(skills_count, 15) / 15) * 25
            intern_pts = 7 if has_internship else 0
            lc_pts = [0, 3, 6, 8][leetcode]
            proj_pts = [0, 5, 8, 10][projects]
            hack_pts = [0, 3, 5][hackathons]
            noise = float(rng.normal(0, 5))

            raw = cgpa_pts + skills_pts + intern_pts + lc_pts + proj_pts + hack_pts
            label = float(np.clip(base * 0.4 + raw * 0.6 + noise, 5, 100))

            rows.append({
                "tier": tier,
                "branch": str(branch),
                "cgpa": cgpa,
                "skills_count": skills_count,
                "target_role": str(role),
                "has_internship": has_internship,
                "leetcode": leetcode,
                "projects": projects,
                "hackathons": hackathons,
                "label": label,
            })

    return rows


# ── Train ─────────────────────────────────────────────────────────────────────

def train_model() -> dict:
    """
    Train XGBRegressor and save model.pkl + encoders.pkl.
    Returns {"rmse": float, "r2": float, "n_samples": int}.
    """
    from sklearn.metrics import mean_squared_error, r2_score
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import LabelEncoder
    from xgboost import XGBRegressor

    df = load_training_data()

    # Encode categoricals
    encoders: dict[str, LabelEncoder] = {}
    for col in ("tier", "branch", "target_role"):
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        encoders[col] = le

    feature_cols = [
        "tier", "branch", "cgpa", "skills_count",
        "target_role", "has_internship", "leetcode", "projects", "hackathons",
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

    _log.info(f"Model saved — RMSE={rmse:.2f}, R²={r2:.3f}, n={len(df)}")
    return {"rmse": rmse, "r2": r2, "n_samples": len(df)}


# ── Predict ───────────────────────────────────────────────────────────────────

def predict_placement(profile: dict) -> dict:
    """
    Predict placement probability for a student profile.

    Args:
        profile: dict with keys matching ProfileIn fields:
                 college, branch, cgpa, skills (list), targetRole,
                 hasInternship, leetcodeCount, projectsCount, hackathons,
                 certifications (optional), city (optional)

    Returns:
        {"score": int, "tier": str, "confidence": str, "breakdown": dict}

    Raises:
        FileNotFoundError if model.pkl / encoders.pkl are missing.
    """
    if not _MODEL_PATH.exists() or not _ENCODERS_PATH.exists():
        raise FileNotFoundError("ML model not trained yet")

    model = joblib.load(_MODEL_PATH)
    encoders: dict = joblib.load(_ENCODERS_PATH)

    # Derive college tier from DB
    tier = _lookup_tier(str(profile.get("college", "")))

    branch = str(profile.get("branch") or "Other")
    cgpa = float(profile.get("cgpa") or 6.0)
    skills = profile.get("skills") or []
    skills_count = len(skills) if isinstance(skills, list) else 0
    target_role = str(profile.get("targetRole") or profile.get("target_role") or "Other")
    has_internship = 1 if str(profile.get("hasInternship", profile.get("has_internship", "no"))) == "yes" else 0
    leetcode_raw = str(profile.get("leetcodeCount") or profile.get("leetcode_count") or "0")
    projects_raw = str(profile.get("projectsCount") or profile.get("projects_count") or "0")
    hackathons_raw = str(profile.get("hackathons") or "0")
    certifications_raw = str(profile.get("certifications") or "0")

    leetcode = _lc_bucket(leetcode_raw)
    projects = _proj_bucket(projects_raw)
    hackathons = _hack_bucket(hackathons_raw)

    def _encode(col: str, val: str) -> int:
        le = encoders[col]
        if val in le.classes_:
            return int(le.transform([val])[0])
        return 0

    tier_enc = _encode("tier", tier)
    branch_enc = _encode("branch", branch)
    role_enc = _encode("target_role", target_role)

    X = np.array([[
        tier_enc, branch_enc, cgpa, skills_count,
        role_enc, has_internship, leetcode, projects, hackathons,
    ]], dtype=float)

    raw = float(model.predict(X)[0])
    score = int(np.clip(round(raw), 0, 100))

    # Confidence: high if the model had real NIRF data for this college
    confidence = _lookup_confidence(str(profile.get("college", "")))

    # Feature contribution breakdown (rule-based approximation for transparency)
    tier_base = {"Tier 1": 25, "Tier 2": 15, "Tier 3": 5, "Tier 4": 0}.get(tier, 5)
    cgpa_contribution = round((cgpa / 10) * 25, 1)
    skills_contribution = round((min(skills_count, 15) / 15) * 20, 1)
    internship_contribution = 8 if has_internship else 0
    lc_contribution = [0, 4, 8, 12][leetcode]
    proj_contribution = [0, 5, 9, 12][projects]
    hack_contribution = [0, 3, 6][hackathons]
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
    # Heuristic tier from college name keywords
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
    print(f"Model trained. RMSE: {metrics['rmse']:.2f} R2: {metrics['r2']:.3f}")
