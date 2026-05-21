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
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import UserProfile, ProfileIn, ProfileOut, SkillsGapIn, CompanyMatchIn, RoadmapIn, RoadmapChatIn, Alumni

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

# ── College Database ──────────────────────────────────────────────────────────
COLLEGE_DB: dict[str, dict] = {
    "VIT Vellore": {
        "short_name": "VIT Vellore", "city": "Vellore", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": 11, "placement_rate": "85%",
        "avg_package": "6.8 LPA", "highest_package": "47 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Amazon", "Microsoft", "Zoho"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "Large campus drives; Amazon & Microsoft visit regularly; VIT scores highest among private colleges",
    },
    "VIT Chennai": {
        "short_name": "VIT Chennai", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "68%",
        "avg_package": "5.5 LPA", "highest_package": "28 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "HCL"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": True,
        "known_for": "Smaller campus than Vellore; fewer product company visits; mainly service companies",
    },
    "VIT Bhopal": {
        "short_name": "VIT Bhopal", "city": "Bhopal", "state": "Madhya Pradesh",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "62%",
        "avg_package": "5.0 LPA", "highest_package": "22 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Capgemini", "Hexaware"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": True,
        "known_for": "Newer campus; growing placement cell; predominantly service company offers",
    },
    "VIT AP": {
        "short_name": "VIT AP", "city": "Amaravati", "state": "Andhra Pradesh",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "60%",
        "avg_package": "4.8 LPA", "highest_package": "20 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Mphasis"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": True,
        "known_for": "Newest VIT campus; building placement network; limited product company presence",
    },
    "SRM KTR": {
        "short_name": "SRM KTR", "city": "Kattankulathur", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": 27, "placement_rate": "72%",
        "avg_package": "6.0 LPA", "highest_package": "42 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Samsung", "Zoho", "Amazon"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "Main campus; Samsung R&D visits; Zoho regularly recruits; strong core engineering placements",
    },
    "SRM Ramapuram": {
        "short_name": "SRM Ramapuram", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "58%",
        "avg_package": "4.5 LPA", "highest_package": "18 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "HCL"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "Smaller SRM campus; primarily service company placements; fewer product company drives",
    },
    "SRM Vadapalani": {
        "short_name": "SRM Vadapalani", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "52%",
        "avg_package": "4.0 LPA", "highest_package": "14 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Capgemini", "Accenture"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.5",
        "tpo_strict": False,
        "known_for": "Arts & Science focus; engineering placements limited; off-campus routes more common",
    },
    "SRM Delhi-NCR": {
        "short_name": "SRM Delhi-NCR", "city": "Modinagar", "state": "Uttar Pradesh",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "55%",
        "avg_package": "4.2 LPA", "highest_package": "16 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "HCL"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.5",
        "tpo_strict": False,
        "known_for": "North India SRM campus; limited company visits; students compete for off-campus opportunities",
    },
    "SRM Sonepat": {
        "short_name": "SRM Sonepat", "city": "Sonepat", "state": "Haryana",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "50%",
        "avg_package": "3.8 LPA", "highest_package": "14 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Capgemini", "Tech Mahindra"],
        "placement_season": "October–February", "cgpa_cutoff_most_companies": "6.5",
        "tpo_strict": False,
        "known_for": "Newest SRM campus; placement infrastructure still maturing; strong off-campus prep recommended",
    },
    "SSN College of Engineering": {
        "short_name": "SSN College", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": 74, "placement_rate": "82%",
        "avg_package": "6.5 LPA", "highest_package": "38 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Zoho", "Amazon", "Cognizant", "Hexaware"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "N. Sivakumar Trust college; known for strong Zoho recruitment; consistently high placement rates in Chennai",
    },
    "SNU Chennai": {
        "short_name": "SNU Chennai", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "76%",
        "avg_package": "7.5 LPA", "highest_package": "35 LPA",
        "top_recruiters": ["Samsung", "Amazon", "TCS", "Infosys", "Wipro", "Capgemini"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "Shiv Nadar University campus; research-oriented; Samsung is a key recruiter; higher avg package than most private colleges",
    },
    "Amrita Coimbatore": {
        "short_name": "Amrita CBE", "city": "Coimbatore", "state": "Tamil Nadu",
        "tier": "Tier 1", "nirf_rank": 7, "placement_rate": "83%",
        "avg_package": "7.0 LPA", "highest_package": "44 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Amazon", "Zoho", "Cisco"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "NIRF rank 7 — highest-ranked private college in South India; research output is strong; Cisco and Amazon visit regularly",
    },
    "Amrita Chennai": {
        "short_name": "Amrita Chennai", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "72%",
        "avg_package": "6.0 LPA", "highest_package": "28 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "HCL"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "Smaller Amrita campus; fewer company visits than Coimbatore; students often transfer to Coimbatore campus for placements",
    },
    "Amrita Bengaluru": {
        "short_name": "Amrita Bengaluru", "city": "Bengaluru", "state": "Karnataka",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "70%",
        "avg_package": "6.0 LPA", "highest_package": "30 LPA",
        "top_recruiters": ["Infosys", "Wipro", "TCS", "Accenture", "Cognizant", "Bosch"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "Bangalore location gives proximity to IT companies; Bosch and Accenture visit; R&D opportunities from Bangalore ecosystem",
    },
    "PESU": {
        "short_name": "PES University", "city": "Bengaluru", "state": "Karnataka",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "83%",
        "avg_package": "8.0 LPA", "highest_package": "52 LPA",
        "top_recruiters": ["Amazon", "Microsoft", "Samsung", "Oracle", "Wipro", "Infosys", "Accenture"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "8.0",
        "tpo_strict": True,
        "known_for": "Ring Road campus; top private college in Karnataka; Amazon and Microsoft visit; highest avg package among Karnataka private colleges",
    },
    "PESU Electronic City": {
        "short_name": "PESU EC", "city": "Bengaluru", "state": "Karnataka",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "72%",
        "avg_package": "6.5 LPA", "highest_package": "35 LPA",
        "top_recruiters": ["Wipro", "Infosys", "TCS", "Accenture", "Capgemini", "Samsung"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "PES Electronic City campus; good placement but lower than Ring Road campus; proximity to Electronic City tech park helps",
    },
    "RV College of Engineering": {
        "short_name": "RVCE", "city": "Bengaluru", "state": "Karnataka",
        "tier": "Tier 2", "nirf_rank": 46, "placement_rate": "87%",
        "avg_package": "7.8 LPA", "highest_package": "48 LPA",
        "top_recruiters": ["Amazon", "Infosys", "Wipro", "Cisco", "Samsung", "Bosch", "TCS"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "Top autonomous college in Karnataka; Cisco, Samsung, Bosch visit consistently; very high placement rate; strong alumni network",
    },
    "BMS College of Engineering": {
        "short_name": "BMSCE", "city": "Bengaluru", "state": "Karnataka",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "82%",
        "avg_package": "7.0 LPA", "highest_package": "42 LPA",
        "top_recruiters": ["Infosys", "Wipro", "Amazon", "Samsung", "Bosch", "TCS", "Accenture"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": True,
        "known_for": "BMS Trust college; strong core and IT placements; good industry connections in Bengaluru; Bosch recruits heavily",
    },
    "MSRIT": {
        "short_name": "MSRIT", "city": "Bengaluru", "state": "Karnataka",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "78%",
        "avg_package": "6.5 LPA", "highest_package": "36 LPA",
        "top_recruiters": ["Infosys", "Wipro", "TCS", "Amazon", "Accenture", "Capgemini"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "MS Ramaiah; autonomous college; less strict TPO; strong IT placements; students with good LeetCode skills get product company offers",
    },
    "PSG College of Technology": {
        "short_name": "PSG Tech", "city": "Coimbatore", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": 28, "placement_rate": "82%",
        "avg_package": "6.5 LPA", "highest_package": "38 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Zoho", "Cognizant", "L&T Technology"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.5",
        "tpo_strict": True,
        "known_for": "PSG Sons & Charities; Zoho is a marquee recruiter; one of the best autonomous colleges in Tamil Nadu",
    },
    "Coimbatore Institute of Technology": {
        "short_name": "CIT Coimbatore", "city": "Coimbatore", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "73%",
        "avg_package": "5.5 LPA", "highest_package": "24 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "HCL"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "Government-aided; strong placement consistency; many alumni in TCS and Infosys; steady but not spectacular packages",
    },
    "Kongu Engineering College": {
        "short_name": "KEC Erode", "city": "Erode", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "71%",
        "avg_package": "5.0 LPA", "highest_package": "22 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Capgemini"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "Kongu Nadu Educational Trust; solid engineering programs; consistent TCS and Infosys recruitment; rural location means lower cost of living",
    },
    "Sri Krishna College of Engineering": {
        "short_name": "SKCET", "city": "Coimbatore", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "67%",
        "avg_package": "4.5 LPA", "highest_package": "18 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Tech Mahindra"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.5",
        "tpo_strict": False,
        "known_for": "Good mid-tier college in Coimbatore; strong electronics and mechanical placements; IT students compete well off-campus",
    },
    "KCG College of Technology": {
        "short_name": "KCG Chennai", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "60%",
        "avg_package": "4.0 LPA", "highest_package": "14 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Accenture"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.0",
        "tpo_strict": False,
        "known_for": "Arts & Science background; engineering wing decent for service company placements; students advised to build strong off-campus profile",
    },
    "Rajalakshmi Engineering College": {
        "short_name": "REC Chennai", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "65%",
        "avg_package": "4.5 LPA", "highest_package": "18 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "HCL"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.5",
        "tpo_strict": False,
        "known_for": "Established Chennai private college; consistent service company placement; students with projects get better off-campus opportunities",
    },
    "Saveetha Engineering College": {
        "short_name": "Saveetha Engg", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "58%",
        "avg_package": "3.8 LPA", "highest_package": "14 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Capgemini"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.0",
        "tpo_strict": False,
        "known_for": "Part of Saveetha group; placements are average; off-campus and AMCAT/Pool Campus routes more effective for students here",
    },
    "Panimalar Engineering College": {
        "short_name": "Panimalar", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "60%",
        "avg_package": "4.0 LPA", "highest_package": "14 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Mphasis"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.0",
        "tpo_strict": False,
        "known_for": "Good student strength; placements driven by TCS and Infosys pool campus; students must actively prepare off-campus",
    },
    "Velammal Engineering College": {
        "short_name": "Velammal Engg", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "65%",
        "avg_package": "4.5 LPA", "highest_package": "20 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Capgemini"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.5",
        "tpo_strict": False,
        "known_for": "Velammal group; good sports and technical fest culture; IT placements steady; mechanical and ECE placements increasing",
    },
    "CEG Anna University": {
        "short_name": "CEG Guindy", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 1", "nirf_rank": 35, "placement_rate": "84%",
        "avg_package": "7.5 LPA", "highest_package": "45 LPA",
        "top_recruiters": ["Zoho", "Amazon", "Cognizant", "TCS", "Infosys", "L&T", "Samsung"],
        "placement_season": "August–March", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "Oldest engineering college in Tamil Nadu (1794); government university; Zoho is top recruiter; no CGPA pressure as companies trust CEG brand",
    },
    "MIT Campus Anna University": {
        "short_name": "MIT Anna Univ", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "72%",
        "avg_package": "6.0 LPA", "highest_package": "28 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Capgemini"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "Madras Institute of Technology campus under Anna University; good academic reputation; autonomous status; auto and aero engineering well-placed",
    },
    "Hindustan Institute of Technology": {
        "short_name": "HITS Chennai", "city": "Chennai", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "63%",
        "avg_package": "4.5 LPA", "highest_package": "18 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "HCL", "Cognizant"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.5",
        "tpo_strict": False,
        "known_for": "Hindustan Group; decent placement for service companies; aviation and aerospace programs are a differentiator; IT placements average",
    },
    "Bannari Amman Institute of Technology": {
        "short_name": "BIT Erode", "city": "Sathyamangalam", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "72%",
        "avg_package": "5.0 LPA", "highest_package": "20 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Capgemini"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": True,
        "known_for": "BIT-Bannari; strong placement consistency for a semi-rural location; CGPA strictly enforced; mechanical and EEE placements solid",
    },
    "Sri Venkateswara College of Engineering": {
        "short_name": "SVCE Sriperumbudur", "city": "Sriperumbudur", "state": "Tamil Nadu",
        "tier": "Tier 2", "nirf_rank": None, "placement_rate": "70%",
        "avg_package": "5.0 LPA", "highest_package": "22 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "HCL"],
        "placement_season": "August–February", "cgpa_cutoff_most_companies": "7.0",
        "tpo_strict": False,
        "known_for": "Near Chennai's manufacturing corridor (SIPCOT); proximity to Hyundai and Saint-Gobain plants aids core placements; IT placement decent",
    },
    "Karpagam College of Engineering": {
        "short_name": "KCE Coimbatore", "city": "Coimbatore", "state": "Tamil Nadu",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "58%",
        "avg_package": "3.8 LPA", "highest_package": "14 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Tech Mahindra"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.0",
        "tpo_strict": False,
        "known_for": "Karpagam Academy group; mid-tier Coimbatore college; placements through pool campus; LeetCode and certifications are a must for off-campus",
    },
    "SNS College of Technology": {
        "short_name": "SNS Tech", "city": "Coimbatore", "state": "Tamil Nadu",
        "tier": "Tier 3", "nirf_rank": None, "placement_rate": "58%",
        "avg_package": "3.8 LPA", "highest_package": "14 LPA",
        "top_recruiters": ["TCS", "Infosys", "Wipro", "Cognizant", "Accenture"],
        "placement_season": "September–February", "cgpa_cutoff_most_companies": "6.0",
        "tpo_strict": False,
        "known_for": "SNS Institutions; decent student activities; service company placements; students encouraged to pursue off-campus for better packages",
    },
}

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

    college_info = COLLEGE_DB.get(payload.college, {})
    college_context = ""
    if college_info:
        recruiters_str = ", ".join(college_info.get("top_recruiters", []))
        college_context = (
            f"\nVERIFIED DATA for {payload.college}:\n"
            f"- Actual placement rate: {college_info['placement_rate']}\n"
            f"- Average package: {college_info['avg_package']}\n"
            f"- Highest package recorded: {college_info['highest_package']}\n"
            f"- CGPA cutoff at this college (most companies): {college_info['cgpa_cutoff_most_companies']}\n"
            f"- TPO strictly enforces CGPA cutoff: {'Yes' if college_info['tpo_strict'] else 'No'}\n"
            f"- Top companies that visit this campus: {recruiters_str}\n"
            f"- Known for: {college_info['known_for']}\n"
        )

    prompt = (
        "You are a brutally honest placement prediction expert for Indian engineering students. "
        "You have deep knowledge of actual placement realities at Indian colleges.\n\n"
        "STRICT RULES you must follow:\n"
        "- Use the VERIFIED DATA section below as ground truth for this specific college. "
        "If the student's CGPA is below the cutoff listed, their score must reflect that they will be filtered by TPO before interviews.\n"
        "- Most companies visiting Tier 2 colleges have a CGPA cutoff of 7.0–8.0. "
        "A student below the cutoff at a Tier 2 college should score 15–30% max on-campus.\n"
        "- At Tier 1 colleges (IITs, NITs, BITS, Amrita Coimbatore, CEG), CGPA matters less because the brand carries weight, "
        "but below 6.5 is still a red flag.\n"
        "- At Tier 3 colleges, on-campus placement is rare. Even strong students should not score above 60% "
        "unless they have exceptional off-campus skills.\n"
        "- Skills without projects add very little value. 10 skills + 0 projects should not score high.\n"
        "- 1st or 2nd year students should score lower — placements are 2+ years away.\n"
        "- Internship experience is a strong positive signal.\n"
        "- LeetCode 200+ problems is a strong positive signal for SWE roles.\n\n"
        "Given this student profile, return a JSON object with exactly three fields:\n"
        "- score (integer 0-100): brutally realistic placement probability at THEIR specific college\n"
        "- reasoning (3-4 sentences specific about what is hurting and helping their score, "
        "citing actual college name, CGPA cutoffs, and which companies they can/cannot reach)\n"
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
        f"{college_context}"
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

        # Hiring status based on posting age
        days_ago_val: int | None = None
        hiring_status_val: str | None = None
        created_raw = job.get("created", "")
        if created_raw:
            try:
                created_dt = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                days_ago_val = (datetime.now(timezone.utc) - created_dt).days
                if days_ago_val <= 7:
                    hiring_status_val = "Actively Hiring"
                elif days_ago_val <= 30:
                    hiring_status_val = "Recently Posted"
                else:
                    hiring_status_val = "May Be Closed"
            except Exception:
                pass

        jobs.append({
            "id": job.get("id", ""),
            "title": job.get("title", ""),
            "company": job.get("company", {}).get("display_name", "Unknown"),
            "location": job.get("location", {}).get("display_name", "India"),
            "description": (job.get("description", "") or "")[:350],
            "salary": salary_str,
            "match_score": match_score,
            "apply_link": job.get("redirect_url", ""),
            "created": created_raw,
            "days_ago": days_ago_val,
            "hiring_status": hiring_status_val,
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


# ── Career Link Verification ──────────────────────────────────────────────────

import asyncio as _asyncio

CAREERS_CACHE_PATH = Path(__file__).parent / "careers_cache.json"
ONCAMPUS_DATA_CACHE_PATH = Path(__file__).parent / "oncampus_cache.json"
COMPANY_DIR_PATH = Path(__file__).parent / "company_directory.json"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _load_json(path: Path) -> dict:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_json(path: Path, data):
    try:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"[Cache] Write failed {path}: {e}")


@app.get("/api/resources/careers")
async def verify_career_link(company: str):
    key = company.lower().strip()
    cache = _load_json(CAREERS_CACHE_PATH)

    if key in cache:
        entry = cache[key]
        try:
            ts = datetime.fromisoformat(entry["verified_at"])
            if datetime.now(timezone.utc) - ts < timedelta(days=30):
                return {"url": entry["url"], "from_cache": True}
        except Exception:
            pass

    slug = re.sub(r"[^a-z0-9]", "", key.replace(" ", ""))
    patterns = [
        f"https://careers.{slug}.com",
        f"https://www.{slug}.com/careers",
        f"https://www.{slug}.com/jobs",
        f"https://{slug}.com/careers",
    ]

    found_url: str | None = None
    hdrs = {"User-Agent": _UA, "Accept": "text/html"}
    async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
        for url in patterns:
            try:
                resp = await client.get(url, headers=hdrs)
                if resp.status_code == 200:
                    found_url = url
                    break
            except Exception:
                continue

    cache[key] = {"url": found_url, "verified_at": datetime.now(timezone.utc).isoformat()}
    _save_json(CAREERS_CACHE_PATH, cache)
    return {"url": found_url, "from_cache": False}


# ── OnCampus: Interview Intel ─────────────────────────────────────────────────

def _ab_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")


def _scrape_ab_interview(company: str) -> dict | None:
    """Sync AmbitionBox scraper — runs via asyncio.to_thread."""
    try:
        import requests as _req
        from bs4 import BeautifulSoup

        slug = _ab_slug(company)
        hdrs = {
            "User-Agent": _UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.5",
        }
        resp = _req.get(
            f"https://www.ambitionbox.com/interviews/{slug}-interview-questions",
            headers=hdrs, timeout=8,
        )
        if resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, "html.parser")
        body = soup.get_text(" ", strip=True).lower()

        difficulty = "Moderate"
        for kw, label in [("difficult", "Hard"), ("hard", "Hard"), ("easy", "Easy")]:
            if kw in body[:2000]:
                difficulty = label
                break

        salary = None
        m = re.search(r"(?:rs\.?)\s*(\d+(?:\.\d+)?)\s*(?:l(?:pa)?|lakh)", body[:3000], re.I)
        if m:
            salary = f"Rs.{m.group(1)} LPA"

        topics: list[str] = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            t = a.get_text(strip=True)
            if "interview" in href.lower() and t and 3 < len(t) < 45 and slug not in href.lower():
                topics.append(t)
        topics = list(dict.fromkeys(topics))[:6]

        return {"difficulty": difficulty, "avg_salary": salary or "N/A", "topics": topics, "source": "ambitionbox"}
    except Exception as e:
        print(f"[AmbitionBox] Scrape failed for '{company}': {e}")
        return None


class OnCampusDataIn(BaseModel):
    company: str


@app.post("/api/oncampus/data")
async def oncampus_data(payload: OnCampusDataIn):
    key = payload.company.lower().strip()
    cache = _load_json(ONCAMPUS_DATA_CACHE_PATH)

    if key in cache:
        entry = cache[key]
        try:
            ts = datetime.fromisoformat(entry["cached_at"])
            if datetime.now(timezone.utc) - ts < timedelta(days=7):
                return entry["data"]
        except Exception:
            pass

    result = await _asyncio.to_thread(_scrape_ab_interview, payload.company)

    if not result and _groq:
        try:
            raw = _groq.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": (
                    f"For '{payload.company}' recruiting freshers in India, give interview intelligence.\n"
                    'Return ONLY JSON: {"difficulty":"Easy|Moderate|Hard","avg_salary":"e.g. 8-12 LPA",'
                    '"topics":["topic1","topic2","topic3","topic4","topic5"]}\n'
                    "topics = actual tech topics this company tests in fresher interviews."
                )}],
                temperature=0.3,
            ).choices[0].message.content or ""
            result = parse_groq_json(raw)
            result["source"] = "ai"
        except Exception as e:
            print(f"[OnCampus] Groq fallback failed: {e}")

    if not result:
        result = {"difficulty": "Moderate", "avg_salary": "N/A", "topics": [], "source": "ai"}

    cache[key] = {"data": result, "cached_at": datetime.now(timezone.utc).isoformat()}
    _save_json(ONCAMPUS_DATA_CACHE_PATH, cache)
    return result


# ── Company Directory ─────────────────────────────────────────────────────────

_SEED_COMPANIES = [
    {"name": "TCS", "industry": "IT Services", "size": "500,000+", "headquarters": "Mumbai", "rating": 3.8, "description": "India's largest IT services company serving 150+ countries with 600,000+ employees.", "linkedin": "tata-consultancy-services"},
    {"name": "Infosys", "industry": "IT Services", "size": "300,000+", "headquarters": "Bangalore", "rating": 3.7, "description": "Global leader in next-generation digital services and consulting for clients in 50+ countries.", "linkedin": "infosys"},
    {"name": "Wipro", "industry": "IT Services", "size": "250,000+", "headquarters": "Bangalore", "rating": 3.6, "description": "Global information technology, consulting and business process services company.", "linkedin": "wipro"},
    {"name": "HCL Technologies", "industry": "IT Services", "size": "220,000+", "headquarters": "Noida", "rating": 3.7, "description": "Next-generation global technology company helping enterprises reimagine their businesses.", "linkedin": "hcl-technologies"},
    {"name": "Tech Mahindra", "industry": "IT Services", "size": "150,000+", "headquarters": "Pune", "rating": 3.5, "description": "Digital transformation, consulting and business re-engineering services company.", "linkedin": "tech-mahindra"},
    {"name": "LTIMindtree", "industry": "IT Services", "size": "80,000+", "headquarters": "Mumbai", "rating": 3.7, "description": "Global technology consulting and digital solutions company.", "linkedin": "ltimindtree"},
    {"name": "Mphasis", "industry": "IT Services", "size": "35,000+", "headquarters": "Bangalore", "rating": 3.6, "description": "Applied technology services company specializing in cloud and cognitive services.", "linkedin": "mphasis"},
    {"name": "Persistent Systems", "industry": "IT Services", "size": "23,000+", "headquarters": "Pune", "rating": 3.8, "description": "Digital transformation and enterprise modernization services company.", "linkedin": "persistent-systems"},
    {"name": "Coforge", "industry": "IT Services", "size": "25,000+", "headquarters": "Noida", "rating": 3.6, "description": "Digital services company focused on insurance, banking and travel verticals.", "linkedin": "coforge"},
    {"name": "Hexaware", "industry": "IT Services", "size": "32,000+", "headquarters": "Mumbai", "rating": 3.7, "description": "Automation-led digital transformation services and solutions company.", "linkedin": "hexaware-technologies"},
    {"name": "Accenture", "industry": "IT Consulting", "size": "300,000+", "headquarters": "Bangalore", "rating": 3.9, "description": "Global professional services company with capabilities in digital, cloud and security.", "linkedin": "accenture"},
    {"name": "Cognizant", "industry": "IT Services", "size": "340,000+", "headquarters": "Chennai", "rating": 3.6, "description": "Leading provider of information technology, consulting and business process services.", "linkedin": "cognizant"},
    {"name": "Capgemini", "industry": "IT Consulting", "size": "100,000+", "headquarters": "Mumbai", "rating": 3.7, "description": "Global leader in consulting, technology services and digital transformation.", "linkedin": "capgemini"},
    {"name": "IBM India", "industry": "IT Services", "size": "100,000+", "headquarters": "Bangalore", "rating": 3.9, "description": "Leading provider of hybrid cloud, AI and consulting expertise.", "linkedin": "ibm"},
    {"name": "Deloitte", "industry": "IT Consulting", "size": "100,000+", "headquarters": "Mumbai", "rating": 3.9, "description": "Global professional services firm providing audit, consulting and advisory services.", "linkedin": "deloitte"},
    {"name": "Zoho", "industry": "SaaS/Product", "size": "15,000+", "headquarters": "Chennai", "rating": 4.0, "description": "Technology company making 55+ business software applications used by 100M+ users.", "linkedin": "zoho"},
    {"name": "Freshworks", "industry": "SaaS/Product", "size": "5,500+", "headquarters": "Chennai", "rating": 4.2, "description": "Customer and employee experience software company serving 60,000+ businesses globally.", "linkedin": "freshworks"},
    {"name": "Chargebee", "industry": "SaaS/Product", "size": "1,200+", "headquarters": "Chennai", "rating": 4.2, "description": "Revenue management platform powering subscription businesses worldwide.", "linkedin": "chargebee"},
    {"name": "BrowserStack", "industry": "SaaS/Product", "size": "1,200+", "headquarters": "Mumbai", "rating": 4.3, "description": "Testing platform providing access to 3,000+ real devices and browsers.", "linkedin": "browserstack"},
    {"name": "Razorpay", "industry": "FinTech", "size": "3,500+", "headquarters": "Bangalore", "rating": 4.3, "description": "Full-stack financial services company providing payment solutions and banking infrastructure.", "linkedin": "razorpay"},
    {"name": "CRED", "industry": "FinTech", "size": "2,000+", "headquarters": "Bangalore", "rating": 4.1, "description": "Members-only credit card bill payments platform rewarding users for timely payments.", "linkedin": "cred-club"},
    {"name": "PhonePe", "industry": "FinTech", "size": "5,000+", "headquarters": "Bangalore", "rating": 4.0, "description": "India's leading digital payments platform with 500M+ registered users.", "linkedin": "phonepe"},
    {"name": "Groww", "industry": "FinTech", "size": "2,000+", "headquarters": "Bangalore", "rating": 4.0, "description": "India's largest discount broker for stocks, mutual funds and IPOs.", "linkedin": "groww"},
    {"name": "Paytm", "industry": "FinTech", "size": "12,000+", "headquarters": "Noida", "rating": 3.5, "description": "Digital payments and financial services company with 300M+ registered users.", "linkedin": "one97-communications"},
    {"name": "Swiggy", "industry": "Food Tech", "size": "6,000+", "headquarters": "Bangalore", "rating": 3.8, "description": "India's leading on-demand delivery platform for food, groceries and essentials.", "linkedin": "swiggy"},
    {"name": "Zomato", "industry": "Food Tech", "size": "6,000+", "headquarters": "Gurugram", "rating": 3.7, "description": "Food services company providing restaurant discovery, online ordering and delivery.", "linkedin": "zomato"},
    {"name": "Flipkart", "industry": "E-Commerce", "size": "30,000+", "headquarters": "Bangalore", "rating": 3.8, "description": "India's largest e-commerce marketplace, owned by Walmart since 2018.", "linkedin": "flipkart"},
    {"name": "Meesho", "industry": "E-Commerce", "size": "3,500+", "headquarters": "Bangalore", "rating": 4.0, "description": "Social commerce platform enabling millions of small businesses to sell online.", "linkedin": "meesho"},
    {"name": "Zepto", "industry": "E-Commerce", "size": "3,000+", "headquarters": "Mumbai", "rating": 3.9, "description": "Quick commerce company delivering groceries in 10 minutes across Indian cities.", "linkedin": "zepto"},
    {"name": "Ola", "industry": "Mobility", "size": "5,000+", "headquarters": "Bangalore", "rating": 3.5, "description": "India's largest ride-hailing platform expanding into EVs and financial services.", "linkedin": "ola-cabs"},
    {"name": "Microsoft India", "industry": "Software/Cloud", "size": "10,000+", "headquarters": "Hyderabad", "rating": 4.5, "description": "Global technology company enabling digital transformation with cloud, AI and software.", "linkedin": "microsoft"},
    {"name": "Amazon India", "industry": "E-Commerce/Cloud", "size": "100,000+", "headquarters": "Hyderabad", "rating": 4.0, "description": "Global e-commerce and cloud computing company with major development centers in India.", "linkedin": "amazon"},
    {"name": "Google India", "industry": "Technology", "size": "10,000+", "headquarters": "Hyderabad", "rating": 4.6, "description": "Global technology company with major R&D centers in Hyderabad and Bangalore.", "linkedin": "google"},
    {"name": "Oracle India", "industry": "Software/Cloud", "size": "25,000+", "headquarters": "Bangalore", "rating": 4.0, "description": "Global technology company offering database, cloud and enterprise software solutions.", "linkedin": "oracle"},
    {"name": "Adobe India", "industry": "Software", "size": "6,000+", "headquarters": "Noida", "rating": 4.4, "description": "Global software company creating digital media and marketing cloud solutions.", "linkedin": "adobe"},
    {"name": "Salesforce India", "industry": "SaaS/CRM", "size": "12,000+", "headquarters": "Hyderabad", "rating": 4.3, "description": "Global leader in CRM software and cloud-based enterprise business applications.", "linkedin": "salesforce"},
    {"name": "SAP India", "industry": "Enterprise Software", "size": "15,000+", "headquarters": "Bangalore", "rating": 4.1, "description": "Global enterprise software company providing ERP and business management solutions.", "linkedin": "sap"},
    {"name": "Walmart Global Tech India", "industry": "Retail/Tech", "size": "12,000+", "headquarters": "Bangalore", "rating": 4.2, "description": "Technology division of Walmart building digital solutions for global retail operations.", "linkedin": "walmart-global-tech"},
    {"name": "JPMorgan Chase India", "industry": "Banking/Tech", "size": "55,000+", "headquarters": "Bangalore", "rating": 4.1, "description": "Global financial services firm with one of India's largest technology operations centers.", "linkedin": "jpmorgan-chase"},
    {"name": "Goldman Sachs India", "industry": "Banking/Tech", "size": "15,000+", "headquarters": "Bangalore", "rating": 4.3, "description": "Global investment banking company with major tech operations in India.", "linkedin": "goldman-sachs"},
    {"name": "Nagarro", "industry": "IT Services", "size": "20,000+", "headquarters": "Gurugram", "rating": 4.0, "description": "Global software product engineering company focused on digital-first transformation.", "linkedin": "nagarro"},
    {"name": "Tata Elxsi", "industry": "Product Engineering", "size": "12,000+", "headquarters": "Bangalore", "rating": 3.9, "description": "Design and technology services company specializing in EVs, medical devices and broadcasting.", "linkedin": "tata-elxsi"},
    {"name": "Harman India", "industry": "Electronics/Software", "size": "10,000+", "headquarters": "Bangalore", "rating": 3.9, "description": "Audio and connected car technology company with large software engineering teams.", "linkedin": "harman-international"},
    {"name": "Nykaa", "industry": "E-Commerce", "size": "3,000+", "headquarters": "Mumbai", "rating": 3.8, "description": "Beauty and lifestyle retail company with omni-channel presence across India.", "linkedin": "nykaa"},
    {"name": "Urban Company", "industry": "Home Services/Tech", "size": "3,000+", "headquarters": "Gurugram", "rating": 4.0, "description": "Technology platform connecting consumers with trusted home service professionals.", "linkedin": "urban-company"},
    {"name": "InMobi", "industry": "AdTech", "size": "3,000+", "headquarters": "Bangalore", "rating": 4.0, "description": "Global marketing cloud and advertising technology platform for mobile audiences.", "linkedin": "inmobi"},
    {"name": "Druva", "industry": "SaaS/Cloud", "size": "1,500+", "headquarters": "Pune", "rating": 4.2, "description": "Cloud data protection and management platform trusted by 4,000+ companies globally.", "linkedin": "druva-inc"},
    {"name": "Byju's", "industry": "EdTech", "size": "15,000+", "headquarters": "Bangalore", "rating": 3.2, "description": "India's largest edtech company offering online learning for K-12 and competitive exams.", "linkedin": "byjus"},
    {"name": "PwC India", "industry": "IT Consulting", "size": "50,000+", "headquarters": "Mumbai", "rating": 3.9, "description": "Professional services network providing assurance, advisory and tax services.", "linkedin": "pricewaterhousecoopers"},
    {"name": "KPMG India", "industry": "IT Consulting", "size": "30,000+", "headquarters": "Gurugram", "rating": 3.8, "description": "Global network of professional firms providing audit, tax and advisory services.", "linkedin": "kpmg-india"},
]


def _scrape_ab_companies_page(page_num: int) -> list[dict]:
    try:
        import requests as _req
        from bs4 import BeautifulSoup
        import urllib.parse

        params = urllib.parse.urlencode({"industry": "IT Services & Consulting", "page": page_num})
        url = f"https://www.ambitionbox.com/list-of-companies?{params}"
        hdrs = {"User-Agent": _UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.5"}
        resp = _req.get(url, headers=hdrs, timeout=10)
        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        companies = []

        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if isinstance(item, dict) and item.get("@type") == "Organization":
                        name = item.get("name", "").strip()
                        if name and 1 < len(name) < 60:
                            companies.append({
                                "name": name,
                                "rating": item.get("aggregateRating", {}).get("ratingValue"),
                                "description": (item.get("description", "") or "")[:200],
                            })
            except Exception:
                pass

        if not companies:
            for el in soup.find_all(["h2", "h3", "h4"]):
                name = el.get_text(strip=True)
                if name and 2 < len(name) < 60 and not any(c in name for c in ["?", "Top", "List", "Review", "Copyright"]):
                    companies.append({"name": name, "rating": None, "description": ""})

        return companies[:30]
    except Exception as e:
        print(f"[AmbitionBox] List page {page_num} failed: {e}")
        return []


async def _verify_career_url_fast(client: httpx.AsyncClient, name: str) -> str | None:
    slug = re.sub(r"[^a-z0-9]", "", name.lower().replace(" ", ""))
    for url in [f"https://careers.{slug}.com", f"https://www.{slug}.com/careers"]:
        try:
            resp = await client.get(url, headers={"User-Agent": _UA}, timeout=4)
            if resp.status_code == 200:
                return url
        except Exception:
            pass
    return None


async def _build_company_directory() -> list[dict]:
    print("[Directory] Building company directory cache...")
    by_name: dict[str, dict] = {co["name"].lower(): dict(co) for co in _SEED_COMPANIES}

    try:
        app_id = os.getenv("ADZUNA_APP_ID", "")
        app_key = os.getenv("ADZUNA_APP_KEY", "")
        if app_id and app_key:
            async with httpx.AsyncClient(timeout=12) as client:
                for role in ADZUNA_ROLES[:5]:
                    try:
                        resp = await client.get(
                            "https://api.adzuna.com/v1/api/jobs/in/search/1",
                            params={"app_id": app_id, "app_key": app_key, "results_per_page": 50, "what": role},
                        )
                        resp.raise_for_status()
                        for job in resp.json().get("results", []):
                            cname = (job.get("company", {}).get("display_name") or "").strip()
                            if cname and 2 < len(cname) < 60 and cname.lower() not in by_name:
                                by_name[cname.lower()] = {
                                    "name": cname, "industry": "IT Services", "size": "N/A",
                                    "headquarters": "India", "rating": None, "description": "",
                                    "linkedin": re.sub(r"[^a-z0-9]", "-", cname.lower()).strip("-"),
                                    "source": "adzuna",
                                }
                    except Exception:
                        pass
    except Exception as e:
        print(f"[Directory] Adzuna fetch failed: {e}")

    try:
        for pg in range(1, 6):
            results = await _asyncio.to_thread(_scrape_ab_companies_page, pg)
            for co in results:
                n = co["name"]
                if n and n.lower() not in by_name:
                    by_name[n.lower()] = {
                        "name": n, "industry": "IT Services", "size": "N/A",
                        "headquarters": "India", "rating": co.get("rating"),
                        "description": co.get("description", ""),
                        "linkedin": re.sub(r"[^a-z0-9]", "-", n.lower()).strip("-"),
                        "source": "ambitionbox",
                    }
            if not results:
                break
    except Exception as e:
        print(f"[Directory] AmbitionBox failed: {e}")

    companies = list(by_name.values())
    careers_cache = _load_json(CAREERS_CACHE_PATH)
    seeds = [co for co in companies if "source" not in co][:50]

    async with httpx.AsyncClient(follow_redirects=True) as client:
        urls = await _asyncio.gather(*[_verify_career_url_fast(client, co["name"]) for co in seeds], return_exceptions=True)

    for co, url in zip(seeds, urls):
        found = url if isinstance(url, str) else None
        co["careers_url"] = found
        co["careers_verified"] = bool(found)
        careers_cache[co["name"].lower()] = {"url": found, "verified_at": datetime.now(timezone.utc).isoformat()}

    for co in companies:
        if "careers_url" not in co:
            cached = careers_cache.get(co["name"].lower()) or {}
            co["careers_url"] = cached.get("url")
            co["careers_verified"] = bool(cached.get("url"))

    _save_json(CAREERS_CACHE_PATH, careers_cache)
    result = {"companies": companies, "total_count": len(companies), "last_updated": datetime.now(timezone.utc).isoformat()}
    _save_json(COMPANY_DIR_PATH, result)
    print(f"[Directory] Done - {len(companies)} companies cached.")
    return companies


@app.get("/api/directory/companies")
async def company_directory(
    page: int = 1,
    industry: str = "",
    city: str = "",
    rating: float = 0,
    search: str = "",
    background_tasks: BackgroundTasks = None,
):
    cache_data = _load_json(COMPANY_DIR_PATH)
    building = False

    if not cache_data or not cache_data.get("companies"):
        building = True
        if background_tasks is not None:
            background_tasks.add_task(_build_company_directory)
        companies = [dict(co) for co in _SEED_COMPANIES]
        for co in companies:
            co.setdefault("careers_url", None)
            co.setdefault("careers_verified", False)
    else:
        try:
            ts = datetime.fromisoformat(cache_data.get("last_updated", "2000-01-01T00:00:00+00:00"))
            if datetime.now(timezone.utc) - ts > timedelta(days=7) and background_tasks is not None:
                background_tasks.add_task(_build_company_directory)
        except Exception:
            pass
        companies = cache_data.get("companies", [])

    filtered = companies
    if search:
        s = search.lower()
        filtered = [c for c in filtered if s in c.get("name", "").lower() or s in c.get("description", "").lower()]
    if industry:
        filtered = [c for c in filtered if industry.lower() in c.get("industry", "").lower()]
    if city:
        filtered = [c for c in filtered if city.lower() in c.get("headquarters", "").lower()]
    if rating > 0:
        filtered = [c for c in filtered if (c.get("rating") or 0) >= rating]

    total = len(filtered)
    page_size = 50
    start = (page - 1) * page_size

    return {
        "companies": filtered[start : start + page_size],
        "total_count": total,
        "page": page,
        "has_more": start + page_size < total,
        "building": building,
    }


@app.get("/api/colleges/list")
def colleges_list():
    return {"colleges": list(COLLEGE_DB.values())}


# ── LinkedIn Profile Analyser ─────────────────────────────────────────────────

class LinkedInAnalyseIn(BaseModel):
    profile_text: str
    target_role: str = "Software Engineer"


@app.post("/api/linkedin/analyse")
async def linkedin_analyse(payload: LinkedInAnalyseIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    if len(payload.profile_text.strip()) < 50:
        raise HTTPException(status_code=400, detail="Profile text is too short. Please paste more content from your LinkedIn profile.")

    truncated = payload.profile_text[:4000]

    prompt = (
        "You are a LinkedIn profile expert who knows exactly what Indian tech recruiters and hiring managers "
        "look for in 2026. Analyse this LinkedIn profile text for an Indian engineering student targeting placements.\n\n"
        f"Target Role: {payload.target_role}\n\n"
        f"Profile Text:\n{truncated}\n\n"
        "Return a JSON object with exactly these fields:\n"
        "{\n"
        '  "profile_score": integer 0-100,\n'
        '  "headline_analysis": {\n'
        '    "current": "their current headline or N/A if not found",\n'
        '    "verdict": "good" or "bad" or "missing",\n'
        '    "suggested": "a better headline optimised for recruiter searches for their target role"\n'
        '  },\n'
        '  "about_section": {\n'
        '    "verdict": "good" or "bad" or "missing",\n'
        '    "issues": ["specific issue 1", "specific issue 2"],\n'
        '    "suggested_opening": "first 2 sentences of a stronger About section for this person"\n'
        '  },\n'
        '  "experience_gaps": ["specific gap 1", "specific gap 2"],\n'
        '  "skills_section": {\n'
        '    "missing_key_skills": ["skill 1", "skill 2"],\n'
        '    "skills_to_remove": ["irrelevant skill 1", "irrelevant skill 2"]\n'
        '  },\n'
        '  "projects_section": {\n'
        '    "verdict": "good" or "bad" or "missing",\n'
        '    "improvements": ["specific improvement 1", "specific improvement 2"]\n'
        '  },\n'
        '  "quick_wins": [\n'
        '    "specific fix they can do TODAY in under 10 minutes",\n'
        '    "...", "...", "...", "..."\n'
        '  ],\n'
        '  "ats_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5",\n'
        '                   "keyword6", "keyword7", "keyword8", "keyword9", "keyword10"],\n'
        '  "overall_verdict": "2-3 brutal honest sentences on their LinkedIn profile strength for Indian placements"\n'
        '}\n\n'
        "Rules:\n"
        "- profile_score: be realistic. Most Indian student profiles score 25-55. A truly strong profile scores 70+.\n"
        "- headline_analysis.suggested: use format 'Role | Tech Stack | College' or 'Aspiring Role | Skill1 · Skill2 · Skill3' — what gets recruiter clicks.\n"
        "- quick_wins: SPECIFIC and doable in under 10 minutes — e.g. 'Add Python to your Skills section' not 'Improve your skills'.\n"
        "- ats_keywords: exact keywords recruiters search on LinkedIn for this target role in India in 2026.\n"
        "- experience_gaps: missing quantified achievements, missing tech stack mentions, vague bullet descriptions.\n"
        "- skills_to_remove: irrelevant skills (e.g. MS Word on a SWE profile) that dilute the profile.\n"
        "- If a section is not in the pasted text, set verdict to 'missing' and give advice on what to write.\n"
        "Only return valid JSON with no markdown formatting, no code fences, no explanation."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq linkedin response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── PYQ Generator ─────────────────────────────────────────────────────────────

class PYQIn(BaseModel):
    company: str
    round_type: str
    target_role: str = "Software Engineer"


@app.post("/api/pyq/generate")
async def pyq_generate(payload: PYQIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    prompt = (
        "You are an expert on Indian campus placement interviews and aptitude tests in 2026. "
        "Generate previous year questions for the specified company and round type.\n\n"
        f"Input:\n"
        f"- Company: {payload.company}\n"
        f"- Round: {payload.round_type} (Aptitude/Coding/Technical/HR)\n"
        f"- Role: {payload.target_role}\n\n"
        "Return JSON:\n"
        "{\n"
        '  "company": "company name",\n'
        '  "round": "round type",\n'
        '  "questions": [\n'
        '    {\n'
        '      "question": "exact question text",\n'
        '      "type": "MCQ/Coding/Subjective",\n'
        '      "difficulty": "Easy/Medium/Hard",\n'
        '      "answer": "correct answer or approach",\n'
        '      "explanation": "why this is the answer, what concept it tests",\n'
        '      "frequency": "Asked frequently/Sometimes asked/Rarely asked",\n'
        '      "topic": "e.g. Time & Work, Arrays, OOP, HR Behavioural"\n'
        '    }\n'
        '  ],\n'
        '  "exam_pattern": {\n'
        '    "total_questions": number,\n'
        '    "time_limit": "e.g. 60 minutes",\n'
        '    "sections": ["list", "of", "section", "names"],\n'
        '    "negative_marking": true or false,\n'
        '    "difficulty_level": "Easy/Medium/Hard"\n'
        '  },\n'
        '  "pro_tips": ["tip 1", "tip 2", "tip 3", "tip 4"],\n'
        '  "resources": [\n'
        '    {\n'
        '      "name": "resource name",\n'
        '      "url": "actual working URL",\n'
        '      "what_to_practice": "specific advice"\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        f"Generate 10 questions. Be specific to this company — TCS NQT questions are very different from "
        f"Infosys InfyTQ which are different from Google interviews. "
        "Only return valid JSON with no markdown."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq PYQ response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Internships ───────────────────────────────────────────────────────────────

INTERNSHIPS_CACHE_PATH = Path(__file__).parent / "internships_cache.json"
INTERNSHIPS_CACHE_TTL_HOURS = 24
INTERNSHIP_ROLES = [
    "intern",
    "software intern",
    "data science intern",
    "frontend intern",
    "backend intern",
    "ML intern",
    "product management intern",
]
INTERNSHALA_URLS = [
    "https://internshala.com/internships/computer-science-internship/",
    "https://internshala.com/internships/web-development-internship/",
    "https://internshala.com/internships/python-internship/",
    "https://internshala.com/internships/machine-learning-internship/",
    "https://internshala.com/internships/data-science-internship/",
]
_SCRAPER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def _load_internships_cache() -> dict | None:
    if not INTERNSHIPS_CACHE_PATH.exists():
        return None
    try:
        payload = json.loads(INTERNSHIPS_CACHE_PATH.read_text(encoding="utf-8"))
        ts = datetime.fromisoformat(payload["timestamp"])
        if datetime.now(timezone.utc) - ts < timedelta(hours=INTERNSHIPS_CACHE_TTL_HOURS):
            return payload
        print("[Internships] Cache expired, will refresh")
    except Exception:
        pass
    return None


async def _fetch_adzuna_internships() -> list[dict]:
    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        return []

    results: list[dict] = []
    seen_ids: set = set()
    async with httpx.AsyncClient(timeout=15) as client:
        for role in INTERNSHIP_ROLES:
            try:
                resp = await client.get(
                    "https://api.adzuna.com/v1/api/jobs/in/search/1",
                    params={
                        "app_id": app_id,
                        "app_key": app_key,
                        "results_per_page": 50,
                        "what": role,
                        "where": "india",
                        "content-type": "application/json",
                    },
                )
                resp.raise_for_status()
                for job in resp.json().get("results", []):
                    jid = job.get("id", "")
                    if jid and jid in seen_ids:
                        continue
                    if jid:
                        seen_ids.add(jid)

                    salary_min = job.get("salary_min")
                    salary_max = job.get("salary_max")
                    salary_str = ""
                    if salary_min and salary_max and salary_min > 0:
                        lpa_min = round(salary_min / 100000, 1)
                        lpa_max = round(salary_max / 100000, 1)
                        salary_str = f"₹{lpa_min}-{lpa_max} LPA"
                    elif salary_min and salary_min > 0:
                        salary_str = f"₹{round(salary_min / 100000, 1)}+ LPA"

                    days_ago_val: int | None = None
                    hiring_status_val: str | None = None
                    created_raw = job.get("created", "")
                    if created_raw:
                        try:
                            created_dt = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                            days_ago_val = (datetime.now(timezone.utc) - created_dt).days
                            if days_ago_val <= 7:
                                hiring_status_val = "Actively Hiring"
                            elif days_ago_val <= 30:
                                hiring_status_val = "Recently Posted"
                            else:
                                hiring_status_val = "May Be Closed"
                        except Exception:
                            pass

                    results.append({
                        "id": jid,
                        "title": job.get("title", ""),
                        "company": job.get("company", {}).get("display_name", "Unknown"),
                        "location": job.get("location", {}).get("display_name", "India"),
                        "description": (job.get("description", "") or "")[:350],
                        "salary": salary_str,
                        "redirect_url": job.get("redirect_url", ""),
                        "created": created_raw,
                        "days_ago": days_ago_val,
                        "hiring_status": hiring_status_val,
                        "source": "Adzuna",
                    })
            except Exception as exc:
                print(f"[Internships/Adzuna] Failed for role '{role}': {exc}")
    return results


def _scrape_internshala_category(url: str) -> list[dict]:
    try:
        import requests as _req
        from bs4 import BeautifulSoup

        resp = _req.get(url, headers=_SCRAPER_HEADERS, timeout=10)
        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        results: list[dict] = []

        for card in soup.select(".individual_internship"):
            try:
                title_el = card.select_one(".profile")
                company_el = card.select_one(".company-name")
                location_el = card.select_one(".location_link, .location")
                stipend_el = card.select_one(".stipend")
                duration_el = card.select_one(".duration-container, .duration_container")
                link_el = card.select_one("a.view_detail_button, a[href*='/internship/']")

                title = title_el.get_text(strip=True) if title_el else ""
                company = company_el.get_text(strip=True) if company_el else "Unknown"
                if not title:
                    continue

                href = link_el.get("href", "") if link_el else ""
                apply_url = f"https://internshala.com{href}" if href.startswith("/") else href
                duration_text = duration_el.get_text(strip=True) if duration_el else ""

                results.append({
                    "id": f"is_{abs(hash(title + company))}",
                    "title": title,
                    "company": company,
                    "location": location_el.get_text(strip=True) if location_el else "India",
                    "description": f"Duration: {duration_text}" if duration_text else "",
                    "salary": stipend_el.get_text(strip=True) if stipend_el else "",
                    "redirect_url": apply_url,
                    "created": "",
                    "days_ago": None,
                    "hiring_status": "Active",
                    "source": "Internshala",
                })
            except Exception:
                continue

        return results
    except Exception as e:
        print(f"[Internshala] Scrape failed for {url}: {e}")
        return []


def _scrape_internshala_all() -> list[dict]:
    results: list[dict] = []
    seen: set = set()
    for url in INTERNSHALA_URLS:
        for item in _scrape_internshala_category(url):
            key = (item["title"].lower(), item["company"].lower())
            if key not in seen:
                seen.add(key)
                results.append(item)
    return results


def _scrape_wellfound() -> list[dict]:
    try:
        import requests as _req
        from bs4 import BeautifulSoup

        resp = _req.get(
            "https://wellfound.com/jobs?role=engineer&location=india&jobType=intern",
            headers=_SCRAPER_HEADERS,
            timeout=10,
        )
        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        results: list[dict] = []

        selectors = [
            "div[class*='JobListing']",
            "div[data-testid*='job']",
            "li[class*='job']",
        ]
        cards = []
        for sel in selectors:
            cards = soup.select(sel)
            if cards:
                break

        for card in cards:
            try:
                title_el = card.select_one("h2, h3, [class*='title'], [class*='Title']")
                company_el = card.select_one("[class*='company'], [class*='Company']")
                location_el = card.select_one("[class*='location'], [class*='Location']")
                salary_el = card.select_one("[class*='salary'], [class*='compensation']")
                link_el = card.select_one("a[href*='/jobs/'], a[href*='/company/']")

                title = title_el.get_text(strip=True) if title_el else ""
                if not title or len(title) > 120:
                    continue

                href = link_el.get("href", "") if link_el else ""
                apply_url = f"https://wellfound.com{href}" if href.startswith("/") else href

                results.append({
                    "id": f"wf_{abs(hash(title + (company_el.get_text(strip=True) if company_el else '')))}",
                    "title": title,
                    "company": company_el.get_text(strip=True) if company_el else "Unknown",
                    "location": location_el.get_text(strip=True) if location_el else "India",
                    "description": "",
                    "salary": salary_el.get_text(strip=True) if salary_el else "",
                    "redirect_url": apply_url,
                    "created": "",
                    "days_ago": None,
                    "hiring_status": "Active",
                    "source": "Wellfound",
                })
            except Exception:
                continue

        return results
    except Exception as e:
        print(f"[Wellfound] Scrape failed: {e}")
        return []


@app.get("/api/internships/list")
async def internships_list(skills: str = ""):
    cached = _load_internships_cache()
    raw_internships: list = []
    source_counts: dict = {}

    if cached:
        raw_internships = cached.get("internships", [])
        source_counts = cached.get("source_counts", {})
    else:
        adzuna, internshala, wellfound = await _asyncio.gather(
            _fetch_adzuna_internships(),
            _asyncio.to_thread(_scrape_internshala_all),
            _asyncio.to_thread(_scrape_wellfound),
        )

        seen_keys: set = set()
        for job in adzuna + internshala + wellfound:
            key = (job.get("title", "").lower().strip(), job.get("company", "").lower().strip())
            if key not in seen_keys:
                seen_keys.add(key)
                raw_internships.append(job)

        source_counts = {
            "Adzuna": len(adzuna),
            "Internshala": len(internshala),
            "Wellfound": len(wellfound),
        }
        cache_payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "internships": raw_internships,
            "source_counts": source_counts,
        }
        INTERNSHIPS_CACHE_PATH.write_text(json.dumps(cache_payload, indent=2), encoding="utf-8")
        print(f"[Internships] Cached {len(raw_internships)} from {source_counts}")

    user_skills_lower = [s.strip().lower() for s in skills.split(",") if s.strip()] if skills else []
    total_skills = max(len(user_skills_lower), 1)

    result = []
    for job in raw_internships:
        if user_skills_lower:
            text = (job.get("description", "") + " " + job.get("title", "") + " " + job.get("company", "")).lower()
            matched = sum(1 for s in user_skills_lower if s in text)
            match_score = min(100, int((matched / total_skills) * 100))
        else:
            match_score = 50
        result.append({**job, "match_score": match_score})

    result.sort(key=lambda x: x["match_score"], reverse=True)
    return {"internships": result, "total": len(result), "source_counts": source_counts}


class InternshipsMatchIn(BaseModel):
    college: str
    college_tier: str = "Tier 2"
    branch: str
    year: str
    cgpa: float
    skills: list[str]
    target_role: str


@app.post("/api/internships/ai-match")
async def internships_ai_match(payload: InternshipsMatchIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    skills_str = ", ".join(payload.skills) if payload.skills else "Not specified"
    prompt = (
        "You are an internship placement expert for Indian engineering students in 2026. "
        "Given this student profile, suggest the best internship strategies and companies.\n\n"
        "Student profile:\n"
        f"- College: {payload.college}\n"
        f"- College Tier: {payload.college_tier}\n"
        f"- Branch: {payload.branch}\n"
        f"- Year: {payload.year}\n"
        f"- CGPA: {payload.cgpa}\n"
        f"- Skills: {skills_str}\n"
        f"- Target Role: {payload.target_role}\n\n"
        "Return JSON:\n"
        "{\n"
        '  "best_platforms": [\n'
        '    {\n'
        '      "platform": "platform name",\n'
        '      "url": "actual URL",\n'
        '      "why": "why this platform is best for this student specifically",\n'
        '      "how_to_use": "specific tip for using this platform"\n'
        '    }\n'
        '  ],\n'
        '  "recommended_internship_types": [\n'
        '    {\n'
        '      "type": "e.g. Open Source Contribution, Research Internship, Startup Internship, Big Tech Virtual",\n'
        '      "difficulty": "Easy/Medium/Hard to get",\n'
        '      "timeline": "how long to prepare",\n'
        '      "why_good_for_them": "specific to their profile"\n'
        '    }\n'
        '  ],\n'
        '  "virtual_internship_programs": [\n'
        '    {\n'
        '      "name": "program name e.g. Google STEP, Microsoft Engage, Goldman Sachs Insight",\n'
        '      "company": "company",\n'
        '      "url": "actual application URL",\n'
        '      "eligibility": "who can apply",\n'
        '      "deadline": "typical application window e.g. October-December",\n'
        '      "stipend": "e.g. 50,000/month or unpaid",\n'
        '      "difficulty": "Easy/Medium/Hard"\n'
        '    }\n'
        '  ],\n'
        '  "action_plan": ["step 1", "step 2", "step 3", "step 4", "step 5"],\n'
        '  "verdict": "2 sentences on their internship prospects being brutally honest"\n'
        "}\n"
        "Only return valid JSON with no markdown."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq internships response: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Referral Radar (Alumni Network) ──────────────────────────────────────────

class AlumniSubmitIn(BaseModel):
    name: str
    college: str
    branch: str
    graduation_year: str
    company: str
    role: str
    linkedin_url: str
    open_to_referrals: bool = True


@app.post("/api/referral/submit")
def referral_submit(payload: AlumniSubmitIn, db: Session = Depends(get_db)):
    record = Alumni(
        name=payload.name.strip(),
        college=payload.college.strip(),
        branch=payload.branch.strip(),
        graduation_year=payload.graduation_year.strip(),
        company=payload.company.strip(),
        role=payload.role.strip(),
        linkedin_url=payload.linkedin_url.strip(),
        open_to_referrals=payload.open_to_referrals,
        verified=False,
        submitted_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"id": record.id, "message": "Successfully added to alumni network"}


@app.get("/api/referral/list")
def referral_list(
    college: str = "",
    company: str = "",
    branch: str = "",
    db: Session = Depends(get_db),
):
    total = db.query(Alumni).count()
    college_count = db.query(Alumni.college).distinct().count()

    query = db.query(Alumni).filter(Alumni.open_to_referrals == True)  # noqa: E712
    if college:
        query = query.filter(Alumni.college == college)
    if company:
        query = query.filter(Alumni.company.ilike(f"%{company}%"))
    if branch:
        query = query.filter(Alumni.branch == branch)

    records = query.order_by(Alumni.submitted_at.desc()).limit(50).all()

    return {
        "alumni": [
            {
                "id": r.id,
                "name": r.name,
                "college": r.college,
                "branch": r.branch,
                "graduation_year": r.graduation_year,
                "company": r.company,
                "role": r.role,
                "linkedin_url": r.linkedin_url,
                "open_to_referrals": r.open_to_referrals,
                "verified": r.verified,
                "submitted_at": r.submitted_at,
            }
            for r in records
        ],
        "total": total,
        "college_count": college_count,
    }


class ReferralMessageIn(BaseModel):
    student_name: str
    student_branch: str
    student_college: str
    target_role: str
    alumni_name: str
    alumni_role: str
    alumni_company: str


@app.post("/api/referral/message")
async def referral_message(payload: ReferralMessageIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    prompt = (
        "Generate a short, professional LinkedIn connection request message (under 300 characters) "
        "from a student to an alumni asking for a referral. Be specific and genuine, not generic.\n\n"
        f"Student: {payload.student_name} studying {payload.student_branch} at {payload.student_college}, "
        f"targeting {payload.target_role}\n"
        f"Alumni: {payload.alumni_name} working as {payload.alumni_role} at {payload.alumni_company}\n\n"
        'Return JSON: {"message": "the connection request message"}\n'
        "Only return valid JSON with no markdown."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
        raw = completion.choices[0].message.content or ""
        print(f"[DEBUG] Groq referral message response: {raw[:300]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
