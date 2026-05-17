import io
import json
import os
import re
import traceback

import pdfplumber
from groq import Groq
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import UserProfile, ProfileIn, ProfileOut, SkillsGapIn

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

app = FastAPI(title="PlaceIQ API")

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
