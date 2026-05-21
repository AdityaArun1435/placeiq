import io
import json
import math
import os
import re
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pdfplumber
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from groq import Groq
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import UserProfile, ProfileIn, ProfileOut, SkillsGapIn, CompanyMatchIn, RoadmapIn, RoadmapChatIn

load_dotenv()

Base.metadata.create_all(bind=engine)


def _migrate():
    inspector = inspect(engine)
    if "user_profiles" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("user_profiles")}
    additions = {
        "score_reasoning":   "TEXT DEFAULT ''",
        "college_tier":      "VARCHAR DEFAULT ''",
        "projects_count":    "VARCHAR DEFAULT '0'",
        "has_internship":    "VARCHAR DEFAULT 'no'",
        "internship_months": "VARCHAR DEFAULT ''",
        "hackathons":        "VARCHAR DEFAULT '0'",
        "leetcode_count":    "VARCHAR DEFAULT '0'",
        "open_source":       "VARCHAR DEFAULT 'no'",
        "certifications":    "VARCHAR DEFAULT '0'",
        "github_active":     "VARCHAR DEFAULT 'no'",
    }
    with engine.begin() as conn:
        for col, definition in additions.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE user_profiles ADD COLUMN {col} {definition}"))


_migrate()

_groq_key = os.getenv("GROQ_API_KEY", "")
_groq = Groq(api_key=_groq_key) if (_groq_key and _groq_key != "your_key_here") else None

MARKET_CACHE_PATH = Path(__file__).parent / "market_cache.json"
MARKET_CACHE_TTL_HOURS = 24

SKILL_KEYWORDS = [
    "Python", "Java", "JavaScript", "React", "Node.js", "SQL", "AWS", "Docker",
    "Kubernetes", "Machine Learning", "Deep Learning", "TypeScript", "Go", "Rust",
    "MongoDB", "PostgreSQL", "Redis", "FastAPI", "Django", "Spring Boot", "Flutter",
    "Android", "iOS", "Swift", "Kotlin", "C++", "C", "Git", "Linux", "Azure",
    "GCP", "Terraform", "Jenkins", "GraphQL", "REST API", "Microservices",
    "System Design", "Data Structures", "Algorithms",
]

ADZUNA_ROLES = [
    "software engineer", "data scientist", "frontend developer", "backend developer",
    "devops engineer", "machine learning engineer", "full stack developer",
    "android developer", "product manager",
]


async def fetch_adzuna_data() -> tuple[list, dict]:
    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        raise ValueError("ADZUNA_APP_ID and ADZUNA_APP_KEY must be set")

    all_jobs: list = []
    role_counts: dict = {}

    async with httpx.AsyncClient(timeout=15) as client:
        for role in ADZUNA_ROLES:
            try:
                resp = await client.get(
                    "https://api.adzuna.com/v1/api/jobs/in/search/1",
                    params={
                        "app_id": app_id,
                        "app_key": app_key,
                        "results_per_page": 50,
                        "what": role,
                        "content-type": "application/json",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                role_counts[role] = data.get("count", 0)
                all_jobs.extend(data.get("results", []))
            except Exception as exc:
                print(f"[Adzuna] Failed for role '{role}': {exc}")
                role_counts[role] = 0

    return all_jobs, role_counts


def extract_skills_from_jobs(jobs: list) -> list[tuple[str, int]]:
    skill_counts: dict[str, int] = {s: 0 for s in SKILL_KEYWORDS}
    for job in jobs:
        desc = job.get("description", "").lower()
        for skill in SKILL_KEYWORDS:
            if skill.lower() in desc:
                skill_counts[skill] += 1
    return sorted(skill_counts.items(), key=lambda x: x[1], reverse=True)[:20]


def normalize_score(count: int, max_count: int) -> int:
    if count == 0 or max_count == 0:
        return 0
    return min(100, int((math.log(count + 1) / math.log(max_count + 1)) * 100))


async def refresh_market_cache() -> dict:
    print("[Market] Refreshing market cache from Adzuna…")
    try:
        all_jobs, role_counts = await fetch_adzuna_data()
    except Exception as exc:
        print(f"[Market] Adzuna fetch failed: {exc}")
        all_jobs, role_counts = [], {}

    top_skills = extract_skills_from_jobs(all_jobs)

    # Pre-compute log-normalised scores to pass to Groq
    max_count = top_skills[0][1] if top_skills else 1
    skills_with_scores = [
        {"skill": s, "raw_count": c, "log_score": normalize_score(c, max_count)}
        for s, c in top_skills
    ]

    # Sample companies from job results for the prompt
    sample_companies = list({
        j.get("company", {}).get("display_name", "")
        for j in all_jobs[:200]
        if j.get("company", {}).get("display_name")
    })[:30]

    # Build Groq prompt using real data
    prompt = (
        "Here is REAL live job market data fetched from Adzuna API for India today:\n"
        f"- Total jobs found per role: {json.dumps(role_counts)}\n"
        f"- Skills extracted from {len(all_jobs)} actual job postings, with pre-computed log-normalised scores:\n"
        f"  {json.dumps(skills_with_scores)}\n"
        f"- Sample hiring companies seen in listings: {json.dumps(sample_companies)}\n\n"
        "Using this REAL data, generate a comprehensive market intelligence JSON object for Indian engineering students in 2026.\n\n"
        "Rules:\n"
        "- demand_score: START with the log_score provided above for each skill, then ADJUST based on actual relevance for "
        "Indian fresher software engineering jobs in 2026. A skill appearing in many job postings for niche roles "
        "(embedded C, legacy COBOL) should score lower than a skill appearing across many general software roles "
        "(Python, JavaScript, Java). Weight by breadth of application across the Indian tech industry, not just raw count. "
        "C appearing in embedded/systems job descriptions should score at most 30 for a general software fresher audience — "
        "skills like Python, Java, JavaScript that apply broadly should score higher even with lower raw counts.\n"
        "- role openings: use the EXACT role_counts numbers from the data above.\n"
        "- top_companies for skills/roles: pick from the sample hiring companies list above where relevant, supplement with well-known Indian employers.\n"
        "- why_trending: 1 sentence explaining WHY this skill is in demand in India right now (specific, not generic).\n"
        "- reality_check: 1 brutal honest sentence about the competition/difficulty for freshers targeting this role.\n"
        "- salary_by_city: use realistic 2026 Indian fresher salaries (Bangalore highest, tier-2 cities lower).\n"
        "- hot_sectors: 6 sectors, mix of Booming/Stable/Slow based on actual market data.\n"
        "- skills_to_avoid: 3-4 outdated or oversaturated skills Indian freshers waste time on.\n\n"
        "Return ONLY a JSON object with EXACTLY this structure (no extra fields, no markdown):\n"
        "{\n"
        '  "trending_skills": [\n'
        '    {\n'
        '      "skill": "Python",\n'
        '      "demand_score": 95,\n'
        '      "trend": "rising",\n'
        '      "avg_salary_lpa": 12,\n'
        '      "job_count": 4200,\n'
        '      "why_trending": "one sentence why this skill is hot in India right now",\n'
        '      "top_companies": ["TCS", "Infosys", "Zoho"]\n'
        "    }\n"
        "  ],\n"
        '  "role_demand": [\n'
        '    {\n'
        '      "role": "Software Engineer",\n'
        '      "openings": 15000,\n'
        '      "avg_lpa": 14,\n'
        '      "yoy_change": "+18%",\n'
        '      "top_companies": ["TCS", "Wipro", "Infosys"],\n'
        '      "key_skills": ["Python", "Java", "DSA"],\n'
        '      "reality_check": "one brutal sentence about fresher competition for this role"\n'
        "    }\n"
        "  ],\n"
        '  "top_hiring_companies": ["TCS", "Infosys"],\n'
        '  "salary_by_city": [\n'
        '    {\n'
        '      "city": "Bangalore",\n'
        '      "avg_lpa": 18,\n'
        '      "cost_of_living": "High",\n'
        '      "best_for_roles": ["Software Engineer", "Data Scientist"]\n'
        "    }\n"
        "  ],\n"
        '  "hot_sectors": [\n'
        '    {\n'
        '      "sector": "FinTech",\n'
        '      "status": "Booming",\n'
        '      "reason": "one sentence why"\n'
        "    }\n"
        "  ],\n"
        '  "skills_to_avoid": [\n'
        '    {\n'
        '      "skill": "COBOL",\n'
        '      "reason": "one sentence why freshers should avoid wasting time on this"\n'
        "    }\n"
        "  ],\n"
        '  "market_summary": "2-3 sentences summarising the Indian job market right now based on the real data",\n'
        '  "data_freshness": "Live data from Adzuna — fetched today"\n'
        "}"
    )

    if not _groq:
        raise RuntimeError("Groq client not initialised — check GROQ_API_KEY")

    completion = _groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    raw = completion.choices[0].message.content or ""
    print(f"[Market] Groq response preview: {raw[:300]!r}")
    result = parse_groq_json(raw)

    # Stamp and persist
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": result,
        "meta": {
            "total_jobs": len(all_jobs),
            "role_counts": role_counts,
            "top_skills": [{"skill": s, "count": c} for s, c in top_skills],
        },
    }
    MARKET_CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[Market] Cache written to {MARKET_CACHE_PATH}")
    return payload


def _load_market_cache() -> dict | None:
    if not MARKET_CACHE_PATH.exists():
        return None
    try:
        payload = json.loads(MARKET_CACHE_PATH.read_text(encoding="utf-8"))
        ts = datetime.fromisoformat(payload["timestamp"])
        if datetime.now(timezone.utc) - ts < timedelta(hours=MARKET_CACHE_TTL_HOURS):
            return payload
        print("[Market] Cache expired, will refresh")
    except Exception as exc:
        print(f"[Market] Cache read error: {exc}")
    return None


app = FastAPI(title="PlaceIQ API")

_scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def _startup():
    _scheduler.add_job(refresh_market_cache, "cron", hour=0, minute=0)
    _scheduler.start()
    print("[Market] Scheduler started — daily refresh at midnight UTC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    print("\n[422 DEBUG] Validation error on:", request.method, request.url)
    print("[422 DEBUG] Content-Type:", request.headers.get("content-type", "NOT SET"))
    print("[422 DEBUG] Errors:", exc.errors())
    return await request_validation_exception_handler(request, exc)


def _fallback_score(
    cgpa: float, skills: list, year: str, projects_count: str,
    has_internship: str, internship_months: str, hackathons: str,
    leetcode_count: str, open_source: str, certifications: str,
    github_active: str,
) -> int:
    cgpa_pts      = (cgpa / 10) * 25
    skills_pts    = (min(len(skills), 15) / 15) * 25
    year_pts      = {"1st": 2, "2nd": 5, "3rd": 8, "4th": 10}.get(year, 5)
    projects_pts  = {"0": 0, "1-2": 5, "3-5": 8, "5+": 10}.get(projects_count, 0)
    if has_internship == "yes":
        intern_pts = {"1-3": 5, "3-6": 8, "6+": 10}.get(internship_months, 5)
    else:
        intern_pts = 0
    hackathon_pts = {"0": 0, "1-2": 3, "3+": 5}.get(hackathons, 0)
    leetcode_pts  = {"0": 0, "1-50": 2, "51-200": 5, "200+": 8}.get(leetcode_count, 0)
    opensource_pts = 3 if open_source == "yes" else 0
    cert_pts      = {"0": 0, "1-2": 1, "3+": 2}.get(certifications, 0)
    github_pts    = 2 if github_active == "yes" else 0
    return round(cgpa_pts + skills_pts + year_pts + projects_pts + intern_pts
                 + hackathon_pts + leetcode_pts + opensource_pts + cert_pts + github_pts)


def parse_groq_json(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw.strip())


def groq_score(payload: ProfileIn) -> tuple[int, str, str]:
    if _groq is None:
        score = _fallback_score(
            payload.cgpa, payload.skills, payload.year, payload.projectsCount,
            payload.hasInternship, payload.internshipMonths, payload.hackathons,
            payload.leetcodeCount, payload.openSource, payload.certifications,
            payload.githubActive,
        )
        return score, "", ""

    internship_str = (
        f"Yes ({payload.internshipMonths} months)"
        if payload.hasInternship == "yes"
        else "No"
    )

    prompt = (
        "You are a brutally honest placement prediction expert for Indian engineering students. "
        "You have deep knowledge of actual placement realities at Indian colleges.\n\n"
        "STRICT RULES you must follow:\n"
        "- Most companies visiting Tier 2 colleges (VIT, SRM, Manipal, Amrita) have a CGPA cutoff of 7.5 or 8.0. "
        "A student with CGPA below 7.5 at a Tier 2 college is filtered out before even getting an interview at most companies. "
        "Their score should reflect this — typically 15-30% max.\n"
        "- At Tier 1 colleges (IITs, NITs, BITS), CGPA matters less because the brand carries weight, "
        "but below 6.5 is still a red flag.\n"
        "- At Tier 3 colleges, on-campus placement itself is rare. Even strong students should not score above 60% "
        "unless they have exceptional off-campus skills (strong LeetCode, internships, projects).\n"
        "- Skills without projects to back them up add very little value. "
        "Listing 10 skills with 0 projects should not give a high score.\n"
        "- A student in 1st or 2nd year should score lower — placements are 2+ years away, too early to predict accurately.\n"
        "- Internship experience is a strong positive signal — weight it heavily.\n"
        "- LeetCode 200+ problems is a strong signal for SWE roles specifically.\n\n"
        "Given this student profile, return a JSON object with exactly three fields:\n"
        "- score (integer 0-100): brutally realistic placement probability at THEIR college\n"
        "- reasoning (3-4 sentences being specific about what is hurting and helping their score, "
        "mentioning their actual college name and CGPA cutoffs they may not meet)\n"
        "- college_tier (string: \"Tier 1\", \"Tier 2\", or \"Tier 3\")\n\n"
        "Only return valid JSON, nothing else.\n\n"
        f"Profile:\n"
        f"- College: {payload.college}\n"
        f"- Branch: {payload.branch}\n"
        f"- Year: {payload.year}\n"
        f"- CGPA: {payload.cgpa}/10\n"
        f"- Skills: {', '.join(payload.skills)}\n"
        f"- Target Role: {payload.targetRole}\n"
        f"- Projects: {payload.projectsCount}\n"
        f"- Internship: {internship_str}\n"
        f"- Hackathons: {payload.hackathons}\n"
        f"- LeetCode solved: {payload.leetcodeCount}\n"
        f"- Open source contributions: {payload.openSource}\n"
        f"- Certifications: {payload.certifications}\n"
        f"- GitHub active: {payload.githubActive}"
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        response_text = completion.choices[0].message.content
        result = parse_groq_json(response_text)
        score = max(0, min(100, int(result["score"])))
        reasoning = str(result["reasoning"])
        college_tier = str(result.get("college_tier", ""))
        return score, reasoning, college_tier
    except Exception:
        score = _fallback_score(
            payload.cgpa, payload.skills, payload.year, payload.projectsCount,
            payload.hasInternship, payload.internshipMonths, payload.hackathons,
            payload.leetcodeCount, payload.openSource, payload.certifications,
            payload.githubActive,
        )
        return score, "", ""


def _to_out(p: UserProfile) -> ProfileOut:
    return ProfileOut(
        email=p.email,
        college=p.college,
        branch=p.branch,
        year=p.year,
        cgpa=p.cgpa,
        skills=p.skills,
        targetRole=p.target_role,
        placementScore=p.placement_score,
        scoreReasoning=p.score_reasoning or "",
        collegeTier=p.college_tier or "",
        projectsCount=p.projects_count or "0",
        hasInternship=p.has_internship or "no",
        internshipMonths=p.internship_months or "",
        hackathons=p.hackathons or "0",
        leetcodeCount=p.leetcode_count or "0",
        openSource=p.open_source or "no",
        certifications=p.certifications or "0",
        githubActive=p.github_active or "no",
    )


@app.post("/api/user/profile", response_model=ProfileOut)
def save_profile(payload: ProfileIn, db: Session = Depends(get_db)):
    score, reasoning, college_tier = groq_score(payload)

    existing = db.query(UserProfile).filter(UserProfile.email == payload.email).first()
    if existing:
        existing.college = payload.college
        existing.branch = payload.branch
        existing.year = payload.year
        existing.cgpa = payload.cgpa
        existing.skills = payload.skills
        existing.target_role = payload.targetRole
        existing.placement_score = score
        existing.score_reasoning = reasoning
        existing.college_tier = college_tier
        existing.projects_count = payload.projectsCount
        existing.has_internship = payload.hasInternship
        existing.internship_months = payload.internshipMonths
        existing.hackathons = payload.hackathons
        existing.leetcode_count = payload.leetcodeCount
        existing.open_source = payload.openSource
        existing.certifications = payload.certifications
        existing.github_active = payload.githubActive
        db.commit()
        db.refresh(existing)
        return _to_out(existing)

    profile = UserProfile(
        email=payload.email,
        college=payload.college,
        branch=payload.branch,
        year=payload.year,
        cgpa=payload.cgpa,
        skills=payload.skills,
        target_role=payload.targetRole,
        placement_score=score,
        score_reasoning=reasoning,
        college_tier=college_tier,
        projects_count=payload.projectsCount,
        has_internship=payload.hasInternship,
        internship_months=payload.internshipMonths,
        hackathons=payload.hackathons,
        leetcode_count=payload.leetcodeCount,
        open_source=payload.openSource,
        certifications=payload.certifications,
        github_active=payload.githubActive,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _to_out(profile)


@app.get("/api/user/profile/{email}", response_model=ProfileOut)
def get_profile(email: str, db: Session = Depends(get_db)):
    profile = db.query(UserProfile).filter(UserProfile.email == email).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _to_out(profile)


def extract_text_from_pdf(file_bytes: bytes) -> str:
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        text = " ".join(page.extract_text() or "" for page in pdf.pages).strip()

    if len(text) < 100:
        raise ValueError(
            "Could not extract text from this PDF. Please upload a text-based PDF "
            "(created in Google Docs, Word, or Canva). "
            "Scanned or image-based PDFs are not supported yet."
        )

    return text


# Minimal test endpoint — use this to confirm routing + multipart parsing work
@app.post("/api/resume/analyse-test")
async def analyse_resume_test(
    file: UploadFile = File(...),
    target_role: str = Form(...),
):
    return {"filename": file.filename, "content_type": file.content_type, "target_role": target_role}


@app.get("/api/resume/schema")
async def resume_schema():
    return {
        "endpoint": "POST /api/resume/analyse",
        "fields": {
            "file": "UploadFile (multipart, required)",
            "target_role": "string form field (required)",
            "user_skills": "string form field (optional, default '[]')",
        },
        "note": "Do NOT set Content-Type manually — browser sets it with multipart boundary",
    }


@app.post("/api/resume/analyse")
async def analyse_resume(
    file: UploadFile = File(...),
    target_role: str = Form(...),
    user_skills: str = Form(default="[]"),
):
    try:
        print(f"[DEBUG] file={file.filename!r}  content_type={file.content_type!r}  target_role={target_role!r}")

        # Accept any PDF-like content type — browsers vary
        pdf_types = {"application/pdf", "application/x-pdf", "application/octet-stream", "binary/octet-stream"}
        filename_is_pdf = (file.filename or "").lower().endswith(".pdf")
        if file.content_type not in pdf_types and not filename_is_pdf:
            raise HTTPException(status_code=400, detail="Only PDF files are supported.")

        contents = await file.read()
        try:
            resume_text = extract_text_from_pdf(contents)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=400, detail="Could not read PDF. Make sure it is a valid file.")

        print(f"[DEBUG] Extracted text length: {len(resume_text)} chars")
        print(f"[DEBUG] First 200 chars: {resume_text[:200]!r}")

        # Truncate before sending — Groq's context window is large but long resumes slow it down
        resume_text = resume_text[:3000]

        if _groq is None:
            raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

        prompt = (
            f"You are an expert resume reviewer for Indian engineering students targeting placements. "
            f"Analyse this resume for a student targeting the role of {target_role}.\n\n"
            "Return a JSON object with exactly these fields:\n"
            "- resume_score (integer 0-100): overall resume quality score\n"
            "- strengths (list of 3-4 strings): what the resume does well\n"
            "- gaps (list of 4-5 strings): specific things missing or weak in this resume for the target role\n"
            f"- missing_skills (list of strings): skills commonly required for {target_role} that are absent from the resume\n"
            "- ats_issues (list of strings): formatting or keyword issues that would get this resume rejected by ATS systems\n"
            "- one_line_verdict (string): one brutal honest sentence summarising the resume's chances\n\n"
            "Only return valid JSON, nothing else.\n"
            "IMPORTANT: Return only raw JSON with no markdown formatting, no backticks, no code fences.\n\n"
            f"Resume text:\n{resume_text}"
        )

        def generate():
            try:
                print("[DEBUG] Calling Groq API (streaming)...")
                stream = _groq.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                    stream=True,
                )
                print("[DEBUG] Groq stream open, reading chunks...")
                collected = []
                for chunk in stream:
                    content = chunk.choices[0].delta.content
                    if content:
                        collected.append(content)
                        yield content
                print(f"[DEBUG] Groq stream done. First 200 chars: {''.join(collected)[:200]!r}")
            except Exception as e:
                traceback.print_exc()
                yield json.dumps({"error": f"Groq API error: {str(e)}"})

        return StreamingResponse(generate(), media_type="text/plain")

    except HTTPException:
        raise  # pass through intentional HTTP errors unchanged
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/skills/gap")
async def skills_gap(payload: SkillsGapIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    skills_str = ", ".join(payload.skills) if payload.skills else "None listed"

    prompt = (
        "You are a technical hiring expert with deep knowledge of the Indian job market in 2025. "
        "You know exactly what skills companies like TCS, Infosys, Wipro, Accenture, Cognizant, HCL "
        "(service companies), and product companies like Google, Microsoft, Amazon, Flipkart, Swiggy, "
        "Zepto, Razorpay, CRED, PhonePe, Groww (product/startup companies) actually look for when "
        "hiring freshers in India.\n\n"
        "Given this student's profile, analyse their skill gaps for their target role.\n\n"
        "Student Profile:\n"
        f"- Target Role: {payload.target_role}\n"
        f"- Current Skills: {skills_str}\n"
        f"- College Tier: {payload.college_tier or 'Unknown'}\n"
        f"- Branch: {payload.branch or 'Not specified'}\n"
        f"- CGPA: {payload.cgpa}/10\n\n"
        "Return a JSON object with exactly these fields:\n\n"
        "- must_have_missing (list of objects): Skills that are MANDATORY for "
        f"{payload.target_role} that this student is missing. Each object: "
        '{"skill": "...", "why_important": "...", "time_to_learn": "...", "free_resource_link": "..."}. '
        "Only include skills that are genuinely missing from their profile. Be specific — not just "
        "'DSA' but 'Dynamic Programming', 'Graph Algorithms' etc.\n\n"
        "- good_to_have_missing (list of objects): Skills that give a strong edge but aren't mandatory. "
        "Same format as above.\n\n"
        "- skills_to_improve (list of objects): Skills they have listed but are likely weak at based on "
        "their profile — common for freshers. Each object: "
        '{"skill": "...", "what_to_focus_on": "...", "free_resource_link": "..."}.\n\n'
        "- service_company_ready (boolean): Are they ready for TCS/Infosys/Wipro/Accenture level hiring "
        "RIGHT NOW based on their profile?\n\n"
        "- product_company_ready (boolean): Are they ready for product/startup company hiring right now?\n\n"
        "- verdict (string): 2-3 sentences being brutally honest about their current market position in "
        "India, mentioning specific company tiers they can and cannot target right now.\n\n"
        "Rules:\n"
        "- For Software Engineer roles: DSA is non-negotiable for product companies. TCS/Infosys mainly "
        "test aptitude + basic coding, not hard DSA.\n"
        "- For Data Science roles: Python, Pandas, SQL, and at least one ML framework are must-haves.\n"
        "- For Frontend roles: React + JavaScript fundamentals are must-haves. TypeScript is good to have.\n"
        "- For DevOps roles: Linux, Docker, at least one cloud (AWS/GCP/Azure) are must-haves.\n"
        "- Be specific about free_resource_link — use actual URLs like https://leetcode.com, "
        "https://www.youtube.com/@takeUforward, https://missing.csail.mit.edu etc.\n"
        "- Do not list skills they already have as missing.\n"
        "- If they have strong skills already, acknowledge it — don't manufacture gaps.\n\n"
        "Only return valid JSON with no markdown formatting."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq skill gap response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/companies/match")
async def companies_match(payload: CompanyMatchIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    skills_str = ", ".join(payload.skills) if payload.skills else "None listed"
    internship_str = (
        f"Yes ({payload.internship_months} months)"
        if payload.has_internship == "yes"
        else "No"
    )

    prompt = (
        "You are a placement expert with insider knowledge of exactly how each major Indian company "
        "hires freshers in 2025-2026. You know each company's specific hiring process, what their "
        "interviewers actually test, and what differentiates candidates who get offers.\n\n"
        "Given this student profile, return 15 company matches with highly specific, company-unique "
        "feedback.\n\n"
        "Student Profile:\n"
        f"- College: {payload.college}\n"
        f"- College Tier: {payload.college_tier or 'Unknown'}\n"
        f"- Branch: {payload.branch}\n"
        f"- CGPA: {payload.cgpa}/10\n"
        f"- Skills: {skills_str}\n"
        f"- Target Role: {payload.target_role}\n"
        f"- Projects: {payload.projects_count}\n"
        f"- Internship: {internship_str}\n"
        f"- LeetCode: {payload.leetcode_count} problems solved\n"
        f"- Hackathons: {payload.hackathons}\n"
        f"- GitHub Active: {payload.github_active}\n\n"
        "For each company, the why_match and biggest_gap must be SPECIFIC to that exact company — "
        "not generic statements. Examples of what specific means:\n\n"
        "BAD (generic): 'Company considers students with good skills and focus on problem solving'\n"
        "GOOD (specific): 'TCS NextStep hiring in 2026 requires clearing their TCS NQT exam which "
        "tests numerical reasoning, verbal ability and coding. Your Python skills help but you need "
        "to specifically practice their NQT pattern on PrepInsta.'\n\n"
        "BAD (generic): 'High competition might be a challenge'\n"
        "GOOD (specific): 'Zoho has no mass recruitment — they hire through their own Zoho Recruit "
        "platform and give a multi-round coding test in C. They specifically want students who can "
        "code in C, not just Python.'\n\n"
        "Company-specific facts you must use:\n"
        "- TCS: Hires via TCS NQT exam. Tests numerical reasoning, verbal, programming logic. "
        "Mass recruiter, CGPA 6.0+. Package 3.36-7 LPA depending on stream.\n"
        "- Infosys: Hires via InfyTQ platform + Infosys Instep. Tests coding + aptitude. "
        "CGPA 6.5+. Package 3.6-6.25 LPA.\n"
        "- Wipro: WILP and Elite tracks. CGPA 6.0+. Tests aptitude + coding. Package 3.5-6.5 LPA.\n"
        "- Accenture: ASE and Packaged App roles. CGPA 6.5+. Heavy focus on communication + aptitude. "
        "Package 4.5-6.5 LPA.\n"
        "- Cognizant: GenC and GenC Elevate tracks. CGPA 6.0+. Tests coding + aptitude. "
        "Package 4-7 LPA.\n"
        "- HCL: Hires freshers heavily. CGPA 6.0+. Package 3.5-4.5 LPA. Good for anyone "
        "struggling elsewhere.\n"
        "- Capgemini: Tests on AMCAT platform. CGPA 6.0+. Package 4-6 LPA.\n"
        "- Zoho: No mass recruitment. Own coding test, prefers C language. No CGPA cutoff but "
        "very selective. Package 5-8 LPA.\n"
        "- Freshworks: Strong focus on problem solving + product thinking. Prefers students with "
        "real projects. Package 10-15 LPA.\n"
        "- Chargebee: Startup culture, prefers full stack. Strong GitHub presence needed. "
        "Package 10-14 LPA.\n"
        "- Razorpay: Strong DSA required, LeetCode medium-hard. CGPA 7.5+ preferred. "
        "Package 15-25 LPA.\n"
        "- CRED: Very selective, product thinking + DSA. Only top profiles. Package 20-35 LPA.\n"
        "- Swiggy: DSA + system design for SDE roles. Package 15-25 LPA.\n"
        "- Zepto: Fast growing, values hustle + skills over CGPA. Package 12-20 LPA.\n"
        "- PhonePe: Strong DSA + fintech interest. Package 15-30 LPA.\n"
        "- Groww: DSA + finance knowledge helpful. Package 12-20 LPA.\n"
        "- Flipkart: Strong DSA, system design for experienced. Hard for freshers off-campus. "
        "Package 18-40 LPA.\n"
        "- Amazon: DSA heavy + leadership principles in interviews. CGPA matters less than problem "
        "solving. Package 18-40 LPA.\n"
        "- Microsoft: Very strong DSA + CS fundamentals. CGPA 7.5+ preferred. Package 20-45 LPA.\n"
        "- Google: Extremely competitive. LeetCode hard problems. Package 25-60 LPA. Realistic only "
        "for top 1% profiles.\n"
        "- Deloitte: Consulting + tech hybrid. Communication skills matter. Package 6-9 LPA.\n"
        "- IBM: Hires via campus. Tests aptitude + coding. Package 4.5-7 LPA.\n"
        "- Mindtree (LTIMindtree): CGPA 6.0+. Package 4-6 LPA.\n"
        "- Mphasis: CGPA 6.0+. Good backup option. Package 3.5-5 LPA.\n\n"
        'Return a JSON object with exactly this structure:\n'
        '{\n'
        '  "companies": [\n'
        '    {\n'
        '      "name": "Company name",\n'
        '      "type": "Service" or "Product" or "Startup",\n'
        '      "match_score": integer 0-100,\n'
        '      "cgpa_cutoff": "e.g. 6.0" or "No cutoff",\n'
        '      "visits_college_tier": "Tier 1 only" or "Tier 1 & 2" or "All tiers",\n'
        '      "likely_to_visit": boolean,\n'
        '      "hiring_mode": "On Campus" or "Off Campus" or "Both",\n'
        '      "role_offered": "specific role name e.g. Systems Engineer, SDE-1",\n'
        '      "package_range": "e.g. 3.5-4.5 LPA",\n'
        '      "why_match": "company-specific sentence referencing that company\'s actual 2026 hiring process",\n'
        '      "biggest_gap": "company-specific sentence referencing that company\'s actual screening criteria",\n'
        '      "apply_link": "direct careers page URL"\n'
        '    }\n'
        '  ],\n'
        '  "summary": "2-3 sentences on their overall company targeting strategy"\n'
        '}\n\n'
        "Match score rules:\n"
        "- Google/Microsoft/Amazon: max 35 for Tier 2 unless LeetCode 200+ AND CGPA 8.5+ AND "
        "strong projects.\n"
        "- Razorpay/CRED/Swiggy/PhonePe: max 50 for Tier 2 average profiles.\n"
        "- Freshworks/Zoho/Chargebee: realistic 55-75 for good Tier 2 profiles.\n"
        "- TCS/Infosys/Wipro/Accenture/Cognizant: 65-85 for Tier 2 with 6.5+ CGPA.\n"
        "- If CGPA below cutoff: max score 30.\n"
        "- If 0 projects: reduce product scores by 20.\n"
        "- If LeetCode 0: reduce product scores by 15.\n\n"
        "why_match and biggest_gap must reference specific things about that company's actual hiring "
        "process in 2026, not generic statements.\n\n"
        "CRITICAL RULES for why_match and biggest_gap:\n"
        "- why_match must talk about what specifically HELPS this student at this company — their actual "
        "skills, CGPA, projects, or experience that aligns with what this company looks for.\n"
        "- biggest_gap must talk about something COMPLETELY DIFFERENT from why_match — a specific "
        "weakness, missing skill, or specific exam/round they are likely to struggle with.\n"
        "- They must NEVER repeat the same point or say the same thing in different words.\n"
        "- biggest_gap must be about a concrete specific thing they are missing or weak at, not a vague "
        "statement like 'high competition might be a challenge'.\n\n"
        "Examples of CORRECT why_match and biggest_gap:\n"
        "Infosys:\n"
        "- why_match: 'Your Python and Java skills directly apply to InfyTQ coding rounds, and your 7.2 "
        "CGPA clears their 6.5 cutoff comfortably giving you access to their campus drive'\n"
        "- biggest_gap: 'InfyTQ heavily tests logical reasoning and data interpretation in the aptitude "
        "section — you have no certifications or practice in aptitude prep which is the most common "
        "reason students fail this round'\n"
        "TCS:\n"
        "- why_match: 'Your CGPA clears TCS NQT cutoff and Python is one of the languages tested in "
        "their coding section — SRM is a regular TCS recruitment campus'\n"
        "- biggest_gap: 'TCS NQT has a dedicated numerical reasoning section that trips up most students "
        "— without specific PrepInsta NQT practice you are likely to clear coding but fail aptitude'\n\n"
        "NEVER say things like 'high competition might be a challenge' or 'limited projects might be "
        "an issue' — be specific to that exact company and that exact student profile.\n\n"
        "Only return valid JSON with no markdown formatting."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq company match response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/roadmap/generate")
async def generate_roadmap(body: RoadmapIn):
    skills_str = ", ".join(body.skills) if body.skills else "none listed"
    companies_str = ", ".join(body.target_companies) if body.target_companies else "not specified"
    missing_str = ", ".join(body.must_have_missing) if body.must_have_missing else "none identified"
    internship_str = (
        f"yes ({body.internship_months} months)" if body.has_internship == "yes" else "no"
    )

    prompt = (
        "You are a placement preparation expert who knows exactly what Indian engineering students "
        "need to do to get placed in 2026. You understand the Indian job market deeply — "
        "service companies (TCS, Infosys, Wipro), product companies (Razorpay, Zoho, Freshworks), "
        "startups, and FAANG/big tech. Your advice is brutally practical, not motivational fluff.\n\n"
        f"Student Profile:\n"
        f"- College: {body.college} ({body.college_tier})\n"
        f"- Branch: {body.branch}, CGPA: {body.cgpa}\n"
        f"- Current Skills: {skills_str}\n"
        f"- Target Role: {body.target_role}\n"
        f"- Target Companies: {companies_str}\n"
        f"- LeetCode Problems Solved: {body.leetcode_count}\n"
        f"- Projects Count: {body.projects_count}\n"
        f"- Internship: {internship_str}\n"
        f"- Critical Skill Gaps (must learn): {missing_str}\n\n"
        "Generate a 90-day personalised placement prep roadmap. Be specific to their profile — "
        "reference their actual gaps, target companies, and college tier. Don't give generic advice.\n\n"
        "Return ONLY a JSON object with this exact structure:\n"
        "{\n"
        '  "overview": "2-3 sentence summary of their situation and what this roadmap addresses",\n'
        '  "day_30": {\n'
        '    "goal": "one-line goal for this phase",\n'
        '    "tasks": [\n'
        '      {\n'
        '        "name": "task name",\n'
        '        "description": "specific actionable description referencing their profile",\n'
        '        "time_per_day": "e.g. 1.5 hrs/day",\n'
        '        "priority": "Critical" or "High" or "Medium",\n'
        '        "resource_link": "https://... (free resource URL or empty string)"\n'
        "      }\n"
        "    ]\n"
        "  },\n"
        '  "day_60": { "goal": "...", "tasks": [...] },\n'
        '  "day_90": { "goal": "...", "tasks": [...] },\n'
        '  "daily_schedule": {\n'
        '    "morning": "specific morning routine (e.g. 6-7am: 5 LeetCode problems)",\n'
        '    "evening": "specific evening routine",\n'
        '    "weekend": "weekend deep work plan"\n'
        "  },\n"
        '  "milestones": [\n'
        '    { "day": 15, "milestone": "specific measurable milestone" },\n'
        '    { "day": 30, "milestone": "..." },\n'
        '    { "day": 45, "milestone": "..." },\n'
        '    { "day": 60, "milestone": "..." },\n'
        '    { "day": 75, "milestone": "..." },\n'
        '    { "day": 90, "milestone": "..." }\n'
        "  ],\n"
        '  "warnings": [\n'
        '    "specific warning about something they must NOT do or risk missing",\n'
        "    ...\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Each phase must have 3-5 tasks. Tasks must be specific — reference the student's actual gaps and target companies.\n"
        "- Priority 'Critical' only for must_have_missing skills and LeetCode if < 50 problems.\n"
        "- resource_link must be a real, free URL (LeetCode, GeeksForGeeks, YouTube, official docs) or empty string.\n"
        "- Warnings must be real risks for this student's profile (e.g. 'At CGPA 6.8, Infosys has a 6.5 cutoff — maintain it').\n"
        "- Daily schedule must be concrete times, not vague ('study DSA' is bad, '6-7am: 2 LeetCode mediums' is good).\n"
        "- Only return valid JSON with no markdown formatting."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq roadmap response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/roadmap/chat")
async def roadmap_chat(body: RoadmapChatIn):
    roadmap_json = json.dumps(body.current_roadmap, indent=2)
    profile_json = json.dumps(body.profile, indent=2)

    system_prompt = (
        "You are a placement prep advisor for Indian engineering students. "
        "The student has been given a prep roadmap and wants to modify it or ask a question. "
        "Given their current roadmap and their request, either adjust specific parts of the roadmap "
        "and return the updated JSON, or answer their question conversationally.\n\n"
        "If they want a roadmap change (e.g. adjust time, change focus, add/remove tasks), "
        "return JSON with field 'type': 'roadmap_update' and 'updated_roadmap': the full updated roadmap object "
        "(same structure: overview, day_30, day_60, day_90, daily_schedule, milestones, warnings).\n\n"
        "If they are asking a question or want advice without changing the roadmap, "
        "return JSON with field 'type': 'message' and 'message': your response (2-4 sentences, practical).\n\n"
        f"Current roadmap:\n{roadmap_json}\n\n"
        f"Student profile:\n{profile_json}\n\n"
        "Only return valid JSON with no markdown formatting."
    )

    prompt = f"Student message: {body.user_message}"

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq roadmap chat response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/market/intelligence")
async def market_intelligence():
    cached = _load_market_cache()
    if cached:
        return cached
    try:
        payload = await refresh_market_cache()
        return payload
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/market/refresh")
async def market_force_refresh():
    if MARKET_CACHE_PATH.exists():
        MARKET_CACHE_PATH.unlink()
    try:
        payload = await refresh_market_cache()
        return payload
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── On Campus Prediction ──────────────────────────────────────────────────────

class OnCampusIn(BaseModel):
    college: str
    college_tier: str
    branch: str
    target_role: str
    skills: list[str]
    cgpa: float


@app.post("/api/oncampus/predict")
async def oncampus_predict(payload: OnCampusIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    skills_str = ", ".join(payload.skills) if payload.skills else "None listed"

    prompt = (
        "You are a placement prediction expert with deep knowledge of Indian campus recruitment in 2026. "
        "Based on this student's college profile, predict which companies are likely to visit their campus "
        "for placements in the 2026 placement season (Aug-Dec 2026).\n\n"
        f"Student Profile:\n"
        f"- College: {payload.college}\n"
        f"- College Tier: {payload.college_tier}\n"
        f"- Branch: {payload.branch}\n"
        f"- Target Role: {payload.target_role}\n"
        f"- Skills: {skills_str}\n"
        f"- CGPA: {payload.cgpa}/10\n\n"
        "Return a JSON object with this exact structure:\n"
        "{\n"
        '  "companies": [\n'
        '    {\n'
        '      "name": "Company name",\n'
        '      "probability": integer 0-100,\n'
        '      "visit_timing": "e.g. August-September 2026",\n'
        '      "role_offered": "specific role title",\n'
        '      "package_range": "e.g. 3.36-7 LPA",\n'
        '      "cgpa_cutoff": "e.g. 6.0",\n'
        '      "student_eligible": boolean,\n'
        '      "hiring_rounds": ["Round 1", "Round 2"],\n'
        '      "topics_tested": ["Topic 1", "Topic 2"],\n'
        '      "sample_questions": ["Question 1", "Question 2", "Question 3"],\n'
        '      "prep_resource": "https://...",\n'
        '      "careers_link": "https://...",\n'
        '      "why_likely": "1 sentence"\n'
        '    }\n'
        '  ],\n'
        '  "season_advice": "2-3 sentences of honest advice for this student",\n'
        '  "eligible_count": integer\n'
        '}\n\n'
        "Rules:\n"
        "- Tier 1 (IITs/NITs/BITS): Include Google, Microsoft, Amazon, Goldman Sachs, Atlassian, etc.\n"
        "- Tier 2 (VIT/SRM/Manipal/Amrita/KIIT etc): TCS, Infosys, Wipro, Accenture, Cognizant, HCL, Capgemini, Deloitte, IBM, Zoho, Freshworks.\n"
        "- Tier 3: TCS, Infosys, Wipro, HCL, Mphasis, and regional IT companies.\n"
        "- Return exactly 8-10 companies relevant to their tier.\n"
        "- probability reflects actual historical campus visit frequency for that college tier.\n"
        "- student_eligible is strictly CGPA >= cgpa_cutoff (compute accurately).\n"
        "- sample_questions must be REAL questions specific to each company's known hiring pattern.\n"
        "- eligible_count = count of companies where student_eligible is true.\n"
        "Only return valid JSON with no markdown formatting."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq oncampus response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Off Campus Jobs ───────────────────────────────────────────────────────────

class OffCampusJobsIn(BaseModel):
    target_role: str
    skills: list[str] = []
    location: str = ""
    remote_only: bool = False
    page: int = 1


@app.post("/api/offcampus/jobs")
async def offcampus_jobs(payload: OffCampusJobsIn):
    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        raise HTTPException(status_code=503, detail="Adzuna credentials not configured in .env")

    where = "remote" if payload.remote_only else (payload.location.strip() or "india")

    params: dict = {
        "app_id": app_id,
        "app_key": app_key,
        "results_per_page": 20,
        "what": payload.target_role,
        "where": where,
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.adzuna.com/v1/api/jobs/in/search/{max(1, payload.page)}",
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Adzuna API error: {e}")

    user_skills_lower = [s.lower() for s in payload.skills]
    total_skills = max(len(user_skills_lower), 1)
    jobs = []

    for job in data.get("results", []):
        desc = (job.get("description", "") + " " + job.get("title", "")).lower()
        matched = sum(1 for s in user_skills_lower if s in desc)
        match_score = min(100, int((matched / total_skills) * 100)) if user_skills_lower else 50

        salary_min = job.get("salary_min")
        salary_max = job.get("salary_max")
        salary_str = ""
        if salary_min and salary_max and salary_min > 0:
            # Adzuna India returns salaries in INR; convert to LPA
            lpa_min = round(salary_min / 100000, 1)
            lpa_max = round(salary_max / 100000, 1)
            salary_str = f"₹{lpa_min}-{lpa_max} LPA"
        elif salary_min and salary_min > 0:
            salary_str = f"₹{round(salary_min / 100000, 1)}+ LPA"

        jobs.append({
            "id": job.get("id", ""),
            "title": job.get("title", ""),
            "company": job.get("company", {}).get("display_name", "Unknown"),
            "location": job.get("location", {}).get("display_name", "India"),
            "description": (job.get("description", "") or "")[:350],
            "salary": salary_str,
            "match_score": match_score,
            "apply_link": job.get("redirect_url", ""),
            "created": job.get("created", ""),
        })

    jobs.sort(key=lambda x: x["match_score"], reverse=True)
    return {"jobs": jobs, "total": data.get("count", len(jobs)), "page": payload.page}


# ── Cold Email Generator ──────────────────────────────────────────────────────

class ColdEmailIn(BaseModel):
    company: str
    role: str
    user_name: str = ""
    college: str = ""
    skills: list[str] = []
    projects_count: str = "0"
    has_internship: str = "no"
    internship_months: str = ""


@app.post("/api/coldemail/generate")
async def generate_cold_email(payload: ColdEmailIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    skills_str = ", ".join(payload.skills[:8]) if payload.skills else "software development"
    internship_str = f"Yes ({payload.internship_months} months)" if payload.has_internship == "yes" else "No"
    name = payload.user_name or "a final-year engineering student"
    college_str = f"from {payload.college}" if payload.college else "from an engineering college in India"

    prompt = (
        f"Write a professional cold email from {name} ({college_str}) to a recruiter or "
        f"engineering hiring manager at {payload.company}, expressing interest in a {payload.role} role.\n\n"
        f"Sender's background:\n"
        f"- Skills: {skills_str}\n"
        f"- Projects completed: {payload.projects_count}\n"
        f"- Internship experience: {internship_str}\n\n"
        "Requirements for the email:\n"
        "1. Start with Subject: line\n"
        "2. Professional greeting using 'Hi [First Name],' format (use a placeholder)\n"
        f"3. Opening line that references something specific about {payload.company} — their product, recent news, or known tech stack\n"
        "4. 1-2 sentences about the sender's strongest relevant skills/experience (specific, not generic)\n"
        "5. Clear, direct ask: request for a 20-minute call or to be referred for open roles\n"
        "6. Professional sign-off with contact info placeholders\n"
        "7. Total length: 150-200 words — concise and scannable\n\n"
        "Return ONLY the plain email text — no JSON, no markdown, no code fences, no explanation before or after."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
        raw = completion.choices[0].message.content or ""
        # Strip any markdown fences if present
        raw = re.sub(r"^```(?:text|markdown|email)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        return {"email": raw.strip()}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
