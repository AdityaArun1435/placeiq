import hashlib
import io
import json
import math
import os
import re
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
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
from utils.college_lookup import get_college_stats, get_college_tier, get_all_college_stats

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

    # placement_sources table (multi-source college data)
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS placement_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                college_name TEXT NOT NULL,
                source_name TEXT NOT NULL,
                placement_rate REAL,
                median_salary REAL,
                highest_salary REAL,
                top_companies TEXT,
                year INTEGER,
                url TEXT,
                scraped_at TEXT,
                UNIQUE(college_name, source_name, year)
            )
        """))

    # market_insights table (scraped news articles)
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS market_insights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                summary TEXT,
                source_name TEXT,
                source_url TEXT,
                skills_mentioned TEXT,
                roles_mentioned TEXT,
                companies_mentioned TEXT,
                city_mentioned TEXT,
                published_date TEXT,
                scraped_at TEXT
            )
        """))

    # AI response cache tables
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS roadmap_cache (
                cache_key TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cold_email_cache (
                cache_key TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS resume_cache (
                cache_key TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_cache_stats (
                endpoint TEXT PRIMARY KEY,
                cache_hits INTEGER DEFAULT 0,
                cache_misses INTEGER DEFAULT 0,
                groq_calls_saved INTEGER DEFAULT 0,
                last_reset TEXT
            )
        """))

    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS translation_cache (
                original_text_hash TEXT PRIMARY KEY,
                translated_title TEXT NOT NULL,
                translated_description TEXT NOT NULL,
                translated_at TEXT NOT NULL
            )
        """))

    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pyq_explanations (
                question_id TEXT PRIMARY KEY,
                explanation TEXT NOT NULL,
                generated_at TEXT NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pyq_quiz_cache (
                cache_key TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS coding_stats_cache (
                platform TEXT NOT NULL,
                username TEXT NOT NULL,
                stats_json TEXT NOT NULL,
                cached_at TEXT NOT NULL,
                PRIMARY KEY (platform, username)
            )
        """))

    # campus_placements table — real placement drive records per college per year
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS campus_placements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                college_name TEXT NOT NULL,
                company_name TEXT NOT NULL,
                visit_date TEXT,
                role TEXT,
                category TEXT,
                ctc REAL,
                ctc_min REAL,
                ctc_max REAL,
                eligibility_percent REAL,
                students_applied INTEGER,
                students_selected INTEGER,
                academic_year TEXT,
                source TEXT DEFAULT 'SRM KTR Placement Cell',
                UNIQUE(college_name, company_name, academic_year, role)
            )
        """))

    # pyq_questions table — sourced (not AI-generated) interview questions
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pyq_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company TEXT NOT NULL,
                round_type TEXT NOT NULL,
                question_text TEXT NOT NULL,
                difficulty TEXT,
                topic TEXT,
                source_url TEXT,
                source_name TEXT,
                year INTEGER,
                verified INTEGER DEFAULT 0
            )
        """))

    # college_overrides table — researched realistic placement stats per college
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS college_overrides (
                college_name TEXT PRIMARY KEY,
                placement_rate REAL,
                median_salary REAL,
                highest_salary REAL,
                college_tier TEXT,
                notes TEXT
            )
        """))

    # offcampus_cache table — 6-hour cache for combined job listings
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS offcampus_cache (
                cache_key TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """))

    # college_recruiter_cache — scraped company lists per college (30-day TTL)
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS college_recruiter_cache (
                college_name TEXT PRIMARY KEY,
                companies_json TEXT NOT NULL,
                scraped_at TEXT NOT NULL
            )
        """))


_migrate()


# ── Seed: Campus Placements (SRM KTR 2025-26) ────────────────────────────────

def _seed_campus_placements():
    """Seed campus_placements with SRM KTR 2025-26 real data from placement cell."""
    records = [
        ("SRM KTR", "ABG", "2026-01-27", "GET", "Core", 8.5, 8.5, 8.5, 60.0, 111, 10, "2025-26"),
        ("SRM KTR", "AB InBev", "2025-12-08", "Apprenticeship Program", "Super Dream", 12.0, 12.0, 12.0, 60.0, 2934, 18, "2025-26"),
        ("SRM KTR", "Accenture", "2025-09-15", "Associate Software Engineer", "Day 1/Day 2", 7.75, 4.5, 11.0, 40.0, 5784, 715, "2025-26"),
        ("SRM KTR", "Access Meditech", "2025-10-16", "Dot net full stack", "Dream", 5.0, 5.0, 5.0, 60.0, 8, 8, "2025-26"),
        ("SRM KTR", "Acies Global", "2025-10-23", "Associate Trainee", "Dream", 6.0, 6.0, 6.0, 85.0, 531, 10, "2025-26"),
        ("SRM KTR", "ACMEGRADE", "2025-12-15", "Business Development Associate", "Non-Engineering", 6.5, 6.5, 6.5, 60.0, 1899, 278, "2025-26"),
        ("SRM KTR", "Adobe", "2024-12-06", "Technical Consultant Intern", "Internship", 7.2, 7.2, 7.2, 70.0, 2, 2, "2025-26"),
        ("SRM KTR", "Airtel", "2025-09-17", "GET", "Core", 5.55, 5.55, 5.55, 60.0, 671, 9, "2025-26"),
        ("SRM KTR", "Akamai Technologies", "2025-02-19", "Software Engineer", "Internship", 4.56, 4.56, 4.56, 60.0, 239, 4, "2025-26"),
        ("SRM KTR", "Amazon", "2025-04-26", "Program Manager Intern", "Internship", 8.4, 8.4, 8.4, 60.0, 192, 16, "2025-26"),
        ("SRM KTR", "Asian Paints", "2025-09-18", "GET", "Super Dream", 11.6, 11.6, 11.6, 60.0, 112, 1, "2025-26"),
        ("SRM KTR", "Ather Energy", "2025-10-28", "GET", "Super Dream", 10.0, 10.0, 10.0, 60.0, 802, 6, "2025-26"),
        ("SRM KTR", "Bain Capability Network", "2025-11-27", "Intern Analyst", "Super Dream", 15.68, 15.68, 15.68, 60.0, 5217, 17, "2025-26"),
        ("SRM KTR", "Bank of America", "2025-11-12", "Apprentice Software Engineer", "Dream", 6.45, 6.45, 6.45, 60.0, 2115, 92, "2025-26"),
        ("SRM KTR", "Barclays", "2024-10-18", "Intern", "Internship", 9.0, 9.0, 9.0, 60.0, 18, 18, "2025-26"),
        ("SRM KTR", "Blinkit", "2026-01-20", "Associate Program Manager", "Super Dream", 17.0, 17.0, 17.0, 60.0, 4610, 4, "2025-26"),
        ("SRM KTR", "BMW Techworks", "2025-10-30", "Software Engineer", "Dream", 7.0, 7.0, 7.0, 70.0, 385, 4, "2025-26"),
        ("SRM KTR", "Boeing", "2025-07-22", "Software Engineering", "Dream", 9.38, 9.38, 9.38, 70.0, 2401, 10, "2025-26"),
        ("SRM KTR", "Booking Holdings", "2025-07-22", "Intern", "Marquee", 20.0, 20.0, 20.0, 60.0, 2454, 7, "2025-26"),
        ("SRM KTR", "Broadridge", "2025-08-25", "GET", "Super Dream", 10.0, 10.0, 10.0, 70.0, 3470, 4, "2025-26"),
        ("SRM KTR", "Capgemini", "2025-09-29", "Software Engineer", "Day 1/Day 2", 5.875, 4.25, 7.5, 60.0, 6188, 255, "2025-26"),
        ("SRM KTR", "Cognizant", "2025-09-21", "GenC Next/GenC Pro/GenC", "Day 1/Day 2", 5.375, 4.0, 6.75, 60.0, 6676, 381, "2025-26"),
        ("SRM KTR", "Commonwealth Bank", "2025-09-13", "Data Engineer", "Super Dream", 12.54, 12.54, 12.54, 80.0, 1166, 15, "2025-26"),
        ("SRM KTR", "CME", "2025-08-12", "SDE Intern", "Super Dream", 12.0, 12.0, 12.0, 80.0, 1632, 41, "2025-26"),
        ("SRM KTR", "Deloitte", "2025-08-26", "Analyst", "Dream", 7.6, 7.6, 7.6, 60.0, 5214, 161, "2025-26"),
        ("SRM KTR", "Diageo India", "2025-11-27", "Graduate Engineering Trainee", "Super Dream", 14.0, 14.0, 14.0, 60.0, 900, 2, "2025-26"),
        ("SRM KTR", "Electronic Arts", "2026-03-04", "SE Intern", "Marquee", 20.88, 20.88, 20.88, 75.0, 201, 1, "2025-26"),
    ]
    try:
        with engine.begin() as conn:
            for r in records:
                conn.execute(text("""
                    INSERT OR IGNORE INTO campus_placements
                    (college_name, company_name, visit_date, role, category, ctc, ctc_min, ctc_max,
                     eligibility_percent, students_applied, students_selected, academic_year, source)
                    VALUES (:college_name, :company_name, :visit_date, :role, :category, :ctc, :ctc_min, :ctc_max,
                            :eligibility_percent, :students_applied, :students_selected, :academic_year, :source)
                """), {
                    "college_name": r[0], "company_name": r[1], "visit_date": r[2],
                    "role": r[3], "category": r[4], "ctc": r[5], "ctc_min": r[6], "ctc_max": r[7],
                    "eligibility_percent": r[8], "students_applied": r[9], "students_selected": r[10],
                    "academic_year": r[11], "source": "SRM KTR Placement Cell",
                })
    except Exception as e:
        print(f"[Seed] campus_placements error: {e}")


# ── Seed: PYQ Questions (sourced data) ───────────────────────────────────────

def _seed_pyq_questions():
    """Seed pyq_questions with hardcoded sourced data for top companies."""
    questions = [
        # TCS NQT
        ("TCS", "aptitude", "Find the next number in series: 2, 6, 12, 20, 30, ?", "Easy", "Number Series", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        ("TCS", "aptitude", "A train travels 360km in 4 hours. What is its speed in m/s?", "Easy", "Time & Distance", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        ("TCS", "aptitude", "If A is the brother of B, B is the sister of C, and C is the father of D, then how is A related to D?", "Medium", "Blood Relations", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        ("TCS", "aptitude", "All roses are flowers. Some flowers fade quickly. Therefore: (A) Some roses fade quickly (B) No roses fade quickly (C) Either A or B (D) Cannot be determined", "Medium", "Syllogism", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        ("TCS", "aptitude", "A man can do a job in 15 days. His son can do the same job in 20 days. How many days will they take if they work together?", "Easy", "Time & Work", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        ("TCS", "coding", "Write a program to print all prime numbers between 1 and N.", "Easy", "Basic Programming", "https://prepinsta.com/tcs/tcs-coding-questions/", "PrepInsta · TCS NQT Coding", 2024, 1),
        ("TCS", "coding", "Reverse a given string without using built-in reverse functions.", "Easy", "Strings", "https://prepinsta.com/tcs/tcs-coding-questions/", "PrepInsta · TCS NQT Coding", 2024, 1),
        ("TCS", "technical", "What is the difference between a class and an object in OOP?", "Easy", "OOPs", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        ("TCS", "technical", "What is normalization in DBMS? Explain 1NF, 2NF, 3NF.", "Medium", "DBMS", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        ("TCS", "technical", "What is the difference between stack and heap memory?", "Easy", "C/C++ Basics", "https://prepinsta.com/tcs/", "PrepInsta · TCS NQT", 2024, 1),
        # Infosys InfyTQ
        ("Infosys", "aptitude", "A train travels 360km in 4 hours. What is its speed in m/s?", "Easy", "Time & Distance", "https://prepinsta.com/infosys/", "PrepInsta · Infosys InfyTQ", 2024, 1),
        ("Infosys", "aptitude", "Find the odd one out: 2, 4, 8, 16, 31, 64", "Easy", "Number Series", "https://prepinsta.com/infosys/", "PrepInsta · Infosys InfyTQ", 2024, 1),
        ("Infosys", "aptitude", "Six people sit in a row: A, B, C, D, E, F. A is to the left of B. C is between D and E. Where is F?", "Hard", "Seating Arrangement", "https://prepinsta.com/infosys/", "PrepInsta · Infosys InfyTQ", 2024, 1),
        ("Infosys", "coding", "Write a program to find the factorial of a number using recursion.", "Easy", "Recursion", "https://prepinsta.com/infosys/infosys-coding-questions/", "PrepInsta · Infosys Coding", 2024, 1),
        ("Infosys", "coding", "Given an array, find the second largest element.", "Easy", "Arrays", "https://prepinsta.com/infosys/infosys-coding-questions/", "PrepInsta · Infosys Coding", 2024, 1),
        ("Infosys", "technical", "What is polymorphism? Give examples of compile-time and runtime polymorphism.", "Medium", "OOPs", "https://prepinsta.com/infosys/", "PrepInsta · Infosys InfyTQ", 2024, 1),
        ("Infosys", "technical", "What is a foreign key? How is it different from a primary key?", "Easy", "DBMS", "https://prepinsta.com/infosys/", "PrepInsta · Infosys InfyTQ", 2024, 1),
        # Wipro NLTH
        ("Wipro", "aptitude", "What is 15% of 2000?", "Easy", "Percentages", "https://prepinsta.com/wipro/", "PrepInsta · Wipro NLTH", 2024, 1),
        ("Wipro", "aptitude", "If BOOK is coded as CPPL, how is COOK coded?", "Easy", "Coding/Decoding", "https://prepinsta.com/wipro/", "PrepInsta · Wipro NLTH", 2024, 1),
        ("Wipro", "coding", "Write a program to check if a string is a palindrome.", "Easy", "Strings", "https://prepinsta.com/wipro/wipro-coding-questions/", "PrepInsta · Wipro NLTH Coding", 2024, 1),
        ("Wipro", "coding", "Print the Fibonacci sequence up to N terms.", "Easy", "Basic Programming", "https://prepinsta.com/wipro/wipro-coding-questions/", "PrepInsta · Wipro NLTH Coding", 2024, 1),
        ("Wipro", "technical", "What is inheritance in OOP? List its types.", "Easy", "OOPs", "https://prepinsta.com/wipro/", "PrepInsta · Wipro NLTH", 2024, 1),
        # Cognizant GenC
        ("Cognizant", "aptitude", "A car covers 120 km in 3 hours. Another car covers 180 km in 4 hours. What is the ratio of their speeds?", "Medium", "Ratio & Proportion", "https://prepinsta.com/cognizant/", "PrepInsta · Cognizant GenC", 2024, 1),
        ("Cognizant", "coding", "Write a program to sort an array using bubble sort.", "Easy", "Sorting", "https://prepinsta.com/cognizant/cognizant-coding-questions/", "PrepInsta · Cognizant GenC", 2024, 1),
        ("Cognizant", "technical", "What is Agile methodology? What are sprints?", "Easy", "SDLC / Agile", "https://prepinsta.com/cognizant/", "PrepInsta · Cognizant GenC", 2024, 1),
        # Accenture
        ("Accenture", "aptitude", "If the sum of two numbers is 20 and their product is 96, find the numbers.", "Easy", "Algebra", "https://prepinsta.com/accenture/", "PrepInsta · Accenture", 2024, 1),
        ("Accenture", "coding", "Write a program to print a pattern: * ** *** **** *****", "Easy", "Patterns", "https://prepinsta.com/accenture/accenture-coding-questions/", "PrepInsta · Accenture", 2024, 1),
        ("Accenture", "coding", "Find the sum of all elements in an array.", "Easy", "Arrays", "https://prepinsta.com/accenture/accenture-coding-questions/", "PrepInsta · Accenture", 2024, 1),
        # Amazon SDE
        ("Amazon", "coding", "Given an array of integers, return indices of the two numbers such that they add up to a target (Two Sum).", "Easy", "Arrays / Hash Map", "https://leetcode.com/company/amazon/", "LeetCode · Amazon Interview", 2024, 1),
        ("Amazon", "coding", "Design an LRU (Least Recently Used) Cache that supports get and put operations in O(1) time.", "Hard", "Design / Linked List", "https://leetcode.com/company/amazon/", "LeetCode · Amazon Interview", 2024, 1),
        ("Amazon", "coding", "Merge all overlapping intervals in a given list of intervals.", "Medium", "Arrays / Intervals", "https://leetcode.com/company/amazon/", "LeetCode · Amazon Interview", 2024, 1),
        ("Amazon", "coding", "Find the top K frequent elements in an array.", "Medium", "Heap / Hash Map", "https://leetcode.com/company/amazon/", "LeetCode · Amazon Interview", 2024, 1),
        ("Amazon", "technical", "Design a URL shortening service like bit.ly. What are the key components?", "Hard", "System Design", "https://www.geeksforgeeks.org/amazon-interview-experience/", "GFG · Amazon Interview Experience", 2024, 1),
        ("Amazon", "hr", "Tell me about a time when you had to work with a difficult team member. What did you do? (Conflict resolution - Leadership Principle: Earn Trust)", "Medium", "Leadership Principles", "https://www.amazon.jobs/en/landing_pages/leadership-principles", "Amazon Leadership Principles", 2024, 1),
        ("Amazon", "hr", "Describe a situation where you had to deliver results under tight deadlines. (Leadership Principle: Deliver Results)", "Medium", "Leadership Principles", "https://www.amazon.jobs/en/landing_pages/leadership-principles", "Amazon Leadership Principles", 2024, 1),
        # Microsoft SDE
        ("Microsoft", "coding", "Given a linked list, reverse it in place.", "Easy", "Linked Lists", "https://www.geeksforgeeks.org/microsoft-interview-experience/", "GFG · Microsoft Interview Experience", 2024, 1),
        ("Microsoft", "coding", "Find the lowest common ancestor (LCA) of two nodes in a binary tree.", "Medium", "Trees", "https://www.geeksforgeeks.org/microsoft-interview-experience/", "GFG · Microsoft Interview Experience", 2024, 1),
        ("Microsoft", "coding", "Given a string, find the length of the longest substring without repeating characters.", "Medium", "Strings / Sliding Window", "https://leetcode.com/company/microsoft/", "LeetCode · Microsoft Interview", 2024, 1),
        ("Microsoft", "technical", "What is the difference between a process and a thread? How does context switching work?", "Medium", "Operating Systems", "https://www.geeksforgeeks.org/microsoft-interview-experience/", "GFG · Microsoft Interview Experience", 2024, 1),
        # Google SWE
        ("Google", "coding", "Given n non-negative integers representing an elevation map, compute how much water it can trap after raining.", "Hard", "Arrays / Two Pointers", "https://leetcode.com/company/google/", "LeetCode · Google Interview", 2024, 1),
        ("Google", "coding", "Find the kth largest element in an unsorted array without sorting.", "Medium", "Heap / QuickSelect", "https://leetcode.com/company/google/", "LeetCode · Google Interview", 2024, 1),
        ("Google", "technical", "How would you design a distributed key-value store? What consistency guarantees would you provide?", "Hard", "System Design / Distributed Systems", "https://www.geeksforgeeks.org/google-interview-experience/", "GFG · Google Interview Experience", 2024, 1),
        # Deloitte
        ("Deloitte", "aptitude", "What is 25% of 480?", "Easy", "Percentages", "https://prepinsta.com/deloitte/", "PrepInsta · Deloitte", 2024, 1),
        ("Deloitte", "technical", "What is the difference between SQL and NoSQL databases? When would you use each?", "Medium", "DBMS", "https://prepinsta.com/deloitte/", "PrepInsta · Deloitte", 2024, 1),
        # Capgemini
        ("Capgemini", "aptitude", "If 6 men can complete a work in 8 days, how many days will 4 men take to complete the same work?", "Easy", "Time & Work", "https://prepinsta.com/capgemini/", "PrepInsta · Capgemini", 2024, 1),
        ("Capgemini", "coding", "Write a program to find all anagrams of a given string in a text.", "Medium", "Strings / Sliding Window", "https://prepinsta.com/capgemini/capgemini-coding-questions/", "PrepInsta · Capgemini Coding", 2024, 1),
        # HCL
        ("HCL", "aptitude", "A shopkeeper sells goods at 20% profit. If cost price is Rs 500, what is the selling price?", "Easy", "Profit & Loss", "https://prepinsta.com/hcl/", "PrepInsta · HCL", 2024, 1),
        ("HCL", "coding", "Check if a number is Armstrong number (sum of cubes of digits equals number).", "Easy", "Basic Programming", "https://prepinsta.com/hcl/", "PrepInsta · HCL", 2024, 1),
    ]
    try:
        with engine.begin() as conn:
            for q in questions:
                conn.execute(text("""
                    INSERT OR IGNORE INTO pyq_questions
                    (company, round_type, question_text, difficulty, topic, source_url, source_name, year, verified)
                    VALUES (:company, :round_type, :question_text, :difficulty, :topic, :source_url, :source_name, :year, :verified)
                """), {
                    "company": q[0], "round_type": q[1], "question_text": q[2], "difficulty": q[3],
                    "topic": q[4], "source_url": q[5], "source_name": q[6], "year": q[7], "verified": q[8],
                })
    except Exception as e:
        print(f"[Seed] pyq_questions error: {e}")


# ── Seed: College Overrides (researched realistic values) ────────────────────

def _seed_college_overrides():
    """Seed college_overrides with researched realistic placement stats."""
    overrides = [
        # South Indian colleges (researched from Shiksha, Quora, placement reports)
        ("SRM KTR", 42.0, 4.2, 44.0, "Tier 2", "Large batch size (5000+/year) reduces per-student odds despite high absolute numbers"),
        ("SRM Ramapuram", 32.0, 3.6, 12.0, "Tier 3", ""),
        ("VIT Vellore", 78.0, 6.8, 52.0, "Tier 2", "Strong CSE placement, core branches lower"),
        ("VIT Chennai", 62.0, 5.4, 30.0, "Tier 2", ""),
        ("Manipal MIT", 68.0, 6.2, 42.0, "Tier 2", ""),
        ("PSG Tech Coimbatore", 88.0, 5.8, 24.0, "Tier 2", ""),
        ("SSN College Chennai", 91.0, 6.5, 28.0, "Tier 2", ""),
        ("CEG Anna University", 76.0, 5.2, 22.0, "Tier 2", ""),
        ("Sastra University", 72.0, 5.0, 20.0, "Tier 2", ""),
        ("Amrita Coimbatore", 71.0, 5.2, 26.0, "Tier 2", ""),
        ("Amrita Chennai", 65.0, 4.8, 20.0, "Tier 2", ""),
        ("VIT AP", 55.0, 4.5, 18.0, "Tier 2", ""),
        ("KCG College", 58.0, 4.2, 14.0, "Tier 2", ""),
        ("Rajalakshmi Engineering College", 62.0, 4.0, 12.0, "Tier 2", ""),
        ("Sri Sivasubramaniya Nadar College", 85.0, 6.0, 22.0, "Tier 2", ""),
        ("Velammal Engineering College", 55.0, 3.8, 12.0, "Tier 3", ""),
        ("Saveetha Engineering College", 45.0, 3.4, 10.0, "Tier 3", ""),
        ("Sathyabama University", 40.0, 3.2, 10.0, "Tier 3", ""),
        ("Hindustan Institute of Technology", 38.0, 3.0, 9.0, "Tier 3", ""),
        ("Jeppiaar Engineering College", 35.0, 2.8, 8.0, "Tier 3", ""),
        # NITs and IIITs
        ("NIT Trichy", 92.0, 12.0, 80.0, "Tier 1", ""),
        ("NIT Surathkal", 89.0, 11.0, 65.0, "Tier 1", ""),
        ("NIT Warangal", 88.0, 10.5, 60.0, "Tier 1", ""),
        ("IIIT Hyderabad", 95.0, 18.0, 120.0, "Tier 1", ""),
        ("IIIT Bangalore", 92.0, 16.0, 100.0, "Tier 1", ""),
    ]
    try:
        with engine.begin() as conn:
            for o in overrides:
                conn.execute(text("""
                    INSERT OR IGNORE INTO college_overrides
                    (college_name, placement_rate, median_salary, highest_salary, college_tier, notes)
                    VALUES (:college_name, :placement_rate, :median_salary, :highest_salary, :college_tier, :notes)
                """), {
                    "college_name": o[0], "placement_rate": o[1], "median_salary": o[2],
                    "highest_salary": o[3], "college_tier": o[4], "notes": o[5],
                })
    except Exception as e:
        print(f"[Seed] college_overrides error: {e}")


_seed_campus_placements()
_seed_pyq_questions()
_seed_college_overrides()


def _cache_get(table: str, key: str, ttl_hours: int) -> str | None:
    """Return cached content if it exists and is within TTL, else None."""
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(f"SELECT content, created_at FROM {table} WHERE cache_key = :k"),
                {"k": key},
            ).fetchone()
            if row:
                ts = datetime.fromisoformat(row[1])
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - ts <= timedelta(hours=ttl_hours):
                    return row[0]
    except Exception as e:
        print(f"[Cache] get error ({table}): {e}")
    return None


def _cache_set(table: str, key: str, content: str):
    """Upsert content into cache table."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(f"DELETE FROM {table} WHERE cache_key = :k"),
                {"k": key},
            )
            conn.execute(
                text(f"INSERT INTO {table} (cache_key, content, created_at) VALUES (:k, :c, :t)"),
                {"k": key, "c": content, "t": datetime.now(timezone.utc).isoformat()},
            )
    except Exception as e:
        print(f"[Cache] set error ({table}): {e}")


def _cache_stat(endpoint: str, hit: bool):
    """Increment cache hit/miss stats."""
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO ai_cache_stats (endpoint, cache_hits, cache_misses, groq_calls_saved, last_reset)
                VALUES (:ep, 0, 0, 0, :t)
                ON CONFLICT(endpoint) DO NOTHING
            """), {"ep": endpoint, "t": datetime.now(timezone.utc).isoformat()})
            if hit:
                conn.execute(text("""
                    UPDATE ai_cache_stats
                    SET cache_hits = cache_hits + 1, groq_calls_saved = groq_calls_saved + 1
                    WHERE endpoint = :ep
                """), {"ep": endpoint})
            else:
                conn.execute(text("""
                    UPDATE ai_cache_stats SET cache_misses = cache_misses + 1 WHERE endpoint = :ep
                """), {"ep": endpoint})
    except Exception as e:
        print(f"[Cache] stat error: {e}")

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

    # Build market intelligence directly from Adzuna data — no Groq
    max_count = top_skills[0][1] if top_skills else 1

    _SKILL_WHY = {
        "Python": "Used across data science, backend, automation, and AI — the most versatile language for Indian fresher job listings",
        "Java": "Backbone of enterprise software at TCS, Infosys, and most service companies; Spring Boot dominates backend hiring",
        "JavaScript": "Frontend and Node.js backend — any web-facing role in India requires JavaScript proficiency",
        "React": "Most demanded frontend framework across Indian product companies and startups in 2025",
        "SQL": "Mandatory for data roles and expected in most backend interviews — can't be skipped",
        "Docker": "Containerisation is now standard in DevOps and backend roles, driving up demand sharply",
        "AWS": "Cloud skills command a 20-30% salary premium; AWS leads over GCP and Azure in Indian listings",
        "Machine Learning": "AI/ML roles are growing 40% YoY in India; freshers with project experience stand out",
        "TypeScript": "Replacing vanilla JavaScript in product companies — TypeScript jobs pay 15-20% more",
        "Kubernetes": "Orchestration skill expected for senior DevOps; freshers learning it get a strong edge",
        "Node.js": "Full-stack JavaScript development standard; startups and mid-size product companies rely on it",
        "Django": "Python web framework popular at Indian startups and SMEs, second only to FastAPI in new projects",
        "System Design": "Required for SDE-2 interviews and increasingly asked of freshers at product companies",
        "DSA": "Gate to product company interviews — LeetCode medium-hard fluency separates offers from rejections",
        "Data Structures": "Core for all coding interviews; expected at service and product companies alike",
        "Git": "Non-negotiable for any software role; expected day one",
        "Linux": "Backend and DevOps backbone; every production system uses Linux",
    }

    _COMPANY_SKILLS = {
        "Python": ["TCS", "Infosys", "Zoho", "Freshworks", "PhonePe", "Swiggy"],
        "Java": ["TCS", "Infosys", "Wipro", "Accenture", "Cognizant", "HCL"],
        "JavaScript": ["Freshworks", "Razorpay", "Zoho", "Chargebee"],
        "React": ["Freshworks", "Razorpay", "Groww", "Zepto"],
        "SQL": ["TCS", "Infosys", "Wipro", "Cognizant", "Goldman Sachs"],
        "AWS": ["Amazon", "Wipro", "TCS", "Accenture"],
        "Docker": ["Wipro", "HCL", "Tech Mahindra", "IBM"],
        "Machine Learning": ["TCS", "Infosys", "Amazon", "Flipkart"],
        "DSA": ["Google", "Microsoft", "Amazon", "PhonePe", "Razorpay"],
    }

    _ROLE_SALARY = {
        "software engineer": 12, "data scientist": 14, "frontend developer": 10,
        "backend developer": 12, "devops engineer": 11, "machine learning engineer": 15,
        "full stack developer": 11, "android developer": 10, "product manager": 16,
    }
    _ROLE_YOY = {
        "software engineer": "+12%", "data scientist": "+25%", "frontend developer": "+8%",
        "backend developer": "+15%", "devops engineer": "+20%", "machine learning engineer": "+35%",
        "full stack developer": "+10%", "android developer": "+5%", "product manager": "+18%",
    }
    _ROLE_CHECK = {
        "software engineer": "Over 200,000 freshers compete for ~40,000 quality SDE roles annually — DSA fluency is the real filter",
        "data scientist": "Most 'data scientist' openings actually want data analysts; genuine ML roles require project evidence",
        "frontend developer": "React/TypeScript skills are non-negotiable; pure HTML/CSS knowledge isn't enough for product companies",
        "backend developer": "Strong DSA and system design required — service company backend roles are less competitive but also lower paying",
        "devops engineer": "DevOps fresher roles are rare; most companies want 1-2 years experience, making internships critical",
        "machine learning engineer": "True ML engineering roles are highly competitive; differentiation comes from deployed projects and Kaggle rankings",
        "full stack developer": "Startups prefer full stack but quality bar is high — both frontend and backend must be polished",
    }
    _ROLE_COMPANIES = {
        "software engineer": ["TCS", "Infosys", "Wipro", "Amazon", "Microsoft"],
        "data scientist": ["TCS", "Infosys", "PhonePe", "Amazon", "Flipkart"],
        "frontend developer": ["Freshworks", "Razorpay", "Zoho", "Chargebee"],
        "backend developer": ["TCS", "Infosys", "Wipro", "PhonePe", "Swiggy"],
        "devops engineer": ["Wipro", "HCL", "IBM", "Accenture", "Amazon"],
        "machine learning engineer": ["TCS", "Infosys", "Amazon", "Flipkart", "PhonePe"],
        "full stack developer": ["Freshworks", "Zoho", "Chargebee", "Zepto"],
    }
    _ROLE_SKILLS = {
        "software engineer": ["DSA", "Python", "Java", "SQL"],
        "data scientist": ["Python", "Machine Learning", "SQL", "Statistics"],
        "frontend developer": ["JavaScript", "React", "TypeScript", "CSS"],
        "backend developer": ["Python", "Java", "SQL", "REST API"],
        "devops engineer": ["Docker", "Kubernetes", "Linux", "AWS"],
        "machine learning engineer": ["Python", "PyTorch", "TensorFlow", "Machine Learning"],
        "full stack developer": ["JavaScript", "React", "Node.js", "SQL"],
        "android developer": ["Kotlin", "Java", "Android", "REST API"],
        "product manager": ["SQL", "Data Analysis", "Agile", "Figma"],
    }

    trending_skills = [
        {
            "skill": s,
            "demand_score": normalize_score(c, max_count),
            "trend": "rising" if normalize_score(c, max_count) >= 70 else "stable",
            "avg_salary_lpa": 10 + int(normalize_score(c, max_count) / 20),
            "job_count": c,
            "why_trending": _SKILL_WHY.get(s, f"High mention frequency across {c} Indian job postings"),
            "top_companies": _COMPANY_SKILLS.get(s, ["TCS", "Infosys", "Wipro"]),
        }
        for s, c in top_skills[:15]
    ]

    sample_companies = list({
        j.get("company", {}).get("display_name", "")
        for j in all_jobs[:200]
        if j.get("company", {}).get("display_name")
    })[:20]

    role_demand = []
    for role, count in sorted(role_counts.items(), key=lambda x: -x[1])[:8]:
        role_demand.append({
            "role": role.title(),
            "openings": count,
            "avg_lpa": _ROLE_SALARY.get(role, 10),
            "yoy_change": _ROLE_YOY.get(role, "+10%"),
            "top_companies": _ROLE_COMPANIES.get(role, sample_companies[:4] or ["TCS", "Infosys"]),
            "key_skills": _ROLE_SKILLS.get(role, ["Python", "DSA", "SQL"]),
            "reality_check": _ROLE_CHECK.get(role, "Competition is high — skills and projects are your differentiator"),
        })

    top_hiring = list(dict.fromkeys(
        [j.get("company", {}).get("display_name", "") for j in all_jobs[:500]
         if j.get("company", {}).get("display_name")]
    ))[:15] or ["TCS", "Infosys", "Wipro", "Accenture", "Cognizant"]

    result = {
        "trending_skills": trending_skills,
        "role_demand": role_demand,
        "top_hiring_companies": top_hiring,
        "salary_by_city": [
            {"city": "Bangalore", "avg_lpa": 18, "cost_of_living": "High", "best_for_roles": ["Software Engineer", "Data Scientist", "DevOps Engineer"]},
            {"city": "Hyderabad", "avg_lpa": 14, "cost_of_living": "Moderate", "best_for_roles": ["Software Engineer", "Full Stack Developer"]},
            {"city": "Pune", "avg_lpa": 12, "cost_of_living": "Moderate", "best_for_roles": ["Software Engineer", "Data Analyst"]},
            {"city": "Chennai", "avg_lpa": 11, "cost_of_living": "Moderate", "best_for_roles": ["Software Engineer", "Backend Developer"]},
            {"city": "Mumbai", "avg_lpa": 13, "cost_of_living": "Very High", "best_for_roles": ["Data Scientist", "Product Manager", "FinTech Engineer"]},
            {"city": "Delhi-NCR", "avg_lpa": 12, "cost_of_living": "High", "best_for_roles": ["Software Engineer", "Data Analyst"]},
        ],
        "hot_sectors": [
            {"sector": "FinTech", "status": "Booming", "reason": "UPI ecosystem growth is driving massive engineering hiring at PhonePe, Razorpay, Groww, and Zepto"},
            {"sector": "AI/ML", "status": "Booming", "reason": "Every major company is building AI teams — freshers with ML project experience command 30-50% salary premiums"},
            {"sector": "Cloud & DevOps", "status": "Booming", "reason": "Cloud migration projects across all industries are creating more DevOps roles than available engineers"},
            {"sector": "SaaS Products", "status": "Stable", "reason": "Indian SaaS companies (Freshworks, Zoho, Chargebee) continue steady hiring despite global slowdowns"},
            {"sector": "IT Services", "status": "Stable", "reason": "TCS, Infosys, Wipro maintain large fresher intakes but wage growth is slow compared to product companies"},
            {"sector": "EdTech", "status": "Slow", "reason": "Post-2022 correction; most EdTech companies are in cost-cutting mode with limited fresher hiring"},
        ],
        "skills_to_avoid": [
            {"skill": "COBOL", "reason": "Legacy banking language with 0 fresher demand — time spent here has near-zero ROI for Indian freshers"},
            {"skill": "PHP", "reason": "WordPress and legacy PHP roles are declining sharply; modern Indian companies prefer Python/Node.js stacks"},
            {"skill": "XML/SOAP", "reason": "REST and GraphQL have fully replaced SOAP in Indian product companies — XML is only relevant in legacy banking roles"},
        ],
        "market_summary": (
            f"Adzuna data shows {len(all_jobs)} active job postings across {len(ADZUNA_ROLES)} role categories in India. "
            f"Software engineering and data science have the highest demand, with top skills being "
            f"{', '.join(s for s, _ in top_skills[:3]) if top_skills else 'Python, Java, SQL'}. "
            f"Product and startup roles pay 2-3x more than service companies but require significantly stronger DSA and project evidence."
        ),
        "data_freshness": f"Live data from Adzuna — {len(all_jobs)} jobs scraped today",
    }

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
    print(f"[Market] Cache written to {MARKET_CACHE_PATH} (pure data, no Groq)")
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


def _seed_nirf_sync():
    """Run NIRF scraper if nirf_placements table is empty."""
    try:
        from database import get_connection
        con = get_connection()
        try:
            row = con.execute("SELECT COUNT(*) FROM nirf_placements").fetchone()
            if row and row[0] > 0:
                print(f"[NIRF] {row[0]} colleges already in nirf_placements — skipping seed.")
                return
        except Exception:
            pass  # Table doesn't exist yet
        finally:
            con.close()
        print("[NIRF] nirf_placements empty — seeding now...")
        from scrapers.nirf_scraper import run_nirf_scraper
        run_nirf_scraper()
    except Exception as exc:
        print(f"[NIRF] Startup seed failed: {exc}")


def _seed_placement_sources_sync():
    """Seed Shiksha + Careers360 data if placement_sources table is empty."""
    try:
        from database import get_connection
        con = get_connection()
        try:
            row = con.execute("SELECT COUNT(*) FROM placement_sources").fetchone()
            if row and row[0] > 0:
                print(f"[Sources] {row[0]} records already in placement_sources — skipping seed.")
                return
        except Exception:
            pass
        finally:
            con.close()
        print("[Sources] placement_sources empty — seeding Shiksha + Careers360...")
        from scrapers.shiksha_scraper import run_shiksha_scraper
        from scrapers.careers360_scraper import run_careers360_scraper
        n1 = run_shiksha_scraper()
        n2 = run_careers360_scraper()
        print(f"[Sources] Seeded {n1} Shiksha + {n2} Careers360 records.")
    except Exception as exc:
        print(f"[Sources] Startup seed failed: {exc}")


def _ensure_skill_demand_tables():
    """Create job_listings, skill_demand, and model_metadata tables if absent."""
    from database import get_connection, db_type
    try:
        con = get_connection()
        cur = con.cursor()
        if db_type == "supabase":
            cur.execute("""
                CREATE TABLE IF NOT EXISTS job_listings (
                    id SERIAL PRIMARY KEY,
                    title TEXT,
                    description TEXT,
                    role TEXT,
                    fetched_at TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS skill_demand (
                    skill_name TEXT,
                    role TEXT,
                    demand_count INTEGER,
                    demand_percentage REAL,
                    total_listings_analysed INTEGER,
                    last_updated TEXT,
                    PRIMARY KEY (skill_name, role)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS model_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
        else:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS job_listings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    description TEXT,
                    role TEXT,
                    fetched_at TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS skill_demand (
                    skill_name TEXT,
                    role TEXT,
                    demand_count INTEGER,
                    demand_percentage REAL,
                    total_listings_analysed INTEGER,
                    last_updated TEXT,
                    PRIMARY KEY (skill_name, role)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS model_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
        con.commit()
        con.close()
        print("[Skills] skill_demand / job_listings / model_metadata tables ready")
    except Exception as exc:
        print(f"[Skills] Table creation failed: {exc}")


async def extract_and_store_skill_demand():
    """Daily job: fetch job listings per role, extract skill frequencies, persist to skill_demand."""
    from collections import Counter as _Counter
    from ml.skill_extractor import extract_skills_from_text
    from database import get_connection, db_type

    print("[Skills] Starting daily skill extraction...")

    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        print("[Skills] Adzuna credentials missing — skipping skill extraction")
        return

    fetched_at = datetime.now(timezone.utc).isoformat()
    jobs_by_role: dict[str, list[dict]] = {}

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
                jobs_by_role[role] = resp.json().get("results", [])
            except Exception as exc:
                print(f"[Skills] Adzuna fetch failed for '{role}': {exc}")
                jobs_by_role[role] = []

    # Persist raw listings to job_listings table (prune entries older than 2 days first)
    try:
        con = get_connection()
        cur = con.cursor()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        if db_type == "supabase":
            cur.execute("DELETE FROM job_listings WHERE fetched_at < %s", (cutoff,))
            ins = "INSERT INTO job_listings (title, description, role, fetched_at) VALUES (%s, %s, %s, %s)"
        else:
            cur.execute("DELETE FROM job_listings WHERE fetched_at < ?", (cutoff,))
            ins = "INSERT INTO job_listings (title, description, role, fetched_at) VALUES (?, ?, ?, ?)"
        for role, jobs in jobs_by_role.items():
            for job in jobs:
                cur.execute(ins, (job.get("title", ""), job.get("description", ""), role, fetched_at))
        con.commit()
        con.close()
    except Exception as exc:
        print(f"[Skills] Failed to store job listings: {exc}")

    # Aggregate skill demand per role
    now_str = datetime.now(timezone.utc).isoformat()
    total_listings = 0
    unique_skills: set[str] = set()
    skill_demand_rows: list[tuple] = []

    for role, jobs in jobs_by_role.items():
        counter: _Counter = _Counter()
        role_total = len(jobs)
        total_listings += role_total
        for job in jobs:
            text = (job.get("title", "") + " " + job.get("description", "")).strip()
            for skill in extract_skills_from_text(text):
                counter[skill] += 1
                unique_skills.add(skill)
        for skill, count in counter.items():
            pct = round(count / role_total * 100, 1) if role_total > 0 else 0.0
            skill_demand_rows.append((skill, role, count, pct, role_total, now_str))

    # Persist to skill_demand table
    try:
        con = get_connection()
        cur = con.cursor()
        if db_type == "supabase":
            for row in skill_demand_rows:
                cur.execute("""
                    INSERT INTO skill_demand (skill_name, role, demand_count, demand_percentage, total_listings_analysed, last_updated)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (skill_name, role) DO UPDATE SET
                        demand_count = EXCLUDED.demand_count,
                        demand_percentage = EXCLUDED.demand_percentage,
                        total_listings_analysed = EXCLUDED.total_listings_analysed,
                        last_updated = EXCLUDED.last_updated
                """, row)
        else:
            for row in skill_demand_rows:
                cur.execute("""
                    INSERT OR REPLACE INTO skill_demand
                        (skill_name, role, demand_count, demand_percentage, total_listings_analysed, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, row)
        con.commit()
        con.close()
    except Exception as exc:
        print(f"[Skills] Failed to store skill demand: {exc}")
        return

    print(
        f"[Skills] Skill extraction complete. Analysed {total_listings} listings, "
        f"found {len(unique_skills)} unique skills across {len(jobs_by_role)} roles"
    )


async def monthly_model_retrain():
    """Monthly job: retrain XGBoost model on accumulated data and log metrics."""
    from database import get_connection, db_type
    print("[ML] Starting monthly model retrain...")
    try:
        from ml.placement_model import train_model
        metrics = train_model()
        retrain_date = datetime.now(timezone.utc).isoformat()
        con = get_connection()
        cur = con.cursor()
        if db_type == "supabase":
            cur.execute("""
                INSERT INTO model_metadata (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, ("model_last_retrained", retrain_date))
        else:
            cur.execute(
                "INSERT OR REPLACE INTO model_metadata (key, value) VALUES (?, ?)",
                ("model_last_retrained", retrain_date),
            )
        con.commit()
        con.close()
        print(f"[ML] Monthly model retrain complete. New RMSE: {metrics['rmse']:.2f} R2: {metrics['r2']:.3f}")
    except Exception as exc:
        print(f"[ML] Monthly model retrain failed: {exc}")


def _get_placement_sources(college_name: str) -> list[dict]:
    """Return all placement_sources rows for the best fuzzy match of college_name.
    Applies the same alias resolution as college_lookup before fuzzy matching."""
    import json as _json
    from difflib import get_close_matches as _gcm
    from database import get_connection as _gc
    from utils.college_lookup import _COLLEGE_ALIASES  # reuse alias dict
    try:
        con = _gc()
        try:
            cur = con.cursor()
            cur.execute("SELECT DISTINCT college_name FROM placement_sources")
            all_names = [r[0] for r in cur.fetchall()]
            if not all_names:
                return []
            # Try alias resolution first
            resolved = _COLLEGE_ALIASES.get(college_name)
            matched = None
            if resolved and resolved in all_names:
                matched = resolved
            else:
                # Fuzzy match on both original and alias-resolved name
                candidates = [college_name]
                if resolved:
                    candidates.append(resolved)
                for candidate in candidates:
                    hits = _gcm(candidate, all_names, n=1, cutoff=0.6)
                    if hits:
                        matched = hits[0]
                        break
            if not matched:
                return []
            cur.execute(
                "SELECT source_name, placement_rate, median_salary, highest_salary, "
                "top_companies, year, url "
                "FROM placement_sources WHERE college_name = ? ORDER BY source_name",
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


@app.on_event("startup")
async def _startup():
    _scheduler.add_job(refresh_market_cache, "cron", hour=0, minute=0)
    _scheduler.add_job(refresh_market_insights, "cron", hour=1, minute=0)
    _scheduler.add_job(extract_and_store_skill_demand, "cron", hour=0, minute=30)
    _scheduler.add_job(monthly_model_retrain, "cron", day=1, hour=2, minute=0)
    _scheduler.start()
    print("[Market] Scheduler started — market cache at 00:00, skill extraction at 00:30, model retrain on 1st of month")

    _ensure_skill_demand_tables()
    _seed_nirf_sync()
    _seed_placement_sources_sync()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


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


# ── NIRF-based deterministic scoring ─────────────────────────────────────────

def _get_college_override(college_name: str) -> dict | None:
    """Check college_overrides table for researched realistic stats."""
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT placement_rate, median_salary, highest_salary, college_tier, notes FROM college_overrides WHERE college_name = :n"),
                {"n": college_name},
            ).fetchone()
            if row:
                return {
                    "placement_rate": row[0], "median_salary": row[1],
                    "highest_salary": row[2], "college_tier": row[3], "notes": row[4],
                }
    except Exception:
        pass
    return None


def groq_skill_score(skills: list, target_role: str, college_tier: str) -> tuple[float, str]:
    """Ask Groq to rate the skill portfolio relevance for a specific role. Returns (score 0-25, one-sentence reasoning)."""
    if _groq is None or not skills:
        return round(min(8.0, len(skills) * 1.0), 1), ""
    skills_list = ", ".join(skills)
    prompt = (
        f"You are a brutally honest Indian placement advisor. The user is targeting {target_role} "
        f"at a {college_tier} college. Their skills are: {skills_list}.\n\n"
        "Rate the overall skill portfolio for THIS specific role on a scale of 0 to 25 "
        "(this will be added as a bonus % to their placement score). Consider:\n"
        "- How relevant each skill is to the role specifically\n"
        "- How rare/niche vs common the skills are\n"
        "- Whether the combination of skills makes a credible profile\n"
        "- Indian job market demand for these skills in 2025\n"
        "- Quantity vs quality tradeoff (10 weak skills < 3 strong relevant ones)\n\n"
        "Examples to calibrate your rating:\n"
        "- DSA + System Design + React for SWE role = 20-22\n"
        "- Python + ML + PyTorch for Data Science role = 18-20\n"
        "- RPA + UiPath + Automation for automation role = 15-17 (niche but relevant)\n"
        "- RPA for SWE role = 5-7 (not relevant)\n"
        "- C + C++ + Java (basic) for SWE = 8-10 (common, not impressive)\n"
        "- CUDA + OpenGL + Computer Vision for ML role = 22-24 (rare and valuable)\n"
        "- MS Office + Canva + Photoshop for SWE = 2-3 (irrelevant)\n\n"
        'Return ONLY a JSON object: {"score": <number 0-25>, "reasoning": "<one sentence why>"}'
    )
    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=120,
            temperature=0.3,
        )
        result = parse_groq_json(completion.choices[0].message.content or "")
        raw = float(result.get("score", 8))
        return round(max(0.0, min(25.0, raw)), 1), str(result.get("reasoning", ""))
    except Exception as exc:
        print(f"[groq_skill_score] Failed: {exc}")
        return round(min(8.0, len(skills) * 1.0), 1), ""


def nirf_adjusted_score(payload: ProfileIn, skill_bonus: float | None = None, skill_reasoning: str = "") -> tuple[int, str, dict | None]:
    """
    Compute placement probability with NIRF placement_rate as the base.
    Checks college_overrides first (researched data), then NIRF.
    skill_bonus (0-25) replaces the hardcoded skill count formula when provided.

    Returns (score: int, college_tier: str, nirf_stats: dict | None)
    """
    nirf_stats = get_college_stats(payload.college)

    # Check researched overrides first
    override = _get_college_override(payload.college)
    if override:
        base = float(override["placement_rate"])
        college_tier = override["college_tier"] or "Tier 2"
        source = f"researched-override ({payload.college})"
        # Merge override into nirf_stats shape so downstream code works
        if nirf_stats and nirf_stats.get("matched"):
            nirf_stats["placement_rate"] = base
            nirf_stats["median_salary"] = override.get("median_salary")
            nirf_stats["highest_salary"] = override.get("highest_salary")
            nirf_stats["college_tier"] = college_tier
        else:
            nirf_stats = {
                "matched": True, "college_name": payload.college,
                "college_tier": college_tier, "placement_rate": base,
                "median_salary": override.get("median_salary"),
                "highest_salary": override.get("highest_salary"),
                "nirf_rank": None,
            }
    elif nirf_stats and nirf_stats.get("matched") and nirf_stats.get("placement_rate") is not None:
        base = float(nirf_stats["placement_rate"])
        college_tier = nirf_stats.get("college_tier") or "Tier 3"
        source = f"NIRF 2024 ({nirf_stats['college_name']})"
    else:
        college_tier = get_college_tier(payload.college)
        base = {"Tier 1": 82.0, "Tier 2": 65.0, "Tier 3": 50.0, "Tier 4": 35.0}.get(college_tier, 55.0)
        source = f"tier-default ({college_tier})"
        nirf_stats = None

    # --- Adjustments (all in percentage points) ---

    # CGPA vs tier expectation
    tier_cgpa_avg = {"Tier 1": 8.0, "Tier 2": 7.5, "Tier 3": 6.5, "Tier 4": 6.0}.get(college_tier, 7.0)
    cgpa_adj = round(max(-15.0, min(10.0, (payload.cgpa - tier_cgpa_avg) * 3.0)), 1)

    # Skills: AI-rated portfolio bonus (0-25) or simple count fallback (0-8)
    skills_count = len(payload.skills) if payload.skills else 0
    skills_adj = round(min(25.0, skill_bonus), 1) if skill_bonus is not None else round(min(8.0, skills_count * 1.0), 1)

    # Projects (no projects is a big penalty)
    project_adj = {"0": -8.0, "1-2": 0.0, "3-5": 4.0, "5+": 7.0}.get(str(payload.projectsCount), 0.0)

    # Internship
    if payload.hasInternship == "yes":
        intern_adj = {"1-3": 3.0, "3-6": 5.0, "6+": 7.0}.get(str(payload.internshipMonths), 3.0)
    else:
        intern_adj = 0.0

    # LeetCode
    lc_adj = {"0": -5.0, "1-50": 0.0, "51-200": 3.0, "200+": 7.0}.get(str(payload.leetcodeCount), 0.0)

    # Academic year (penalise early years — placement is far away)
    year_adj = {"1st": -20.0, "2nd": -10.0, "3rd": 0.0, "4th": 0.0}.get(str(payload.year), 0.0)

    # Small bonuses
    os_adj   = 3.0 if payload.openSource  == "yes" else 0.0
    gh_adj   = 2.0 if payload.githubActive == "yes" else 0.0
    cert_adj = {"0": 0.0, "1-2": 1.0, "3+": 2.0}.get(str(payload.certifications), 0.0)
    hack_adj = {"0": 0.0, "1-2": 2.0, "3+": 4.0}.get(str(payload.hackathons), 0.0)

    total_adj = (cgpa_adj + skills_adj + project_adj + intern_adj +
                 lc_adj + year_adj + os_adj + gh_adj + cert_adj + hack_adj)
    raw = base + total_adj
    final = max(5, min(98, round(raw)))

    print(
        f"[NIRF Score] college={payload.college!r} source={source}\n"
        f"  base={base:.1f}%"
        f"  cgpa_adj={cgpa_adj:+.1f} (cgpa={payload.cgpa} vs avg={tier_cgpa_avg})"
        f"  skills_adj={skills_adj:+.1f} ({skills_count} skills)"
        f"  proj_adj={project_adj:+.1f} ({payload.projectsCount} projects)\n"
        f"  intern_adj={intern_adj:+.1f}  lc_adj={lc_adj:+.1f} ({payload.leetcodeCount} LC)"
        f"  year_adj={year_adj:+.1f} ({payload.year})"
        f"  os={os_adj:+.1f}  gh={gh_adj:+.1f}  cert={cert_adj:+.1f}  hack={hack_adj:+.1f}\n"
        f"  total_adj={total_adj:+.1f}  raw={raw:.1f}  FINAL={final}"
    )

    override_notes = ""
    if override:
        override_notes = override.get("notes") or ""

    score_breakdown = {
        "base_rate": round(base, 1),
        "college_name": payload.college,
        "cgpa_impact": cgpa_adj,
        "skills_impact": skills_adj,
        "skill_reasoning": skill_reasoning,
        "internship_impact": intern_adj,
        "leetcode_impact": lc_adj,
        "projects_impact": project_adj,
        "other_impact": round(os_adj + gh_adj + cert_adj + hack_adj + year_adj, 1),
        "total_adjustment": round(total_adj, 1),
        "final_score": final,
        "data_source": "Researched · Shiksha/Careers360/NIRF cross-referenced" if override else "NIRF 2024 official data",
        "override_notes": override_notes,
    }

    if nirf_stats:
        nirf_stats["score_breakdown"] = score_breakdown

    return final, college_tier, nirf_stats


def groq_score(payload: ProfileIn) -> tuple[int, str, str]:
    """
    Score is computed deterministically by nirf_adjusted_score().
    Groq rates the skill portfolio (0-25 bonus) and writes the explanation text.
    """
    college_tier_hint = get_college_tier(payload.college)
    skill_bonus, _skill_reasoning = groq_skill_score(payload.skills or [], payload.targetRole, college_tier_hint)
    score, college_tier, nirf_stats = nirf_adjusted_score(payload, skill_bonus=skill_bonus, skill_reasoning=_skill_reasoning)

    if _groq is None:
        return score, "", college_tier

    # --- Build context for the reasoning prompt ---
    nirf_line = ""
    if nirf_stats:
        nirf_line = (
            f"NIRF 2024: rank {nirf_stats.get('nirf_rank')}, "
            f"college-wide placement rate {nirf_stats.get('placement_rate')}%, "
            f"median salary {nirf_stats.get('median_salary')} LPA."
        )

    college_info = COLLEGE_DB.get(payload.college, {})
    college_line = ""
    if college_info:
        college_line = (
            f"Top campus recruiters: {', '.join(college_info.get('top_recruiters', []))}. "
            f"CGPA cutoff most companies enforce: {college_info.get('cgpa_cutoff_most_companies')}."
        )

    internship_str = (
        f"Yes ({payload.internshipMonths} months)" if payload.hasInternship == "yes" else "No"
    )

    prompt = (
        "You are a placement advisor. The placement probability score has already been calculated "
        f"as {score}/100 using NIRF 2024 data. DO NOT change this number.\n\n"
        "Student profile:\n"
        f"- College: {payload.college} ({college_tier})\n"
        f"- Branch: {payload.branch}, Year: {payload.year}\n"
        f"- CGPA: {payload.cgpa}/10\n"
        f"- Skills: {', '.join(payload.skills) if payload.skills else 'none listed'}\n"
        f"- Projects: {payload.projectsCount}\n"
        f"- Internship: {internship_str}\n"
        f"- LeetCode: {payload.leetcodeCount} problems\n"
        f"- Target Role: {payload.targetRole}\n"
        f"{nirf_line}\n"
        f"{college_line}\n\n"
        f"Write exactly 3 sentences explaining WHY this student scored {score}/100. "
        "Be specific: (1) what the college's actual placement rate means for this student, "
        "(2) what is their biggest weakness hurting the score, "
        "(3) one concrete action that would most improve it. "
        "Do NOT suggest the score should be higher or lower. "
        f'Return only: {{"score": {score}, "reasoning": "...", "college_tier": "{college_tier}"}}'
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        result = parse_groq_json(completion.choices[0].message.content or "")
        reasoning = str(result.get("reasoning", ""))
        # Always enforce our computed score — never trust Groq's number
        return score, reasoning, college_tier
    except Exception:
        return score, "", college_tier


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


@app.post("/api/placement/probability")
def placement_probability(payload: ProfileIn):
    """
    Returns placement probability score using XGBoost ML model.
    Uses Groq to score skill relevance (0-25 bonus) for the deterministic component.
    Always includes NIRF 2024 college stats when available.
    """
    # Fetch multi-source college data
    all_stats = get_all_college_stats(payload.college)
    nirf_stats = all_stats.get("nirf_data") or get_college_stats(payload.college)
    _base_rate = all_stats.get("combined_placement_rate")
    print(
        f"[/placement/probability] college={payload.college!r} | "
        f"combined_rate={_base_rate}% | tier={all_stats.get('college_tier')} | "
        f"sources={all_stats.get('sources_count')}"
    )

    # AI skill scoring — used by all deterministic calculations in this request
    college_tier_hint = get_college_tier(payload.college)
    skill_bonus, skill_reasoning = groq_skill_score(
        payload.skills or [], payload.targetRole, college_tier_hint
    )

    try:
        from ml.placement_model import predict_placement
        result = predict_placement(payload.model_dump())
        resp = {
            "score": result["score"],
            "reasoning": (
                f"Predicted by XGBoost model trained on NIRF placement data "
                f"(confidence: {result['confidence']}). College tier: {result['tier']}."
            ),
            "college_tier": result["tier"],
            "breakdown": result.get("breakdown", {}),
            "source": "ml",
            "skill_reasoning": skill_reasoning,
        }
    except FileNotFoundError:
        # Train-on-demand if model not yet built
        try:
            from ml.placement_model import train_model, predict_placement
            train_model()
            result = predict_placement(payload.model_dump())
            resp = {
                "score": result["score"],
                "reasoning": (
                    f"Predicted by XGBoost model trained on NIRF placement data "
                    f"(confidence: {result['confidence']}). College tier: {result['tier']}."
                ),
                "college_tier": result["tier"],
                "breakdown": result.get("breakdown", {}),
                "source": "ml",
                "skill_reasoning": skill_reasoning,
            }
        except Exception as exc2:
            print(f"[placement/probability] Auto-train failed: {exc2} — using deterministic fallback")
            score, college_tier, _ = nirf_adjusted_score(payload, skill_bonus=skill_bonus, skill_reasoning=skill_reasoning)
            resp = {
                "score": score,
                "reasoning": "Computed deterministically from NIRF placement data and profile attributes.",
                "college_tier": college_tier,
                "breakdown": {},
                "source": "deterministic",
                "skill_reasoning": skill_reasoning,
            }
    except Exception as exc:
        print(f"[placement/probability] ML error: {exc} — using deterministic fallback")
        score, college_tier, _ = nirf_adjusted_score(payload, skill_bonus=skill_bonus, skill_reasoning=skill_reasoning)
        resp = {
            "score": score,
            "reasoning": "Computed deterministically from NIRF placement data and profile attributes.",
            "college_tier": college_tier,
            "breakdown": {},
            "source": "deterministic",
            "skill_reasoning": skill_reasoning,
        }

    # Always compute deterministic score to get nirf_stats with score_breakdown
    _, _, nirf_stats_with_breakdown = nirf_adjusted_score(payload, skill_bonus=skill_bonus, skill_reasoning=skill_reasoning)

    # Include multi-source college data in every response
    if all_stats.get("matched") or (nirf_stats and nirf_stats.get("matched")):
        resp["nirf_rank"] = all_stats.get("nirf_rank")
        resp["nirf_placement_rate"] = nirf_stats.get("placement_rate") if nirf_stats else None
        resp["nirf_median_salary"] = nirf_stats.get("median_salary") if nirf_stats else None
        resp["nirf_highest_salary"] = nirf_stats.get("highest_salary") if nirf_stats else None
        resp["combined_placement_rate"] = all_stats.get("combined_placement_rate")
        resp["combined_median_salary"] = all_stats.get("combined_median_salary")
        resp["sources_count"] = all_stats.get("sources_count", 0)
        resp["all_sources"] = all_stats.get("all_sources", [])

    # Include nirf_stats as nested object (with score_breakdown) for frontend compatibility
    if nirf_stats_with_breakdown:
        resp["nirf_stats"] = nirf_stats_with_breakdown
    elif nirf_stats and nirf_stats.get("matched"):
        resp["nirf_stats"] = nirf_stats

    return resp


@app.get("/api/placement/score/{email}")
def get_placement_score_live(email: str, db: Session = Depends(get_db)):
    """
    Re-compute placement score from stored profile using live NIRF data.
    Also returns all available placement sources for the college.
    Use this on the dashboard to always show the current score, never the cached one.
    """
    profile = db.query(UserProfile).filter(UserProfile.email == email).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    payload = ProfileIn(
        email=profile.email,
        college=profile.college,
        branch=profile.branch,
        year=profile.year,
        cgpa=profile.cgpa,
        skills=profile.skills,
        targetRole=profile.target_role,
        projectsCount=profile.projects_count or "0",
        hasInternship=profile.has_internship or "no",
        internshipMonths=profile.internship_months or "",
        hackathons=profile.hackathons or "0",
        leetcodeCount=profile.leetcode_count or "0",
        openSource=profile.open_source or "no",
        certifications=profile.certifications or "0",
        githubActive=profile.github_active or "no",
    )

    score, college_tier, nirf_stats = nirf_adjusted_score(payload)

    sources = _get_placement_sources(profile.college)

    # Combined score: average of placement_rates across all available sources
    rates: list[float] = []
    if nirf_stats and nirf_stats.get("matched") and nirf_stats.get("placement_rate") is not None:
        rates.append(float(nirf_stats["placement_rate"]))
    for s in sources:
        if s.get("placement_rate") is not None:
            rates.append(float(s["placement_rate"]))
    combined_base = round(sum(rates) / len(rates), 1) if rates else float(score)

    model_last_retrained = None
    try:
        from database import get_connection, db_type
        con = get_connection()
        ph = "%s" if db_type == "supabase" else "?"
        cur = con.cursor()
        cur.execute(f"SELECT value FROM model_metadata WHERE key = {ph}", ("model_last_retrained",))
        row = cur.fetchone()
        con.close()
        if row and row[0]:
            model_last_retrained = row[0]
    except Exception:
        pass

    return {
        "score": score,
        "college_tier": college_tier,
        "nirf_stats": nirf_stats,
        "sources": sources,
        "combined_base": combined_base,
        "num_sources": len(rates),
        "model_last_retrained": model_last_retrained,
    }


@app.get("/api/placement/sources")
def get_placement_sources_for_college(college: str = ""):
    """Return all placement_sources records for a college (for multi-source display)."""
    if not college:
        raise HTTPException(status_code=400, detail="college query parameter required")
    nirf = get_college_stats(college)
    sources = _get_placement_sources(college)
    rates = []
    if nirf and nirf.get("matched") and nirf.get("placement_rate") is not None:
        rates.append(float(nirf["placement_rate"]))
    for s in sources:
        if s.get("placement_rate") is not None:
            rates.append(float(s["placement_rate"]))
    combined = round(sum(rates) / len(rates), 1) if rates else None
    return {
        "college": college,
        "nirf_stats": nirf,
        "sources": sources,
        "combined_placement_rate": combined,
        "num_sources": len(rates),
    }


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

        # Cache key: MD5 of resume text + target role (24h TTL)
        resume_cache_key = hashlib.md5(
            (resume_text + "|" + target_role).encode()
        ).hexdigest()

        cached_resume = _cache_get("resume_cache", resume_cache_key, ttl_hours=24)
        if cached_resume:
            _cache_stat("resume", hit=True)
            # Return cached as a streaming response for API consistency
            def _cached_gen():
                yield cached_resume
            return StreamingResponse(_cached_gen(), media_type="text/plain")
        _cache_stat("resume", hit=False)

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

        _resume_cache_key = resume_cache_key

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
                full = "".join(collected)
                print(f"[DEBUG] Groq stream done. First 200 chars: {full[:200]!r}")
                # Store in cache for next 24h
                try:
                    _cache_set("resume_cache", _resume_cache_key, full)
                except Exception:
                    pass
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
    from ml.skill_extractor import get_skill_gap_analysis

    # Fetch combined college data if college is provided; use authoritative tier
    college_info = None
    effective_tier = payload.college_tier or "Tier 3"
    if payload.college:
        all_stats = get_all_college_stats(payload.college)
        if all_stats.get("college_tier"):
            effective_tier = all_stats["college_tier"]
        college_info = {
            "college_name": all_stats["college_name"],
            "college_tier": all_stats["college_tier"],
            "sources_count": all_stats.get("sources_count", 0),
            "combined_placement_rate": all_stats.get("combined_placement_rate"),
            "combined_median_salary": all_stats.get("combined_median_salary"),
        }

    try:
        result = get_skill_gap_analysis(
            target_role=payload.target_role,
            user_skills=payload.skills or [],
            college_tier=effective_tier,
            cgpa=float(payload.cgpa or 6.0),
            branch=payload.branch or "",
        )
        if college_info:
            result["college_info"] = college_info

        # Attach last_updated timestamp from skill_demand table if available
        try:
            from database import get_connection, db_type
            con = get_connection()
            cur = con.cursor()
            ph = "%s" if db_type == "supabase" else "?"
            cur.execute(
                f"SELECT last_updated FROM skill_demand WHERE role = {ph} ORDER BY last_updated DESC LIMIT 1",
                (payload.target_role,),
            )
            row = cur.fetchone()
            if not row:
                cur.execute("SELECT last_updated FROM skill_demand ORDER BY last_updated DESC LIMIT 1")
                row = cur.fetchone()
            con.close()
            if row and row[0]:
                result["skill_demand_last_updated"] = row[0]
        except Exception:
            pass

        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/companies/match")
async def companies_match(payload: CompanyMatchIn):
    """
    Pure data company matching — zero Groq. Scores computed from skill overlap,
    college tier, CGPA, and placement history.
    """
    user_skills_lower = {s.lower() for s in (payload.skills or [])}
    cgpa = float(payload.cgpa or 0)
    college_tier = (payload.college_tier or "Tier 3").strip()
    has_internship = payload.has_internship == "yes"
    lc_count = str(payload.leetcode_count or "0")
    projects = str(payload.projects_count or "0")
    github_active = payload.github_active == "yes"

    lc_score = {"0": 0, "1-50": 1, "51-200": 2, "200+": 3}.get(lc_count, 0)
    proj_score = {"0": 0, "1-2": 1, "3-5": 2, "5+": 3}.get(projects, 0)

    # Company database with pure data
    COMPANY_DB = [
        # ── Tier 1+ Companies ─────────────────────────────────────────────────
        {"name": "Google", "type": "Product", "cgpa_cutoff": 7.5, "tiers": ["Tier 1"],
         "required_skills": ["DSA", "System Design", "Algorithms", "Data Structures"],
         "hiring_mode": "Off Campus", "role_offered": "Software Engineer (L3)",
         "package_range": "25-60 LPA",
         "why_match_template": "Google requires LeetCode hard-level DSA; your {skill_match}% skill overlap with their requirements is the starting point",
         "gap_template": "Google expects 200+ LeetCode problems and system design expertise — both are gaps that take months to close",
         "apply_link": "https://careers.google.com/"},
        {"name": "Microsoft", "type": "Product", "cgpa_cutoff": 7.5, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["DSA", "Algorithms", "Data Structures", "OOP", "System Design"],
         "hiring_mode": "Both", "role_offered": "SDE-1",
         "package_range": "20-45 LPA",
         "why_match_template": "Microsoft SDE-1 interviews test DSA and CS fundamentals; your {skill_match}% match with their required skills positions you for screening",
         "gap_template": "Microsoft expects strong OS and networking fundamentals beyond just DSA — expect questions on process management and concurrency",
         "apply_link": "https://careers.microsoft.com/"},
        {"name": "Amazon", "type": "Product", "cgpa_cutoff": 0, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["DSA", "Algorithms", "Data Structures", "OOP"],
         "hiring_mode": "Both", "role_offered": "SDE-1",
         "package_range": "18-40 LPA",
         "why_match_template": "Amazon SDE-1 tests DSA + Leadership Principles; your {skill_match}% skill match means you clear the technical bar if LeetCode is strong",
         "gap_template": "Amazon's Bar Raiser round tests Leadership Principles (ownership, customer obsession) — not preparing behavioural answers is the #1 reason candidates fail final rounds",
         "apply_link": "https://www.amazon.jobs/"},
        {"name": "Goldman Sachs", "type": "Product", "cgpa_cutoff": 7.0, "tiers": ["Tier 1"],
         "required_skills": ["Python", "SQL", "DSA", "Statistics"],
         "hiring_mode": "On Campus", "role_offered": "Analyst",
         "package_range": "18-35 LPA",
         "why_match_template": "Goldman Sachs analyst roles require Python + SQL + DSA; your {skill_match}% match is a strong foundation for their hackerrank round",
         "gap_template": "Goldman Sachs finance rounds test probability and statistics that most CS students skip — without this preparation, you will struggle in the quantitative round",
         "apply_link": "https://www.goldmansachs.com/careers/"},
        {"name": "Atlassian", "type": "Product", "cgpa_cutoff": 0, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["DSA", "System Design", "REST API", "Git"],
         "hiring_mode": "Off Campus", "role_offered": "Software Engineer",
         "package_range": "20-40 LPA",
         "why_match_template": "Atlassian's remote-friendly culture values solid DSA and system design; your {skill_match}% skill match with their stack gives you a genuine shot",
         "gap_template": "Atlassian uses a take-home coding challenge format — candidates without experience shipping real projects to GitHub often underperform in this format",
         "apply_link": "https://www.atlassian.com/company/careers"},
        # ── Product/Startup ────────────────────────────────────────────────────
        {"name": "Razorpay", "type": "Product", "cgpa_cutoff": 7.0, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["DSA", "Python", "Java", "System Design", "REST API"],
         "hiring_mode": "Off Campus", "role_offered": "SDE-1",
         "package_range": "15-25 LPA",
         "why_match_template": "Razorpay hires through HackerRank DSA rounds; your {skill_match}% match with their fintech tech stack (Python/Java + APIs) shows readiness",
         "gap_template": "Razorpay expects LeetCode medium-hard DSA fluency — if your LeetCode count is below 100, you will likely fail their online assessment",
         "apply_link": "https://razorpay.com/jobs/"},
        {"name": "PhonePe", "type": "Product", "cgpa_cutoff": 7.0, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["DSA", "Java", "Python", "SQL", "System Design"],
         "hiring_mode": "Off Campus", "role_offered": "SDE-1",
         "package_range": "15-30 LPA",
         "why_match_template": "PhonePe's fintech engineering requires strong DSA and backend skills; your {skill_match}% skill match covers their core requirements",
         "gap_template": "PhonePe specifically tests high-concurrency system design for payment systems — without system design prep your final round is at risk",
         "apply_link": "https://phonepe.com/en-in/careers.html"},
        {"name": "Swiggy", "type": "Product", "cgpa_cutoff": 0, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["DSA", "Python", "System Design", "Algorithms"],
         "hiring_mode": "Off Campus", "role_offered": "SDE-1",
         "package_range": "15-25 LPA",
         "why_match_template": "Swiggy's engineering team uses Python and requires strong DSA; your {skill_match}% overlap with their stack is a good foundation",
         "gap_template": "Swiggy's system design round focuses on real-time order management and geo-distributed systems — a gap if you haven't studied distributed systems fundamentals",
         "apply_link": "https://careers.swiggy.com/"},
        {"name": "Zepto", "type": "Startup", "cgpa_cutoff": 0, "tiers": ["Tier 1", "Tier 2", "Tier 3"],
         "required_skills": ["Python", "DSA", "React", "Node.js"],
         "hiring_mode": "Off Campus", "role_offered": "SDE-1",
         "package_range": "12-20 LPA",
         "why_match_template": "Zepto values skills and hustle over pedigree; your {skill_match}% skill match with their fast-paced engineering stack shows technical readiness",
         "gap_template": "Zepto moves extremely fast — candidates without side projects or open source contributions struggle to demonstrate the initiative they screen for",
         "apply_link": "https://www.zepto.team/careers"},
        {"name": "Groww", "type": "Product", "cgpa_cutoff": 0, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["DSA", "Python", "React", "SQL"],
         "hiring_mode": "Off Campus", "role_offered": "SDE-1",
         "package_range": "12-20 LPA",
         "why_match_template": "Groww's fintech stack (Python/React) matches your profile; your {skill_match}% overlap positions you for their online assessment round",
         "gap_template": "Groww interviews include a product thinking round — candidates purely from a coding background without any product/user empathy context fail this stage",
         "apply_link": "https://groww.in/careers"},
        {"name": "CRED", "type": "Startup", "cgpa_cutoff": 8.0, "tiers": ["Tier 1"],
         "required_skills": ["DSA", "System Design", "Python", "React"],
         "hiring_mode": "Off Campus", "role_offered": "SDE-1",
         "package_range": "20-35 LPA",
         "why_match_template": "CRED selects from the top 1% — your {skill_match}% skill match is the baseline; your portfolio and product thinking determine final selection",
         "gap_template": "CRED requires a strong public portfolio (GitHub, blog, or product contributions) — applications without visible work are screened out before any technical round",
         "apply_link": "https://cred.club/careers"},
        {"name": "Freshworks", "type": "Product", "cgpa_cutoff": 6.5, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["Python", "JavaScript", "React", "DSA", "REST API"],
         "hiring_mode": "Both", "role_offered": "Software Engineer",
         "package_range": "10-15 LPA",
         "why_match_template": "Freshworks recruits from Tier 2 colleges for product roles; your {skill_match}% skill match with their full-stack requirement is competitive",
         "gap_template": "Freshworks' final round tests product thinking alongside coding — candidates without any SaaS product usage or UX awareness frequently fail this round",
         "apply_link": "https://www.freshworks.com/company/careers/"},
        {"name": "Zoho", "type": "Product", "cgpa_cutoff": 0, "tiers": ["Tier 1", "Tier 2", "Tier 3"],
         "required_skills": ["C", "C++", "Java", "DSA", "Algorithms"],
         "hiring_mode": "Both", "role_offered": "Member Technical Staff",
         "package_range": "5-8 LPA",
         "why_match_template": "Zoho has no CGPA cutoff and runs its own multi-stage coding test; your {skill_match}% match with their low-level programming focus is what they evaluate",
         "gap_template": "Zoho's test is entirely in C — if you only know Python, you will fail their coding test as Python is not accepted in their assessment platform",
         "apply_link": "https://careers.zoho.com/"},
        # ── Service Companies ─────────────────────────────────────────────────
        {"name": "TCS", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
         "required_skills": ["Python", "Java", "SQL", "OOP"],
         "hiring_mode": "Both", "role_offered": "Systems Engineer",
         "package_range": "3.36-7 LPA",
         "why_match_template": "TCS NQT recruits from all tiers — your {skill_match}% overlap with their coding round requirements (Python/Java + basic logic) clears the technical bar",
         "gap_template": "TCS NQT has a dedicated numerical reasoning section that most students underestimate — without PrepInsta NQT mock tests you risk failing the aptitude section even with strong coding",
         "apply_link": "https://nextstep.tcs.com/"},
        {"name": "Infosys", "type": "Service", "cgpa_cutoff": 6.5, "tiers": ["Tier 1", "Tier 2", "Tier 3"],
         "required_skills": ["Python", "Java", "SQL", "OOP"],
         "hiring_mode": "Both", "role_offered": "Systems Engineer",
         "package_range": "3.6-6.25 LPA",
         "why_match_template": "Infosys InfyTQ tests coding and aptitude; your {skill_match}% skill match means you clear the technical filter if CGPA is above 6.5",
         "gap_template": "InfyTQ's logical reasoning and data interpretation sections are harder than the coding round — candidates who only prepare for coding fail this section",
         "apply_link": "https://career.infosys.com/"},
        {"name": "Wipro", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
         "required_skills": ["Python", "Java", "SQL"],
         "hiring_mode": "Both", "role_offered": "Project Engineer",
         "package_range": "3.5-6.5 LPA",
         "why_match_template": "Wipro WILP/Elite tracks test aptitude and basic coding; your {skill_match}% skill match comfortably clears their programming requirements",
         "gap_template": "Wipro's elite track requires clearing AMCAT — candidates without platform-specific practice (Wipro mock tests on PrepInsta) often fail despite having the skills",
         "apply_link": "https://careers.wipro.com/"},
        {"name": "Accenture", "type": "Service", "cgpa_cutoff": 6.5, "tiers": ["Tier 1", "Tier 2", "Tier 3"],
         "required_skills": ["Python", "Java", "SQL", "OOP"],
         "hiring_mode": "Both", "role_offered": "Associate Software Engineer",
         "package_range": "4.5-6.5 LPA",
         "why_match_template": "Accenture ASE role tests aptitude + communication; your {skill_match}% skill match handles the technical portion — communication round is the differentiator",
         "gap_template": "Accenture's communication and HR rounds are tougher than the technical round — candidates who over-focus on coding and neglect mock HR interviews fail at this stage",
         "apply_link": "https://www.accenture.com/in-en/careers"},
        {"name": "Cognizant", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3"],
         "required_skills": ["Python", "Java", "SQL"],
         "hiring_mode": "Both", "role_offered": "Programmer Analyst Trainee",
         "package_range": "4-7 LPA",
         "why_match_template": "Cognizant GenC track requires basic coding + aptitude; your {skill_match}% skill match is above their technical threshold for campus drives",
         "gap_template": "Cognizant Elevate track (7 LPA) requires advanced DSA — candidates applying for Elevate without 100+ LeetCode problems solved consistently fail the coding round",
         "apply_link": "https://careers.cognizant.com/"},
        {"name": "HCL Technologies", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
         "required_skills": ["Python", "Java", "SQL"],
         "hiring_mode": "Both", "role_offered": "Software Engineer Trainee",
         "package_range": "3.5-4.5 LPA",
         "why_match_template": "HCL has one of the highest fresher intakes in India; your {skill_match}% skill match easily clears their basic aptitude and coding requirements",
         "gap_template": "HCL's interview includes a technical interview beyond the written test — candidates who only prepare for online assessments get stuck in the technical discussion round",
         "apply_link": "https://www.hcltech.com/careers"},
        {"name": "Capgemini", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
         "required_skills": ["Python", "Java", "SQL", "OOP"],
         "hiring_mode": "Both", "role_offered": "Analyst",
         "package_range": "4-6 LPA",
         "why_match_template": "Capgemini uses AMCAT for assessment; your {skill_match}% skill match covers their programming requirements across their analyst track",
         "gap_template": "Capgemini's AMCAT includes a personality and situation judgement section that cannot be crammed — candidates unfamiliar with this format often score poorly",
         "apply_link": "https://www.capgemini.com/in-en/careers/"},
        {"name": "IBM", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3"],
         "required_skills": ["Python", "Java", "SQL", "Linux"],
         "hiring_mode": "Both", "role_offered": "Application Developer",
         "package_range": "4.5-7 LPA",
         "why_match_template": "IBM campus hiring tests aptitude + coding + HR; your {skill_match}% skill match clears the technical bar for their application developer role",
         "gap_template": "IBM's interview emphasises cloud and AI knowledge (IBM Cloud, Watson) — candidates without any cloud exposure struggle to answer the technical interview questions",
         "apply_link": "https://www.ibm.com/employment/"},
        {"name": "Deloitte", "type": "Service", "cgpa_cutoff": 6.5, "tiers": ["Tier 1", "Tier 2"],
         "required_skills": ["Python", "SQL", "Data Analysis"],
         "hiring_mode": "Both", "role_offered": "Analyst — Technology",
         "package_range": "6-9 LPA",
         "why_match_template": "Deloitte Analyst hires for tech consulting roles; your {skill_match}% skill match is suitable for their aptitude and case interview format",
         "gap_template": "Deloitte's case study round tests business + tech reasoning — candidates with pure engineering backgrounds without any business awareness fail the case portion",
         "apply_link": "https://jobs2.deloitte.com/in/en"},
        {"name": "Tech Mahindra", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
         "required_skills": ["Python", "Java", "SQL"],
         "hiring_mode": "Both", "role_offered": "Associate Software Engineer",
         "package_range": "3.5-5 LPA",
         "why_match_template": "Tech Mahindra hires broadly from all tiers; your {skill_match}% skill match is sufficient for their programming and aptitude assessment",
         "gap_template": "Tech Mahindra's interview rounds include a group discussion that candidates from technical backgrounds underestimate — poor communication in GD leads to rejections even with good scores",
         "apply_link": "https://careers.techmahindra.com/"},
        {"name": "Mphasis", "type": "Service", "cgpa_cutoff": 6.0, "tiers": ["Tier 1", "Tier 2", "Tier 3"],
         "required_skills": ["Python", "Java", "SQL"],
         "hiring_mode": "Both", "role_offered": "Software Engineer Trainee",
         "package_range": "3.5-5 LPA",
         "why_match_template": "Mphasis is a strong backup option with a straightforward aptitude + coding process; your {skill_match}% skill match clears their requirements",
         "gap_template": "Mphasis focuses on BFSI domain knowledge in the technical interview — candidates without any exposure to banking or financial systems concepts fail the domain round",
         "apply_link": "https://mphasis.com/careers.html"},
    ]

    # Colleges that historically place in specific companies (simplified)
    college_lower = (payload.college or "").lower()
    college_company_history: set[str] = set()
    if any(k in college_lower for k in ("iit", "nit", "bits", "iisc")):
        college_company_history = {"Google", "Microsoft", "Amazon", "Goldman Sachs", "Atlassian", "Razorpay", "PhonePe"}
    elif any(k in college_lower for k in ("vit", "srm", "manipal", "kiit", "thapar", "amrita", "pes")):
        college_company_history = {"TCS", "Infosys", "Wipro", "Cognizant", "Amazon", "Freshworks", "Zoho"}
    else:
        college_company_history = {"TCS", "Infosys", "Wipro", "HCL", "Capgemini", "Tech Mahindra"}

    tier_num = {"Tier 1": 1, "Tier 2": 2, "Tier 3": 3, "Tier 4": 4}.get(college_tier, 3)

    def _compute_score(company: dict) -> int:
        req = set(s.lower() for s in company["required_skills"])
        skill_overlap = len(user_skills_lower & req)
        skill_match_pct = round(skill_overlap / len(req) * 100) if req else 0

        # Base from skill overlap
        base = skill_match_pct

        # CGPA check
        cutoff = company["cgpa_cutoff"]
        if cutoff > 0 and cgpa < cutoff:
            base = min(base, 30)

        # Tier filter — companies that don't visit this tier
        allowed_tiers = set(company.get("tiers", []))
        if college_tier not in allowed_tiers:
            base = max(0, base - 25)

        # History boost
        if company["name"] in college_company_history:
            base = min(100, base + 10)

        # Internship boost for product companies
        if company["type"] in ("Product", "Startup") and has_internship:
            base = min(100, base + 5)

        # Certifications boost (small)
        cert_str = str(payload.certifications or "0")
        if cert_str in ("1-2", "3+"):
            base = min(100, base + 3)

        # LeetCode penalty for product companies
        if company["type"] in ("Product", "Startup") and lc_score == 0:
            base = max(0, base - 15)

        # Projects penalty for product companies
        if company["type"] in ("Product", "Startup") and proj_score == 0:
            base = max(0, base - 20)

        # Tier 2/3/4 caps for elite companies
        elite = {"Google", "Microsoft", "Amazon", "Goldman Sachs", "Atlassian", "CRED"}
        if company["name"] in elite and tier_num >= 2 and lc_score < 3 and cgpa < 8.5:
            base = min(base, 35)

        competitive = {"Razorpay", "PhonePe", "Swiggy", "Groww"}
        if company["name"] in competitive and tier_num >= 2 and skill_match_pct < 60:
            base = min(base, 50)

        return max(0, min(100, base))

    companies_out = []
    for company in COMPANY_DB:
        req = set(s.lower() for s in company["required_skills"])
        skill_overlap = len(user_skills_lower & req)
        skill_match_pct = round(skill_overlap / len(req) * 100) if req else 0

        score = _compute_score(company)

        allowed_tiers = set(company.get("tiers", []))
        likely_to_visit = college_tier in allowed_tiers and score >= 40

        # Build why_match and biggest_gap from data (not Groq)
        why = company["why_match_template"].format(skill_match=skill_match_pct)
        gap = company["gap_template"]

        visits_label = (
            "Tier 1 only" if allowed_tiers == {"Tier 1"}
            else "Tier 1 & 2" if allowed_tiers <= {"Tier 1", "Tier 2"}
            else "Tier 1 & 2 & 3" if allowed_tiers <= {"Tier 1", "Tier 2", "Tier 3"}
            else "All tiers"
        )

        companies_out.append({
            "name": company["name"],
            "type": company["type"],
            "match_score": score,
            "cgpa_cutoff": str(company["cgpa_cutoff"]) if company["cgpa_cutoff"] > 0 else "No cutoff",
            "visits_college_tier": visits_label,
            "likely_to_visit": likely_to_visit,
            "hiring_mode": company["hiring_mode"],
            "role_offered": company["role_offered"],
            "package_range": company["package_range"],
            "why_match": why,
            "biggest_gap": gap,
            "apply_link": company["apply_link"],
        })

    companies_out.sort(key=lambda x: -x["match_score"])

    # Build summary from data
    top3 = [c["name"] for c in companies_out[:3]]
    strong = [c for c in companies_out if c["match_score"] >= 70]
    possible = [c for c in companies_out if 50 <= c["match_score"] < 70]
    summary = (
        f"Your strongest matches are {', '.join(top3[:2])} and {top3[2] if len(top3) > 2 else 'similar companies'}. "
        f"You have {len(strong)} strong matches (70+ score) and {len(possible)} possible targets (50–70 score). "
        f"Focus applications on your top matches while building DSA skills to unlock higher-tier opportunities."
    )

    return {"companies": companies_out[:15], "summary": summary}


@app.post("/api/roadmap/generate")
async def generate_roadmap(body: RoadmapIn):
    # Build cache key from profile factors
    cache_key = hashlib.md5(
        "|".join([
            body.college or "",
            body.branch or "",
            str(body.cgpa or ""),
            ",".join(sorted(body.skills or [])),
            body.target_role or "",
        ]).encode()
    ).hexdigest()

    cached = _cache_get("roadmap_cache", cache_key, ttl_hours=7 * 24)
    if cached:
        _cache_stat("roadmap", hit=True)
        return json.loads(cached)
    _cache_stat("roadmap", hit=False)

    skills_str = ", ".join(body.skills) if body.skills else "none listed"
    companies_str = ", ".join(body.target_companies) if body.target_companies else "not specified"
    missing_str = ", ".join(body.must_have_missing) if body.must_have_missing else "none identified"
    internship_str = (
        f"yes ({body.internship_months} months)" if body.has_internship == "yes" else "no"
    )

    all_stats = get_all_college_stats(body.college)
    nirf_stats = all_stats.get("nirf_data")
    nirf_context = ""
    if all_stats.get("matched"):
        combined_median = all_stats.get("combined_median_salary")
        combined_rate = all_stats.get("combined_placement_rate")
        sources_n = all_stats.get("sources_count", 0)
        highest = nirf_stats.get("highest_salary") if nirf_stats else None
        nirf_context = (
            f"- Combined Median Salary at {all_stats['college_name']} ({sources_n} source{'s' if sources_n != 1 else ''}): {combined_median} LPA\n"
            f"- Highest Salary (NIRF 2024): {highest} LPA\n"
            f"- Combined Placement Rate ({sources_n} sources): {combined_rate}%\n"
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
        f"- Critical Skill Gaps (must learn): {missing_str}\n"
        f"{nirf_context}\n"
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
        "- Use the NIRF 2024 median salary to set a REALISTIC salary target in the overview. "
        "Don't over-promise; the overview must mention the college's actual median so expectations are calibrated.\n"
        "- Calibrate advice to college tier: Tier 1 → competitive + DSA heavy; Tier 2 → domain + DSA; Tier 3/4 → core skills + one project first.\n"
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
        result = parse_groq_json(raw)
        _cache_set("roadmap_cache", cache_key, json.dumps(result))
        return result
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
async def market_intelligence(college: str = "", city: str = ""):
    cached = _load_market_cache()
    base = cached
    if not base:
        try:
            base = await refresh_market_cache()
        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))

    # Enrich with multi-source college context if college is provided
    if college:
        all_stats = get_all_college_stats(college)
        tier = all_stats.get("college_tier") or get_college_tier(college)
        combined_salary = all_stats.get("combined_median_salary")
        combined_rate = all_stats.get("combined_placement_rate")
        sources_n = all_stats.get("sources_count", 0)

        def _salary_benchmark(default_lpa: int) -> str:
            if combined_salary and sources_n:
                return f"{combined_salary} LPA median ({sources_n} source{'s' if sources_n != 1 else ''}, 2024)"
            return f"{default_lpa} LPA median (estimate)"

        # Build tier-specific hiring demand context
        if tier == "Tier 1":
            tier_demand = {
                "college_tier": tier,
                "top_roles_in_demand": ["Software Engineer", "Data Scientist", "SDE-2", "Research Engineer"],
                "companies_hiring_this_tier": ["Google", "Microsoft", "Amazon", "Goldman Sachs", "Atlassian", "Qualcomm"],
                "salary_benchmark": _salary_benchmark(20),
                "combined_placement_rate": combined_rate,
                "sources_count": sources_n,
            }
        elif tier == "Tier 2":
            tier_demand = {
                "college_tier": tier,
                "top_roles_in_demand": ["Software Engineer", "Full Stack Developer", "Data Analyst", "DevOps Engineer"],
                "companies_hiring_this_tier": ["TCS", "Infosys", "Wipro", "Cognizant", "Accenture", "Amazon", "Zoho"],
                "salary_benchmark": _salary_benchmark(7),
                "combined_placement_rate": combined_rate,
                "sources_count": sources_n,
            }
        else:
            tier_demand = {
                "college_tier": tier,
                "top_roles_in_demand": ["Software Engineer", "Web Developer", "QA Engineer", "Support Engineer"],
                "companies_hiring_this_tier": ["TCS", "Infosys", "Wipro", "HCL", "Tech Mahindra", "Mphasis", "Hexaware"],
                "salary_benchmark": _salary_benchmark(5),
                "combined_placement_rate": combined_rate,
                "sources_count": sources_n,
            }

        if city:
            tier_demand["hiring_near_city"] = city
            tier_demand["city_note"] = f"In {city}, demand is highest for software and IT roles. Check naukri.com and LinkedIn for local openings."

        base = dict(base)
        base["college_intelligence"] = tier_demand

    return base


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


# ── Market News Scraper ────────────────────────────────────────────────────────

INSIGHTS_CACHE_PATH = Path(__file__).parent / "market_insights_cache.json"
INSIGHTS_TTL_HOURS = 24

MARKET_NEWS_SOURCES = [
    {"name": "Economic Times Jobs", "url": "https://economictimes.indiatimes.com/jobs", "base_url": "https://economictimes.indiatimes.com"},
    {"name": "TimesJobs", "url": "https://www.timesjobs.com/", "base_url": "https://www.timesjobs.com"},
    {"name": "YourStory Hiring", "url": "https://yourstory.com/topic/hiring", "base_url": "https://yourstory.com"},
    {"name": "Naukri Blog", "url": "https://www.naukriblog.com/", "base_url": "https://www.naukriblog.com"},
    {"name": "LinkedIn Talent Blog", "url": "https://www.linkedin.com/business/talent/blog", "base_url": "https://www.linkedin.com"},
]


async def _scrape_articles(source: dict) -> list[dict]:
    articles = []
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }) as client:
            resp = await client.get(source["url"])
            if resp.status_code != 200:
                return articles
            soup = BeautifulSoup(resp.text, "html.parser")
            seen: set[str] = set()
            for selector in ["h2 a", "h3 a", "article h2", "article h3", ".article-title", ".headline", "h1 a"]:
                for tag in soup.select(selector)[:15]:
                    title = tag.get_text(strip=True)
                    href = tag.get("href", "") if tag.name == "a" else ""
                    if not href and tag.name != "a":
                        link = tag.find("a")
                        if link:
                            href = link.get("href", "")
                    if len(title) > 20 and title not in seen:
                        seen.add(title)
                        if href and not href.startswith("http"):
                            href = source["base_url"] + href
                        articles.append({
                            "title": title,
                            "summary": "",
                            "source_name": source["name"],
                            "source_url": href or source["url"],
                            "published_date": "",
                            "scraped_at": datetime.now(timezone.utc).isoformat(),
                        })
                if len(articles) >= 5:
                    break
    except Exception as e:
        print(f"[Market Insights] Failed to scrape {source['name']}: {e}")
    return articles[:5]


_INSIGHT_SKILLS = [
    "Python", "Java", "JavaScript", "React", "Node.js", "SQL", "AWS", "Docker",
    "Kubernetes", "Machine Learning", "Deep Learning", "TypeScript", "Go", "Rust",
    "MongoDB", "PostgreSQL", "Redis", "FastAPI", "Django", "Spring Boot", "Flutter",
    "Android", "iOS", "Swift", "Kotlin", "C++", "Git", "Linux", "Azure", "GCP",
    "Terraform", "Jenkins", "GraphQL", "REST API", "Microservices", "System Design",
    "Data Structures", "Algorithms", "DSA", "AI", "ML", "Generative AI", "LLM",
]

_INSIGHT_ROLES = [
    "Software Engineer", "Data Scientist", "Data Analyst", "Frontend Developer",
    "Backend Developer", "Full Stack Developer", "DevOps Engineer", "ML Engineer",
    "Product Manager", "Android Developer", "iOS Developer", "SDE", "SWE",
]

_INSIGHT_COMPANIES = [
    "TCS", "Infosys", "Wipro", "Accenture", "Cognizant", "HCL", "Capgemini",
    "Google", "Microsoft", "Amazon", "Meta", "Apple", "Flipkart", "Zoho",
    "Freshworks", "Razorpay", "PhonePe", "Swiggy", "Zomato", "Ola", "Zepto",
    "Groww", "CRED", "IBM", "Deloitte", "KPMG", "EY", "PwC", "SAP",
    "Oracle", "Salesforce", "Adobe", "Atlassian", "Intuit", "Walmart",
]

_INSIGHT_CITIES = [
    "Bangalore", "Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai",
    "Delhi", "Noida", "Gurgaon", "Kolkata", "Ahmedabad", "Jaipur", "Kochi",
]

_CITY_REASON = {
    "Bangalore": "Tech capital of India with 40% of all engineering jobs; highest average salaries",
    "Bengaluru": "Tech capital of India with 40% of all engineering jobs; highest average salaries",
    "Hyderabad": "Second-largest tech hub; booming with Google, Microsoft, and pharma-tech growth",
    "Pune": "Growing IT and automotive tech hub; significantly lower cost of living than Bangalore",
    "Chennai": "Strong in IT services and auto-tech; many Fortune 500 India development centres",
    "Mumbai": "FinTech and BFSI capital; highest cost of living but premium salaries for finance roles",
    "Delhi": "Government tech and consulting hub; FAANG has large NCR offices",
    "Noida": "Affordable alternative to Delhi with many IT parks and startup offices",
    "Gurgaon": "Fintech and startup hub adjacent to Delhi; Zomato, PolicyBazaar HQ here",
    "Kochi": "Emerging tech hub; lower cost of living with growing startup ecosystem",
}


def _extract_insights_data(articles: list[dict]) -> dict:
    """Pure data extraction from article titles — no Groq."""
    skill_hits: dict[str, list] = {}
    role_hits: dict[str, int] = {}
    company_hits: dict[str, str] = {}
    city_hits: dict[str, int] = {}

    for article in articles:
        title_lower = article.get("title", "").lower()
        source_url = article.get("source_url", "")
        title_text = article.get("title", "")

        for skill in _INSIGHT_SKILLS:
            if skill.lower() in title_lower:
                if skill not in skill_hits:
                    skill_hits[skill] = []
                skill_hits[skill].append({"title": title_text, "url": source_url})

        for role in _INSIGHT_ROLES:
            if role.lower() in title_lower:
                role_hits[role] = role_hits.get(role, 0) + 1

        for company in _INSIGHT_COMPANIES:
            if company.lower() in title_lower and company not in company_hits:
                context_words = ["hiring", "recruit", "expan", "job", "opening", "campus"]
                ctx = "actively hiring" if any(w in title_lower for w in context_words) else "mentioned in news"
                company_hits[company] = ctx

        for city in _INSIGHT_CITIES:
            if city.lower() in title_lower:
                city_hits[city] = city_hits.get(city, 0) + 1

    trending_skills = sorted(
        [
            {
                "skill": skill,
                "article_count": len(hits),
                "sample_article_title": hits[0]["title"] if hits else "",
                "sample_article_url": hits[0]["url"] if hits else "",
            }
            for skill, hits in skill_hits.items()
        ],
        key=lambda x: -x["article_count"],
    )[:10]

    hot_roles = sorted(
        [{"role": role, "article_count": count} for role, count in role_hits.items()],
        key=lambda x: -x["article_count"],
    )[:8]

    hiring_companies = [
        {"company": company, "context": context}
        for company, context in list(company_hits.items())[:10]
    ]

    trending_cities = [
        {"city": city, "reason": _CITY_REASON.get(city, f"Mentioned {count} times in recent hiring news")}
        for city, count in sorted(city_hits.items(), key=lambda x: -x[1])[:5]
    ]

    # Fallback with static data if nothing was scraped
    if not trending_skills:
        trending_skills = [
            {"skill": s, "article_count": 0, "sample_article_title": "", "sample_article_url": ""}
            for s in ["Python", "JavaScript", "Java", "React", "SQL", "AWS", "Docker", "Machine Learning", "TypeScript", "Node.js"]
        ]
    if not hot_roles:
        hot_roles = [{"role": r, "article_count": 0} for r in ["Software Engineer", "Data Scientist", "DevOps Engineer", "Full Stack Developer"]]
    if not hiring_companies:
        hiring_companies = [
            {"company": c, "context": "major fresher recruiter in India"}
            for c in ["TCS", "Infosys", "Wipro", "Accenture", "Cognizant", "Amazon", "Microsoft", "Google", "Freshworks", "Zoho"]
        ]
    if not trending_cities:
        trending_cities = [
            {"city": c, "reason": _CITY_REASON.get(c, "Major tech hub")}
            for c in ["Bangalore", "Hyderabad", "Pune", "Chennai", "Mumbai"]
        ]

    return {
        "trending_skills": trending_skills,
        "hot_roles": hot_roles,
        "hiring_companies": hiring_companies,
        "trending_cities": trending_cities,
        "is_ai_estimate": False,
    }


def _static_fallback_insights() -> dict:
    """Static fallback when no articles available — clearly labelled as estimate."""
    return {
        "trending_skills": [
            {"skill": s, "article_count": 0, "sample_article_title": "", "sample_article_url": ""}
            for s in ["Python", "JavaScript", "Java", "React", "SQL", "AWS", "Docker", "Machine Learning", "TypeScript", "Node.js"]
        ],
        "hot_roles": [{"role": r, "article_count": 0} for r in [
            "Software Engineer", "Data Scientist", "DevOps Engineer", "Full Stack Developer",
            "ML Engineer", "Backend Developer", "Frontend Developer", "Data Analyst"
        ]],
        "hiring_companies": [
            {"company": c, "context": "major fresher recruiter in India"}
            for c in ["TCS", "Infosys", "Wipro", "Accenture", "Cognizant", "Amazon", "Microsoft", "Google", "Freshworks", "Zoho"]
        ],
        "trending_cities": [
            {"city": c, "reason": _CITY_REASON.get(c, "Major tech hub")}
            for c in ["Bangalore", "Hyderabad", "Pune", "Chennai", "Mumbai"]
        ],
        "is_ai_estimate": True,
    }


def _load_insights_cache() -> dict | None:
    if not INSIGHTS_CACHE_PATH.exists():
        return None
    try:
        data = json.loads(INSIGHTS_CACHE_PATH.read_text())
        ts_str = data.get("scraped_at", "2000-01-01")
        ts = datetime.fromisoformat(ts_str)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - ts > timedelta(hours=INSIGHTS_TTL_HOURS):
            return None
        return data
    except Exception:
        return None


async def refresh_market_insights() -> dict:
    print("[Market Insights] Starting scrape job...")
    all_articles: list[dict] = []
    for source in MARKET_NEWS_SOURCES:
        articles = await _scrape_articles(source)
        all_articles.extend(articles)
        print(f"[Market Insights] {source['name']}: {len(articles)} articles")

    scrape_success = len(all_articles) > 0
    insights = _extract_insights_data(all_articles) if scrape_success else _static_fallback_insights()

    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM market_insights"))
            for article in all_articles:
                conn.execute(text("""
                    INSERT INTO market_insights (title, summary, source_name, source_url, scraped_at)
                    VALUES (:title, :summary, :source_name, :source_url, :scraped_at)
                """), article)
    except Exception as e:
        print(f"[Market Insights] DB store failed: {e}")

    payload = {
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "articles": all_articles,
        "insights": insights,
        "scrape_success": scrape_success,
    }
    INSIGHTS_CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False))
    print(f"[Market Insights] Done. {len(all_articles)} articles, scrape_success={scrape_success}")
    return payload


@app.get("/api/market/news")
async def market_news():
    cached = _load_insights_cache()
    if cached:
        return cached
    try:
        return await refresh_market_insights()
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/market/news/refresh")
async def market_news_refresh():
    INSIGHTS_CACHE_PATH.unlink(missing_ok=True)
    try:
        return await refresh_market_insights()
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
    all_stats = get_all_college_stats(payload.college)
    nirf_stats = all_stats.get("nirf_data")

    # Build multi-source context and determine company lists
    nirf_context = ""
    placement_rate = all_stats.get("combined_placement_rate")
    effective_tier = all_stats.get("college_tier") or payload.college_tier

    if all_stats.get("matched"):
        sources_n = all_stats.get("sources_count", 0)
        nirf_context = (
            f"\nMULTI-SOURCE VERIFIED DATA for {payload.college} ({sources_n} source{'s' if sources_n != 1 else ''}):\n"
            f"- NIRF Rank: {all_stats.get('nirf_rank')}\n"
            f"- Combined placement rate: {placement_rate}%\n"
            f"- Combined median salary: {all_stats.get('combined_median_salary')} LPA\n"
            f"- Highest salary (NIRF 2024): {nirf_stats.get('highest_salary') if nirf_stats else 'N/A'} LPA\n"
            f"- College Tier: {effective_tier}\n\n"
            f"Use this combined placement_rate ({placement_rate}%) to calibrate probability scores. "
            f"A college with 90% placement rate should show probabilities 15-25 points higher "
            f"than one with 50% for the same tier.\n"
        )

    # Tier-specific company lists per spec
    if "Tier 1" in effective_tier:
        tier_company_rule = "Tier 1 (IITs/NITs/BITS): Include Google, Microsoft, Amazon, Goldman Sachs, Atlassian, Qualcomm, Uber, LinkedIn."
    elif "Tier 2" in effective_tier:
        tier_company_rule = "Tier 2 (VIT/SRM/Manipal/Amrita/KIIT etc): TCS, Infosys, Wipro, Cognizant, Accenture, Amazon, Microsoft, Capgemini, HCL, Zoho, Freshworks."
    else:
        tier_company_rule = "Tier 3 and 4: TCS, Infosys, Wipro, HCL, Tech Mahindra, Mphasis, Hexaware, Capgemini."

    # Scrape real recruiter data for this college
    scraped_context = ""
    scrape_used = False
    try:
        from scrapers.college_recruiters_scraper import get_college_recruiters
        recruiter_items = get_college_recruiters(payload.college)
        if recruiter_items:
            company_names = [item["company"] for item in recruiter_items]
            sources_used = list({item["source"] for item in recruiter_items})
            scraped_context = (
                f"\nSCRAPED RECRUITER DATA — These companies have ACTUALLY visited {payload.college} "
                f"for placements based on data from {', '.join(sources_used)}:\n"
                f"{', '.join(company_names)}\n\n"
                f"Using this as your base, predict which are likely to visit this season for a "
                f"{payload.branch} student with {payload.cgpa} CGPA. "
                f"Also suggest 3-5 new companies hiring from this tier in 2025-26 that are NOT in this list. "
                f"Be branch-specific: Mechanical/EE/Civil students should NOT get pure software companies "
                f"unless the company has a specific hardware/manufacturing/core role.\n"
            )
            scrape_used = True
            print(f"[DEBUG] Scraped {len(company_names)} recruiters for {payload.college}")
    except Exception as _scrape_err:
        print(f"[DEBUG] Recruiter scrape failed: {_scrape_err}")

    if not scrape_used:
        scraped_context = (
            "\nNOTE: Live recruiter scrape returned no data. "
            "Use tier-based prediction with known campus visit patterns.\n"
        )

    prompt = (
        "You are a placement prediction expert with deep knowledge of Indian campus recruitment in 2026. "
        "Based on this student's college profile, predict which companies are likely to visit their campus "
        "for placements in the 2026 placement season (Aug-Dec 2026).\n\n"
        f"Student Profile:\n"
        f"- College: {payload.college}\n"
        f"- College Tier: {effective_tier}\n"
        f"- Branch: {payload.branch}\n"
        f"- Target Role: {payload.target_role}\n"
        f"- Skills: {skills_str}\n"
        f"- CGPA: {payload.cgpa}/10\n"
        f"{nirf_context}"
        f"{scraped_context}"
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
        f"- {tier_company_rule}\n"
        "- Prioritise companies from the SCRAPED RECRUITER DATA above all else.\n"
        "- Return exactly 8-10 companies relevant to their tier and branch.\n"
        "- probability reflects actual historical campus visit frequency for that college tier, weighted by the NIRF placement_rate if provided.\n"
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


@app.get("/api/oncampus/history")
async def oncampus_history(college: str = ""):
    """Return multi-source placement history (NIRF + Shiksha + Careers360) for the college."""
    if not college:
        raise HTTPException(status_code=400, detail="college query parameter is required")
    all_stats = get_all_college_stats(college)
    if not all_stats.get("matched"):
        return {
            "found": False,
            "college": college,
            "message": "No placement data found for this college. Data shown is based on tier estimates.",
            "college_tier": all_stats.get("college_tier"),
        }
    nirf = all_stats.get("nirf_data") or {}
    return {
        "found": True,
        "college_name": all_stats["college_name"],
        "nirf_rank": all_stats.get("nirf_rank"),
        "college_tier": all_stats["college_tier"],
        "placement_rate": nirf.get("placement_rate"),
        "median_salary": nirf.get("median_salary"),
        "mean_salary": nirf.get("mean_salary"),
        "highest_salary": nirf.get("highest_salary"),
        "graduating_students_count": nirf.get("graduating_students_count"),
        "combined_placement_rate": all_stats.get("combined_placement_rate"),
        "combined_median_salary": all_stats.get("combined_median_salary"),
        "sources_count": all_stats.get("sources_count"),
        "all_sources": all_stats.get("all_sources", []),
        "shiksha_data": all_stats.get("shiksha_data"),
        "careers360_data": all_stats.get("careers360_data"),
        "data_source": "NIRF 2024 + Shiksha + Careers360",
        "note": "Data combined from NIRF 2024, Shiksha, and Careers360 (2024)",
    }


# Category ordering for sorting
_CATEGORY_ORDER = {
    "Marquee": 0, "Super Dream": 1, "Dream": 2,
    "Day 1/Day 2": 3, "Core": 4, "Non-Engineering": 5, "Internship": 6,
}


@app.get("/api/oncampus/history/{college_name}")
async def oncampus_placement_history(college_name: str, year: str = ""):
    """Return real campus placement drive records grouped by year and category."""
    try:
        with engine.connect() as conn:
            q = "SELECT academic_year FROM campus_placements WHERE college_name = :c GROUP BY academic_year ORDER BY academic_year DESC"
            years_rows = conn.execute(text(q), {"c": college_name}).fetchall()
            available_years = [r[0] for r in years_rows]
            if not available_years:
                return {"found": False, "college_name": college_name, "years": [], "data": {}}

            target_year = year if year in available_years else available_years[0]

            rows = conn.execute(text("""
                SELECT company_name, visit_date, role, category, ctc, ctc_min, ctc_max,
                       eligibility_percent, students_applied, students_selected, source
                FROM campus_placements
                WHERE college_name = :c AND academic_year = :y
                ORDER BY category, visit_date
            """), {"c": college_name, "y": target_year}).fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    companies_by_cat: dict[str, list] = {}
    all_ctc_values: list[float] = []
    total_selected = 0

    for row in rows:
        company_name, visit_date, role, category, ctc, ctc_min, ctc_max, \
            eligibility_percent, students_applied, students_selected, source = row

        applied = students_applied or 0
        selected = students_selected or 0
        rate = round((selected / applied) * 100, 1) if applied > 0 else 0.0
        total_selected += selected
        if ctc and ctc > 0:
            all_ctc_values.append(ctc)

        cat = category or "Other"
        companies_by_cat.setdefault(cat, []).append({
            "name": company_name,
            "visit_date": visit_date,
            "role": role,
            "category": cat,
            "ctc_min": ctc_min,
            "ctc_max": ctc_max,
            "ctc": ctc,
            "eligibility_percent": eligibility_percent,
            "students_applied": applied,
            "students_selected": selected,
            "selection_rate": rate,
            "source": source,
        })

    all_ctc_values.sort()
    highest_ctc = max(all_ctc_values) if all_ctc_values else None
    median_ctc = all_ctc_values[len(all_ctc_values) // 2] if all_ctc_values else None

    # Sort categories in display order
    sorted_cats = sorted(companies_by_cat.keys(), key=lambda c: _CATEGORY_ORDER.get(c, 99))
    ordered_data = {cat: companies_by_cat[cat] for cat in sorted_cats}

    year_summary = {
        "academic_year": target_year,
        "total_companies": sum(len(v) for v in companies_by_cat.values()),
        "total_selected": total_selected,
        "highest_ctc": highest_ctc,
        "median_ctc": round(median_ctc, 2) if median_ctc else None,
        "marquee_count": len(companies_by_cat.get("Marquee", [])),
        "super_dream_count": len(companies_by_cat.get("Super Dream", [])),
        "dream_count": len(companies_by_cat.get("Dream", [])),
    }

    return {
        "found": True,
        "college_name": college_name,
        "available_years": available_years,
        "current_year": target_year,
        "year_summary": year_summary,
        "companies_by_category": ordered_data,
        "data_note": "Data sourced from SRM KTR placement cell records · Academic year 2025-26",
    }


# ── Off Campus Jobs ───────────────────────────────────────────────────────────

# Tier 1 companies — sorted first regardless of match score
_TIER1_COMPANIES = {
    # FAANG+
    "google", "amazon", "microsoft", "meta", "apple", "netflix", "uber", "airbnb",
    "stripe", "atlassian", "salesforce", "adobe", "oracle", "sap", "intel",
    "qualcomm", "nvidia",
    # Top Indian product
    "flipkart", "swiggy", "zomato", "phonepe", "razorpay", "cred", "meesho",
    "zepto", "ola", "paytm", "groww", "zerodha", "dream11", "freshworks",
    "zoho", "postman",
    # Top IT services
    "tcs", "infosys", "wipro", "hcl", "tech mahindra", "cognizant",
    "capgemini", "accenture", "ibm", "deloitte",
}


def _is_tier1(company_name: str) -> bool:
    return company_name.lower().strip() in _TIER1_COMPANIES


class OffCampusJobsIn(BaseModel):
    target_role: str
    skills: list[str] = []
    location: str = ""
    remote_only: bool = False
    page: int = 1


def _parse_offcampus_days_ago(created_str: str) -> tuple[int | None, str | None]:
    if not created_str:
        return None, None
    try:
        dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
        days = (datetime.now(timezone.utc) - dt).days
        if days <= 7:
            status = "Actively Hiring"
        elif days <= 30:
            status = "Recently Posted"
        else:
            status = "May Be Closed"
        return days, status
    except Exception:
        return None, None


@app.post("/api/offcampus/jobs")
async def offcampus_jobs(payload: OffCampusJobsIn):
    cache_key = hashlib.md5(
        f"{payload.target_role}|{payload.location}|{payload.remote_only}|{payload.page}".encode()
    ).hexdigest()
    cached = _cache_get("offcampus_cache", cache_key, ttl_hours=6)
    if cached:
        try:
            cached_data = json.loads(cached)
            user_skills_lower = [s.lower() for s in payload.skills]
            total_skills = max(len(user_skills_lower), 1)
            for job in cached_data.get("jobs", []):
                desc = ((job.get("description") or "") + " " + (job.get("title") or "")).lower()
                matched = sum(1 for s in user_skills_lower if s in desc)
                job["match_score"] = min(100, int((matched / total_skills) * 100)) if user_skills_lower else 50
            cached_data["jobs"].sort(key=lambda x: (0 if _is_tier1(x.get("company", "")) else 1, -(x.get("days_ago") or 999), -x["match_score"]))
            return cached_data
        except Exception:
            pass

    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")

    where = "remote" if payload.remote_only else (payload.location.strip() or "india")
    user_skills_lower = [s.lower() for s in payload.skills]
    total_skills = max(len(user_skills_lower), 1)
    jobs: list[dict] = []

    # Source 1: Adzuna
    if app_id and app_key:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"https://api.adzuna.com/v1/api/jobs/in/search/{max(1, payload.page)}",
                    params={
                        "app_id": app_id, "app_key": app_key,
                        "results_per_page": 20, "what": payload.target_role,
                        "where": where, "content-type": "application/json",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                for job in data.get("results", []):
                    salary_min = job.get("salary_min")
                    salary_max = job.get("salary_max")
                    salary_str = ""
                    if salary_min and salary_max and salary_min > 0:
                        salary_str = f"₹{round(salary_min/100000,1)}-{round(salary_max/100000,1)} LPA"
                    elif salary_min and salary_min > 0:
                        salary_str = f"₹{round(salary_min/100000,1)}+ LPA"
                    created_raw = job.get("created", "")
                    days_ago_val, hiring_status_val = _parse_offcampus_days_ago(created_raw)
                    jobs.append({
                        "id": f"adzuna-{job.get('id','')}",
                        "title": job.get("title", ""),
                        "company": job.get("company", {}).get("display_name", "Unknown"),
                        "location": job.get("location", {}).get("display_name", "India"),
                        "description": (job.get("description", "") or "")[:350],
                        "salary": salary_str, "apply_link": job.get("redirect_url", ""),
                        "created": created_raw, "days_ago": days_ago_val,
                        "hiring_status": hiring_status_val, "source": "Adzuna",
                        "match_score": 50,
                    })
        except Exception as e:
            print(f"[OffCampus] Adzuna error: {e}")

    # Source 2: Arbeitnow
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://www.arbeitnow.com/api/job-board-api",
                params={"search": f"{payload.target_role} india"},
            )
            if resp.status_code == 200:
                arb_data = resp.json()
                for job in (arb_data.get("data") or [])[:25]:
                    created_raw = job.get("created_at", "")
                    days_ago_val, hiring_status_val = _parse_offcampus_days_ago(created_raw)
                    tags = job.get("tags") or []
                    jobs.append({
                        "id": f"arb-{job.get('slug','')}",
                        "title": job.get("title", ""),
                        "company": job.get("company_name", "Unknown"),
                        "location": job.get("location", "Remote") or "Remote",
                        "description": (job.get("description", "") or "")[:350],
                        "salary": "", "apply_link": job.get("url", ""),
                        "created": created_raw, "days_ago": days_ago_val,
                        "hiring_status": hiring_status_val, "source": "Arbeitnow",
                        "match_score": 50,
                        "tags": tags,
                    })
    except Exception as e:
        print(f"[OffCampus] Arbeitnow error: {e}")

    # Source 3: Remotive (remote jobs)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://remotive.com/api/remote-jobs",
                params={"category": "software-dev", "limit": 50},
            )
            if resp.status_code == 200:
                rem_data = resp.json()
                for job in (rem_data.get("jobs") or [])[:20]:
                    created_raw = job.get("publication_date", "")
                    days_ago_val, hiring_status_val = _parse_offcampus_days_ago(created_raw)
                    salary_str = job.get("salary") or ""
                    jobs.append({
                        "id": f"rem-{job.get('id','')}",
                        "title": job.get("title", ""),
                        "company": job.get("company_name", "Unknown"),
                        "location": "Remote",
                        "description": (job.get("description", "") or "")[:350],
                        "salary": salary_str[:60] if salary_str else "",
                        "apply_link": job.get("url", ""),
                        "created": created_raw, "days_ago": days_ago_val,
                        "hiring_status": hiring_status_val, "source": "Remotive",
                        "match_score": 50,
                    })
    except Exception as e:
        print(f"[OffCampus] Remotive error: {e}")

    if not jobs:
        raise HTTPException(status_code=503, detail="No job sources available. Configure ADZUNA_APP_ID and ADZUNA_APP_KEY in .env")

    # Deduplicate by title+company
    seen = set()
    deduped = []
    for job in jobs:
        key = (job["title"].lower().strip()[:40], job["company"].lower().strip())
        if key not in seen:
            seen.add(key)
            deduped.append(job)
    jobs = deduped

    # Compute match scores
    for job in jobs:
        desc = ((job.get("description") or "") + " " + (job.get("title") or "")).lower()
        matched = sum(1 for s in user_skills_lower if s in desc)
        job["match_score"] = min(100, int((matched / total_skills) * 100)) if user_skills_lower else 50

    # Sort: tier 1 companies first → newest → match score
    jobs.sort(key=lambda x: (
        0 if _is_tier1(x.get("company", "")) else 1,
        -(x.get("days_ago") or 999),
        -x["match_score"],
    ))

    result = {"jobs": jobs, "total": len(jobs), "page": payload.page}
    _cache_set("offcampus_cache", cache_key, json.dumps(result))
    return result


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

    # Cache key: skills + target company + target role
    cache_key = hashlib.md5(
        "|".join([
            ",".join(sorted(payload.skills or [])),
            (payload.company or "").lower().strip(),
            (payload.role or "").lower().strip(),
        ]).encode()
    ).hexdigest()

    cached = _cache_get("cold_email_cache", cache_key, ttl_hours=3 * 24)
    if cached:
        _cache_stat("coldemail", hit=True)
        return json.loads(cached)
    _cache_stat("coldemail", hit=False)

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
        raw = re.sub(r"^```(?:text|markdown|email)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        result = {"email": raw.strip()}
        _cache_set("cold_email_cache", cache_key, json.dumps(result))
        return result
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


@app.get("/admin/cache-stats")
def cache_stats():
    """Return AI cache hit/miss stats showing how many Groq calls are being saved."""
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT endpoint, cache_hits, cache_misses, groq_calls_saved, last_reset FROM ai_cache_stats"
            )).fetchall()
            stats = [
                {
                    "endpoint": r[0],
                    "cache_hits": r[1],
                    "cache_misses": r[2],
                    "groq_calls_saved": r[3],
                    "hit_rate_pct": round(r[1] / (r[1] + r[2]) * 100, 1) if (r[1] + r[2]) > 0 else 0,
                    "last_reset": r[4],
                }
                for r in rows
            ]
        total_saved = sum(s["groq_calls_saved"] for s in stats)
        return {"stats": stats, "total_groq_calls_saved": total_saved}
    except Exception as e:
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
_ARBEITNOW_TECH_TAGS = {
    "python", "javascript", "typescript", "java", "data", "software", "engineering",
    "developer", "ml", "ai", "frontend", "backend", "fullstack", "react", "node",
    "cloud", "devops", "sql",
}

_NON_CS_TITLE_KEYWORDS = {
    "accounting", "accountant", "tax", "taxation", "finance", "financial", "legal",
    "marketing", "sales", "hr", "human resources", "mechanical", "chemical",
    "civil", "electrical", "manufacturing", "procurement", "logistics",
    "supply chain", "operations", "content writer", "graphic design", "social media",
    "business development", "customer support", "customer service", "receptionist",
    "teaching", "tutoring", "fashion", "retail", "hospitality",
}
_CS_TITLE_KEYWORDS = {
    "software", "developer", "engineer", "data", "ml", "ai", "machine learning",
    "frontend", "backend", "fullstack", "full stack", "devops", "cloud", "python",
    "javascript", "java", "react", "android", "ios", "mobile", "web", "cybersecurity",
    "blockchain", "product", "ui", "ux", "qa", "testing", "automation", "intern",
    "tech", "computer", "it ", "coding", "programming", "algorithm", "database",
    "api", "system", "network", "security", "embedded", "firmware", "game",
    "typescript", "golang", "rust", "kotlin", "flutter", "node", "angular", "vue",
    "docker", "kubernetes", "aws", "azure", "gcp", "nlp", "llm", "deep learning",
}


def _is_non_english(text: str) -> bool:
    """Return True if text contains significant non-ASCII characters (likely non-English)."""
    if not text:
        return False
    non_ascii = sum(1 for c in text if ord(c) > 127)
    return non_ascii / max(len(text), 1) > 0.08


def _get_translation_cache(text_hash: str) -> dict | None:
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT translated_title, translated_description FROM translation_cache WHERE original_text_hash = :h"),
                {"h": text_hash},
            ).fetchone()
            if row:
                return {"title": row[0], "description": row[1]}
    except Exception:
        pass
    return None


def _set_translation_cache(text_hash: str, title: str, description: str):
    try:
        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO translation_cache (original_text_hash, translated_title, translated_description, translated_at)
                    VALUES (:h, :t, :d, :ts)
                    ON CONFLICT(original_text_hash) DO NOTHING
                """),
                {"h": text_hash, "t": title, "d": description, "ts": datetime.now(timezone.utc).isoformat()},
            )
    except Exception as e:
        print(f"[TranslationCache] set error: {e}")


def _translate_listing_sync(title: str, description: str) -> tuple[str, str]:
    """Translate title and description to English via Groq. Returns (title, description)."""
    if _groq is None:
        return title, description
    try:
        prompt = (
            f"Translate this job listing title and description to English. "
            f"Return only a JSON with keys 'title' and 'description', no markdown: "
            f"TITLE: {title} DESCRIPTION: {description}"
        )
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=500,
        )
        raw = (completion.choices[0].message.content or "").strip()
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`")
        parsed = json.loads(raw)
        return str(parsed.get("title", title)), str(parsed.get("description", description))
    except Exception as e:
        print(f"[Translation] Failed: {e}")
        return title, description


def _is_cs_role(title: str, tags: list) -> bool:
    """Return True if the listing is a CS/tech role worth showing."""
    title_lower = title.lower()
    # Reject clearly non-CS roles
    for kw in _NON_CS_TITLE_KEYWORDS:
        if kw in title_lower:
            return False
    # Must match at least one CS keyword in title or tags
    tags_str = " ".join(tags).lower()
    combined = title_lower + " " + tags_str
    return any(kw in combined for kw in _CS_TITLE_KEYWORDS)


async def _translate_and_filter(jobs: list[dict]) -> list[dict]:
    """Translate non-English listings and filter to CS-only roles."""
    import hashlib
    filtered = []
    for job in jobs:
        title = job.get("title", "")
        description = job.get("description", "") or ""
        tags = job.get("tags", [])

        # Translate if non-English
        if _is_non_english(title) or _is_non_english(description):
            text_hash = hashlib.md5((title + description).encode("utf-8", errors="ignore")).hexdigest()
            cached = _get_translation_cache(text_hash)
            if cached:
                title = cached["title"]
                description = cached["description"]
            else:
                title, description = await _asyncio.to_thread(_translate_listing_sync, title, description)
                _set_translation_cache(text_hash, title, description)
            job = {**job, "title": title, "description": description}

        # CS-only filter
        if _is_cs_role(title, tags):
            filtered.append(job)

    return filtered


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


def _hiring_status(days_ago: int | None) -> str:
    if days_ago is None:
        return "Active"
    if days_ago <= 7:
        return "Actively Hiring"
    if days_ago <= 30:
        return "Recently Posted"
    return "May Be Closed"


async def _fetch_adzuna_internships() -> list[dict]:
    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        return []
    results: list[dict] = []
    seen_ids: set = set()
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(
                "https://api.adzuna.com/v1/api/jobs/in/search/1",
                params={
                    "app_id": app_id,
                    "app_key": app_key,
                    "results_per_page": 50,
                    "what": "intern",
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
                    salary_str = f"₹{round(salary_min/100000,1)}–{round(salary_max/100000,1)} LPA"
                elif salary_min and salary_min > 0:
                    salary_str = f"₹{round(salary_min/100000,1)}+ LPA"
                created_raw = job.get("created", "")
                days_ago: int | None = None
                if created_raw:
                    try:
                        days_ago = (datetime.now(timezone.utc) - datetime.fromisoformat(created_raw.replace("Z", "+00:00"))).days
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
                    "days_ago": days_ago,
                    "hiring_status": _hiring_status(days_ago),
                    "source": "Adzuna",
                    "tags": [],
                })
        except Exception as exc:
            print(f"[Adzuna] Internships fetch failed: {exc}")
    return results


async def _fetch_remotive_internships() -> list[dict]:
    categories = ["software-dev", "data", "devops"]
    results: list[dict] = []
    seen_ids: set = set()
    async with httpx.AsyncClient(timeout=15) as client:
        for cat in categories:
            try:
                resp = await client.get(
                    "https://remotive.com/api/remote-jobs",
                    params={"category": cat, "limit": 50},
                )
                resp.raise_for_status()
                for job in resp.json().get("jobs", []):
                    title = job.get("title", "")
                    tags = [t.lower() for t in (job.get("tags") or [])]
                    if "intern" not in title.lower() and not any("intern" in t for t in tags):
                        continue
                    jid = str(job.get("id", ""))
                    if jid and jid in seen_ids:
                        continue
                    if jid:
                        seen_ids.add(jid)
                    pub_date = job.get("publication_date", "")
                    days_ago: int | None = None
                    if pub_date:
                        try:
                            days_ago = (datetime.now(timezone.utc) - datetime.fromisoformat(pub_date.replace("Z", "+00:00"))).days
                        except Exception:
                            pass
                    results.append({
                        "id": f"rm_{jid or abs(hash(title))}",
                        "title": title,
                        "company": job.get("company_name", "Unknown"),
                        "location": job.get("candidate_required_location", "Remote") or "Remote",
                        "description": (job.get("description", "") or "")[:350],
                        "salary": job.get("salary", "") or "",
                        "redirect_url": job.get("url", ""),
                        "created": pub_date,
                        "days_ago": days_ago,
                        "hiring_status": _hiring_status(days_ago),
                        "source": "Remotive",
                        "tags": tags,
                    })
            except Exception as exc:
                print(f"[Remotive] Failed for category '{cat}': {exc}")
    return results


async def _fetch_arbeitnow_internships() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://www.arbeitnow.com/api/job-board-api",
                params={"search": "intern"},
            )
            resp.raise_for_status()
            results: list[dict] = []
            for job in resp.json().get("data", []):
                tags = [t.lower() for t in (job.get("tags") or [])]
                if not any(t in _ARBEITNOW_TECH_TAGS for t in tags):
                    continue
                title = job.get("title", "")
                company = job.get("company_name", job.get("company", "Unknown"))
                created_ts = job.get("created_at")
                days_ago: int | None = None
                if created_ts:
                    try:
                        days_ago = (datetime.now(timezone.utc) - datetime.fromtimestamp(int(created_ts), tz=timezone.utc)).days
                    except Exception:
                        pass
                created_raw = str(created_ts) if created_ts else ""
                results.append({
                    "id": f"an_{abs(hash(title + company))}",
                    "title": title,
                    "company": company,
                    "location": job.get("location", "Remote"),
                    "description": (job.get("description", "") or "")[:350],
                    "salary": "",
                    "redirect_url": job.get("url", ""),
                    "created": created_raw,
                    "days_ago": days_ago,
                    "hiring_status": _hiring_status(days_ago),
                    "source": "Arbeitnow",
                    "tags": tags,
                })
            return results
    except Exception as e:
        print(f"[Arbeitnow] Failed: {e}")
        return []


def _generate_ai_internships() -> list[dict]:
    if _groq is None:
        return []
    try:
        import re
        prompt = (
            "Generate 15 realistic current Indian tech internship listings in JSON format. "
            "Each listing must have: title, company (real Indian tech company), location (Indian city), "
            "stipend (5000-25000/month), duration, url (company careers page), days_ago (0-30). "
            "Return only a valid JSON array, no markdown, no explanation."
        )
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=2500,
        )
        raw = completion.choices[0].message.content or ""
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`")
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if not match:
            return []
        listings = json.loads(match.group())
        results: list[dict] = []
        for i, item in enumerate(listings[:15]):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "Software Engineering Intern"))
            company = str(item.get("company", "Indian Startup"))
            days = item.get("days_ago")
            days_int = int(days) if isinstance(days, (int, float)) else 7
            results.append({
                "id": f"ai_{abs(hash(title + company + str(i)))}",
                "title": title,
                "company": company,
                "location": str(item.get("location", "India")),
                "description": f"Duration: {item.get('duration', '3 months')}",
                "salary": str(item.get("stipend", "₹10,000/month")),
                "redirect_url": str(item.get("url", "https://internshala.com")),
                "created": "",
                "days_ago": days_int,
                "hiring_status": _hiring_status(days_int),
                "source": "AI Generated",
                "tags": [],
            })
        print(f"[AI Fallback] Generated {len(results)} listings")
        return results
    except Exception as e:
        print(f"[AI Fallback] Failed: {e}")
        return []


@app.get("/api/internships/list")
async def internships_list(skills: str = ""):
    cached = _load_internships_cache()
    raw_jobs: list = []
    by_source: dict = {}

    if cached:
        raw_jobs = cached.get("jobs", cached.get("internships", []))
        by_source = cached.get("by_source", cached.get("source_counts", {}))
    else:
        adzuna, remotive, arbeitnow = await _asyncio.gather(
            _fetch_adzuna_internships(),
            _fetch_remotive_internships(),
            _fetch_arbeitnow_internships(),
        )

        all_live = adzuna + remotive + arbeitnow

        # Translate non-English listings and filter to CS-only roles
        all_live = await _translate_and_filter(all_live)

        ai_generated: list[dict] = []
        if len(all_live) < 10:
            ai_generated = await _asyncio.to_thread(_generate_ai_internships)

        seen_keys: set = set()
        for job in all_live + ai_generated:
            key = (job.get("title", "").lower().strip(), job.get("company", "").lower().strip())
            if key not in seen_keys:
                seen_keys.add(key)
                raw_jobs.append(job)

        by_source = {
            "Adzuna": len(adzuna),
            "Remotive": len(remotive),
            "Arbeitnow": len(arbeitnow),
        }
        if ai_generated:
            by_source["AI Generated"] = len(ai_generated)

        cache_payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "jobs": raw_jobs,
            "by_source": by_source,
        }
        INTERNSHIPS_CACHE_PATH.write_text(json.dumps(cache_payload, indent=2), encoding="utf-8")
        print(f"[Internships] Cached {len(raw_jobs)} jobs — {by_source}")

    user_skills_lower = [s.strip().lower() for s in skills.split(",") if s.strip()] if skills else []
    total_skills = max(len(user_skills_lower), 1)

    result = []
    for job in raw_jobs:
        if user_skills_lower:
            text = (job.get("description", "") + " " + job.get("title", "") + " " + job.get("company", "")).lower()
            matched = sum(1 for s in user_skills_lower if s in text)
            match_score = min(100, int((matched / total_skills) * 100))
        else:
            match_score = 50
        result.append({**job, "match_score": match_score})

    result.sort(key=lambda x: x["match_score"], reverse=True)
    return {"jobs": result, "total": len(result), "by_source": by_source}


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


# ── Startups ──────────────────────────────────────────────────────────────────

STARTUPS_CACHE_PATH = Path(__file__).parent / "startups_cache.json"
STARTUPS_CACHE_TTL_DAYS = 7


class StartupsFindIn(BaseModel):
    skills: list[str] = []
    branch: str = ""
    target_role: str = ""
    college_tier: str = "Tier 2"


def _load_startups_cache() -> dict | None:
    if not STARTUPS_CACHE_PATH.exists():
        return None
    try:
        payload = json.loads(STARTUPS_CACHE_PATH.read_text(encoding="utf-8"))
        ts = datetime.fromisoformat(payload["timestamp"])
        if datetime.now(timezone.utc) - ts < timedelta(days=STARTUPS_CACHE_TTL_DAYS):
            return payload
        print("[Startups] Cache expired, will refresh")
    except Exception:
        pass
    return None


async def _fetch_adzuna_startup_listings() -> list[dict]:
    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        return []
    results: list[dict] = []
    seen_ids: set = set()
    async with httpx.AsyncClient(timeout=15) as client:
        for term in ["startup intern india", "startup software intern", "startup technology intern"]:
            try:
                resp = await client.get(
                    "https://api.adzuna.com/v1/api/jobs/in/search/1",
                    params={
                        "app_id": app_id,
                        "app_key": app_key,
                        "results_per_page": 30,
                        "what": term,
                        "content-type": "application/json",
                    },
                )
                if resp.status_code != 200:
                    continue
                data = resp.json()
                for job in data.get("results", []):
                    jid = job.get("id", "")
                    if jid and jid in seen_ids:
                        continue
                    seen_ids.add(jid)
                    posted = job.get("created", "")
                    days_ago = None
                    hiring_status = None
                    if posted:
                        try:
                            dt = datetime.fromisoformat(posted.replace("Z", "+00:00"))
                            days_ago = (datetime.now(timezone.utc) - dt).days
                            hiring_status = (
                                "Actively Hiring" if days_ago <= 7
                                else "Recently Posted" if days_ago <= 30
                                else "May Be Closed"
                            )
                        except Exception:
                            pass
                    results.append({
                        "id": jid or f"az_{abs(hash(job.get('title', '') + job.get('company', {}).get('display_name', '')))}",
                        "title": job.get("title", ""),
                        "company": job.get("company", {}).get("display_name", ""),
                        "location": job.get("location", {}).get("display_name", "India"),
                        "description": job.get("description", "")[:300],
                        "salary": (
                            f"₹{job['salary_min']:,.0f}–{job.get('salary_max', job['salary_min']):,.0f}/year"
                            if job.get("salary_min") else ""
                        ),
                        "redirect_url": job.get("redirect_url", ""),
                        "created": posted,
                        "days_ago": days_ago,
                        "hiring_status": hiring_status,
                        "source": "Adzuna",
                    })
            except Exception:
                continue
    return results


@app.post("/api/startups/find")
async def startups_find(payload: StartupsFindIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    skills_str = ", ".join(payload.skills) if payload.skills else "Not specified"
    prompt = (
        "You are an expert on the Indian startup ecosystem in 2026. Given this student profile, "
        "suggest 20 Indian startups to target for internships. Focus on early-stage startups where "
        "freshers have the highest chance of getting hired.\n\n"
        "Student profile:\n"
        f"- Skills: {skills_str}\n"
        f"- Branch: {payload.branch}\n"
        f"- Target role: {payload.target_role}\n"
        f"- College tier: {payload.college_tier}\n\n"
        "Return JSON:\n"
        "{\n"
        '  "startups": [\n'
        '    {\n'
        '      "name": "startup name",\n'
        '      "industry": "Fintech/Edtech/SaaS/Healthtech/Ecommerce/Gaming/Other",\n'
        '      "stage": "Seed/Pre-Series A/Series A",\n'
        '      "why_good_fit": "one sentence specific to this student",\n'
        '      "linkedin_url": "https://www.linkedin.com/company/startup-slug",\n'
        '      "careers_url": "actual URL or null",\n'
        '      "city": "city name",\n'
        '      "hiring_likelihood": "High/Medium/Low",\n'
        '      "how_to_apply": "specific actionable advice"\n'
        '    }\n'
        '  ],\n'
        '  "pro_tip": "one specific actionable tip for Indian startup internships in 2026"\n'
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
        print(f"[DEBUG] Groq startups find: {raw[:500]!r}")
        return parse_groq_json(raw)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/startups/list")
async def startups_list(page: int = 1, search: str = "", industry: str = "", city: str = ""):
    cached = _load_startups_cache()
    raw: list = []

    if cached:
        raw = cached.get("startups", [])
    else:
        adzuna_r = await _fetch_adzuna_startup_listings()
        combined = adzuna_r
        seen: set = set()
        for job in combined:
            key = (job.get("company", "").lower().strip(), job.get("title", "").lower().strip())
            if key not in seen:
                seen.add(key)
                raw.append(job)

        STARTUPS_CACHE_PATH.write_text(
            json.dumps(
                {"timestamp": datetime.now(timezone.utc).isoformat(), "startups": raw},
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"[Startups] Cached {len(raw)} listings")

    filtered = raw
    if search:
        sl = search.lower()
        filtered = [j for j in filtered if sl in j.get("title", "").lower() or sl in j.get("company", "").lower()]
    if industry:
        il = industry.lower()
        filtered = [j for j in filtered if il in j.get("title", "").lower() or il in j.get("description", "").lower()]
    if city:
        cl = city.lower()
        filtered = [j for j in filtered if cl in j.get("location", "").lower()]

    total = len(filtered)
    per_page = 30
    start_idx = (page - 1) * per_page
    return {
        "startups": filtered[start_idx: start_idx + per_page],
        "total_count": total,
        "page": page,
        "per_page": per_page,
    }


# ── PYQ Sourced Data Endpoint ────────────────────────────────────────────────

# Per-company static metadata: key topics + exam pattern
_PYQ_COMPANY_META: dict[str, dict] = {
    "TCS": {
        "aptitude": {"topics": ["Number Series", "Blood Relations", "Syllogism", "Time & Work", "Percentages", "Profit & Loss", "Seating Arrangement"], "pattern": "TCS NQT: 26 Cognitive + 10 Programming MCQ + 1-2 Coding problems · 90 min · No negative marking"},
        "coding": {"topics": ["Loops & Patterns", "Arrays", "Strings", "Basic Math"], "pattern": "2 coding problems in C/C++/Java/Python · 30 min"},
        "technical": {"topics": ["OOPs Concepts", "DBMS Basics (Normalization, Joins)", "C/C++ Basics", "OS Basics"], "pattern": "Technical HR round · 30-45 min"},
        "hr": {"topics": ["Why TCS?", "Where do you see yourself in 5 years?", "Strengths and weaknesses"], "pattern": "HR round · 15-20 min"},
        "key_topics": ["Number Series", "OOPs", "DBMS", "Logical Reasoning", "Coding Basics"],
        "source": "PrepInsta · TCS NQT 2024",
    },
    "Infosys": {
        "aptitude": {"topics": ["Logical Reasoning", "Verbal Ability", "Mathematical Ability", "Puzzle Solving"], "pattern": "InfyTQ: Online assessment · 3 sections · 95 min"},
        "coding": {"topics": ["Python/Java Basics", "Pseudocode", "Sorting Algorithms", "Recursion"], "pattern": "2 coding problems · 30 min"},
        "technical": {"topics": ["DBMS", "OOP Concepts", "Basic Networking", "Data Structures"], "pattern": "Technical interview · 30-45 min"},
        "hr": {"topics": ["Why Infosys?", "Team collaboration", "Adaptability"], "pattern": "HR round"},
        "key_topics": ["Logical Reasoning", "Verbal Ability", "DBMS", "OOPs", "Python Basics"],
        "source": "PrepInsta · Infosys InfyTQ 2024",
    },
    "Wipro": {
        "aptitude": {"topics": ["Quantitative Aptitude", "Verbal Ability", "Logical Reasoning", "Essay Writing"], "pattern": "NLTH: 3 sections + Essay · 75 min"},
        "coding": {"topics": ["Array Manipulation", "String Reversal", "Fibonacci", "Sorting"], "pattern": "2 problems · Easy/Medium · 30 min"},
        "technical": {"topics": ["C Basics", "OOPs", "DBMS", "Operating Systems"], "pattern": "Technical interview · 30 min"},
        "hr": {"topics": ["Why Wipro?", "Relocation willingness", "Career goals"], "pattern": "HR round"},
        "key_topics": ["Quantitative Aptitude", "Logical Reasoning", "Arrays", "OOPs", "C Basics"],
        "source": "PrepInsta · Wipro NLTH 2024",
    },
    "Cognizant": {
        "aptitude": {"topics": ["Quantitative Reasoning", "Logical Reasoning", "Verbal Reasoning"], "pattern": "GenC/GenC Next: 55 questions · 60 min"},
        "coding": {"topics": ["GenC: Basic Problems", "GenC Next: DSA Medium (Arrays, Linked Lists)", "Sorting"], "pattern": "1-2 problems · GenC Next is harder"},
        "technical": {"topics": ["OOPs", "SDLC", "Agile Basics", "DBMS"], "pattern": "Technical interview"},
        "hr": {"topics": ["Why Cognizant?", "Teamwork scenarios", "Situational questions"], "pattern": "HR round"},
        "key_topics": ["Quantitative Reasoning", "OOPs", "Agile/SDLC", "Arrays", "Logical Reasoning"],
        "source": "PrepInsta · Cognizant GenC 2024",
    },
    "Accenture": {
        "aptitude": {"topics": ["Cognitive Assessment", "Abstract Reasoning", "Attention to Detail", "Basic Math"], "pattern": "3 sections: Cognitive + Coding + Communication · 90 min"},
        "coding": {"topics": ["Loop Patterns", "Array Sum", "String Operations", "Very Basic Problems"], "pattern": "2 easy coding problems"},
        "technical": {"topics": ["OOPs Basics", "DBMS Basics", "Networking Basics"], "pattern": "Technical interview · 20-30 min"},
        "hr": {"topics": ["Why Accenture?", "Diversity & inclusion", "Work-life balance"], "pattern": "HR round"},
        "key_topics": ["Abstract Reasoning", "Basic Coding", "OOPs", "Communication Skills", "Cognitive Ability"],
        "source": "PrepInsta · Accenture 2024",
    },
    "Amazon": {
        "aptitude": {"topics": [], "pattern": "Amazon focuses on coding and system design — no separate aptitude round"},
        "coding": {"topics": ["Arrays & Hashing", "Two Pointers", "Sliding Window", "Trees & Graphs", "Dynamic Programming", "Linked Lists", "Heap / Priority Queue"], "pattern": "2 coding rounds on Amazon Chime/OA · LeetCode Medium-Hard · 70 min each"},
        "technical": {"topics": ["System Design (for SDE-2+)", "OOPs", "OS Concepts", "Database Design"], "pattern": "Bar Raiser technical round · 60 min"},
        "hr": {"topics": ["Leadership Principle 1: Customer Obsession", "LP 2: Ownership", "LP 3: Invent and Simplify", "LP 4: Are Right A Lot", "LP 5: Learn and Be Curious", "LP 6: Hire and Develop the Best", "LP 7: Insist on Highest Standards", "LP 8: Think Big", "LP 9: Bias for Action", "LP 10: Frugality", "LP 11: Earn Trust", "LP 12: Dive Deep", "LP 13: Have Backbone", "LP 14: Deliver Results"], "pattern": "Every round has 1-2 LP questions (STAR format) · Must prep all 14 LPs"},
        "key_topics": ["Arrays", "Dynamic Programming", "Trees", "Graphs", "Leadership Principles", "System Design"],
        "source": "LeetCode Amazon Tag + GFG Amazon Interview Experience 2024",
    },
    "Microsoft": {
        "aptitude": {"topics": [], "pattern": "No separate aptitude round"},
        "coding": {"topics": ["Arrays", "Linked Lists", "Trees", "Graphs", "Dynamic Programming", "String Manipulation", "Recursion"], "pattern": "3-4 coding rounds · LeetCode Medium · 45-60 min each"},
        "technical": {"topics": ["OOPs (Design Patterns)", "OS (Threading, Memory)", "DBMS", "System Design (for senior roles)"], "pattern": "Technical interview · 60 min"},
        "hr": {"topics": ["Why Microsoft?", "Growth mindset examples", "Collaboration stories", "Handling failure"], "pattern": "Culture fit round with hiring manager"},
        "key_topics": ["Linked Lists", "Trees", "Dynamic Programming", "OOPs", "OS Concepts"],
        "source": "GFG Microsoft Interview Experience 2024",
    },
    "Google": {
        "aptitude": {"topics": [], "pattern": "No aptitude test"},
        "coding": {"topics": ["Hard Graph Algorithms (BFS/DFS/Dijkstra)", "Dynamic Programming (Hard)", "Segment Trees", "Binary Search Variations", "Trie", "Bit Manipulation"], "pattern": "4-5 coding rounds · LeetCode Hard level · Emphasis on optimal solutions and complexity analysis"},
        "technical": {"topics": ["Distributed Systems", "System Design (Scale: millions of users)", "Database Design", "Caching, Load Balancing"], "pattern": "System design round for experienced; CS fundamentals for freshers"},
        "hr": {"topics": ["Googleyness: Intellectual humility", "Leadership examples", "Handling ambiguity", "Failure stories"], "pattern": "Googliness & Leadership round · 45 min"},
        "key_topics": ["Graph Algorithms", "Dynamic Programming", "System Design", "Bit Manipulation", "Binary Search"],
        "source": "GFG Google Interview Experience + LeetCode Google Tag 2024",
    },
    "Deloitte": {
        "aptitude": {"topics": ["Quantitative Aptitude", "Logical Reasoning", "Verbal Ability", "Situational Judgement"], "pattern": "Online assessment · 3 sections · 60 min"},
        "coding": {"topics": ["Basic Data Structures", "SQL Queries", "Python/Java Basics"], "pattern": "Coding assessment · 2 problems · 45 min"},
        "technical": {"topics": ["DBMS (SQL, Normalization)", "OOPs", "Cloud Basics (AWS/Azure)", "Agile/DevOps"], "pattern": "Technical interview · 30-45 min"},
        "hr": {"topics": ["Why Deloitte?", "Client handling scenarios", "Teamwork examples", "Ethics and values"], "pattern": "HR + culture fit round"},
        "key_topics": ["SQL", "OOPs", "Quantitative Aptitude", "Logical Reasoning", "Cloud Basics"],
        "source": "PrepInsta · Deloitte 2024",
    },
    "Capgemini": {
        "aptitude": {"topics": ["Quantitative Aptitude", "Logical Reasoning", "Verbal Ability", "Pseudocode Analysis"], "pattern": "Game-based assessment + Pseudocode · 4 sections · 90 min"},
        "coding": {"topics": ["Strings", "Arrays", "Pattern Printing", "Sorting", "Anagrams"], "pattern": "2 coding problems · Medium difficulty · 30 min"},
        "technical": {"topics": ["OOPs", "DBMS", "OS", "Networking Basics"], "pattern": "Technical interview · 30-45 min"},
        "hr": {"topics": ["Why Capgemini?", "Flexibility to relocate", "5-year career goal"], "pattern": "HR round · 15 min"},
        "key_topics": ["Pseudocode", "Logical Reasoning", "Strings", "OOPs", "DBMS"],
        "source": "PrepInsta · Capgemini 2024",
    },
    "HCL": {
        "aptitude": {"topics": ["Quantitative Aptitude", "Logical Reasoning", "Verbal Ability", "Core Technical MCQ"], "pattern": "HCL TechBee/Graduate: Online test · 4 sections · 75 min"},
        "coding": {"topics": ["Basic Programming", "Armstrong Numbers", "Palindrome", "Array Operations", "Simple Math"], "pattern": "1-2 easy coding problems"},
        "technical": {"topics": ["OOPs Basics", "DBMS Basics", "Networking Fundamentals", "C/Java Basics"], "pattern": "Technical interview · 30 min"},
        "hr": {"topics": ["Why HCL?", "Relocation", "Team scenarios"], "pattern": "HR round"},
        "key_topics": ["Core Technical MCQ", "Logical Reasoning", "OOPs", "Basic Coding", "DBMS"],
        "source": "PrepInsta · HCL 2024",
    },
    "Tech Mahindra": {
        "aptitude": {"topics": ["Quantitative Aptitude", "Logical Reasoning", "Verbal English"], "pattern": "Online test · 3 sections · 60 min"},
        "coding": {"topics": ["Basic Array Problems", "String Reversal", "Pattern Printing"], "pattern": "2 easy problems · 30 min"},
        "technical": {"topics": ["OOPs", "DBMS", "Networking Basics", "Cloud Fundamentals"], "pattern": "Technical interview"},
        "hr": {"topics": ["Why Tech Mahindra?", "Core values", "Career aspirations"], "pattern": "HR round"},
        "key_topics": ["Logical Reasoning", "OOPs", "DBMS", "Verbal English", "Array Basics"],
        "source": "PrepInsta · Tech Mahindra 2024",
    },
    "Zoho": {
        "aptitude": {"topics": ["Mathematical Aptitude (High Level)", "Analytical Thinking", "General Aptitude"], "pattern": "Zoho has 4-5 rounds starting with written aptitude · Very selective process"},
        "coding": {"topics": ["Data Structures (Medium-Hard)", "Algorithms", "Problem Solving without IDE", "Programming Concepts"], "pattern": "Coding rounds done on paper initially · Then on system · 4-5 coding rounds total"},
        "technical": {"topics": ["OOPs (Deep understanding)", "OS", "DBMS", "System Design Basics", "Project Discussion"], "pattern": "Technical interviews · Multiple rounds · Very thorough"},
        "hr": {"topics": ["Why Zoho?", "Long-term commitment to Zoho", "Product mindset"], "pattern": "HR + culture fit · Zoho values loyalty"},
        "key_topics": ["Mathematical Aptitude", "Data Structures", "OOPs (Deep)", "Algorithms", "Problem Solving"],
        "source": "GFG Zoho Interview Experience 2024",
    },
    "Freshworks": {
        "aptitude": {"topics": [], "pattern": "No formal aptitude round for tech roles"},
        "coding": {"topics": ["Arrays", "Strings", "Trees", "Graphs", "DP (Medium)", "Object-Oriented Design"], "pattern": "HackerEarth OA + 2-3 technical rounds · LeetCode Medium level"},
        "technical": {"topics": ["System Design", "OOPs", "Database Design", "API Design", "Product Thinking"], "pattern": "Technical interview focused on product understanding"},
        "hr": {"topics": ["Why Freshworks?", "Customer-first mindset", "Growth stories"], "pattern": "Culture fit round"},
        "key_topics": ["Arrays", "System Design", "OOPs", "Trees", "Product Thinking"],
        "source": "GFG Freshworks Interview Experience 2024",
    },
    "Goldman Sachs": {
        "aptitude": {"topics": ["Quantitative Aptitude (High Level)", "Probability", "Statistics", "Mental Math"], "pattern": "HireVue assessment + Coding OA · Very competitive"},
        "coding": {"topics": ["Data Structures & Algorithms (Hard)", "Dynamic Programming", "Graph Algorithms", "Competitive Programming Style"], "pattern": "2-3 coding rounds · LeetCode Hard · CS fundamentals emphasized"},
        "technical": {"topics": ["System Design", "OS Internals", "Distributed Systems", "Financial Systems Basics"], "pattern": "Technical interviews · Multiple rounds"},
        "hr": {"topics": ["Why Goldman Sachs?", "Finance interest", "Handling pressure", "Ethical scenarios"], "pattern": "HR + culture fit"},
        "key_topics": ["Advanced DSA", "Probability & Statistics", "Dynamic Programming", "System Design", "Finance Basics"],
        "source": "GFG Goldman Sachs Interview Experience 2024",
    },
}


@app.get("/api/pyq/sourced/{company}")
async def pyq_sourced(company: str):
    """Return sourced (non-AI) PYQ data for a company from the pyq_questions table + metadata."""
    meta = _PYQ_COMPANY_META.get(company, {})
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT round_type, question_text, difficulty, topic, source_url, source_name, year, verified
                FROM pyq_questions WHERE company = :c ORDER BY round_type, id
            """), {"c": company}).fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    questions_by_round: dict[str, list] = {"aptitude": [], "coding": [], "technical": [], "hr": []}
    for row in rows:
        rtype, qtext, difficulty, topic, source_url, source_name, year, verified = row
        rtype = (rtype or "").lower()
        if rtype not in questions_by_round:
            questions_by_round[rtype] = []
        questions_by_round[rtype].append({
            "question": qtext, "difficulty": difficulty,
            "topic": topic, "source_url": source_url,
            "source_name": source_name, "year": year, "verified": bool(verified),
        })

    rounds_out = {}
    for rtype in ["aptitude", "coding", "technical", "hr"]:
        round_meta = (meta.get(rtype) or {})
        rounds_out[rtype] = {
            "topics": round_meta.get("topics", []),
            "exam_pattern": round_meta.get("pattern", ""),
            "questions": questions_by_round.get(rtype, []),
        }

    return {
        "company": company,
        "key_topics": meta.get("key_topics", []),
        "data_source": meta.get("source", "PrepInsta / GFG Interview Experiences"),
        "rounds": rounds_out,
        "found": bool(rows) or bool(meta),
    }


# ── PYQ Quiz Mode ──────────────────────────────────────────────────────────────

import random as _random

class QuizIn(BaseModel):
    company: str


@app.post("/api/pyq/quiz")
async def pyq_quiz(payload: QuizIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured. Add GROQ_API_KEY to .env")

    cache_key = f"quiz_{payload.company.lower().replace(' ', '_')}"
    cached = _cache_get("pyq_quiz_cache", cache_key, ttl_hours=24)
    if cached:
        try:
            data = json.loads(cached)
            questions = list(data.get("questions", []))
            _random.shuffle(questions)
            return {"company": payload.company, "questions": questions}
        except Exception:
            pass

    prompt = (
        f"You are an expert on Indian campus placement tests. Generate 15 multiple-choice quiz questions "
        f"for {payload.company} placement preparation.\n\n"
        "Mix topics: Quantitative Aptitude, Logical Reasoning, Verbal Ability, and Technical concepts "
        f"commonly tested at {payload.company}.\n\n"
        "Return only valid JSON:\n"
        "{\n"
        '  "questions": [\n'
        '    {\n'
        '      "id": "unique_short_string_no_spaces",\n'
        '      "question": "full question text",\n'
        '      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],\n'
        '      "correct_index": 0,\n'
        '      "explanation": "why the correct answer is right, and briefly why the other options are wrong",\n'
        '      "topic": "e.g. Time & Work / Arrays / Verbal",\n'
        '      "difficulty": "Easy"\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        "Rules:\n"
        "- correct_index is 0-based (0=A, 1=B, 2=C, 3=D)\n"
        "- difficulty must be Easy, Medium, or Hard\n"
        "- Make questions specific and realistic for this company\n"
        "- Only return the JSON object, no markdown"
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
        )
        raw = completion.choices[0].message.content or ""
        data = parse_groq_json(raw)

        questions = data.get("questions", [])
        # Ensure all questions have required fields
        valid = []
        for q in questions:
            if (isinstance(q.get("options"), list) and len(q["options"]) == 4
                    and isinstance(q.get("correct_index"), int)
                    and 0 <= q["correct_index"] <= 3
                    and q.get("question")):
                if not q.get("id"):
                    q["id"] = hashlib.md5(q["question"].encode()).hexdigest()[:12]
                valid.append(q)

        _cache_set("pyq_quiz_cache", cache_key, json.dumps({"questions": valid}))
        _random.shuffle(valid)
        return {"company": payload.company, "questions": valid}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class ExplanationIn(BaseModel):
    question_id: str
    question_text: str
    correct_answer: str = ""


@app.post("/api/pyq/explanation")
async def pyq_explanation(payload: ExplanationIn):
    if _groq is None:
        raise HTTPException(status_code=503, detail="AI service not configured")

    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT explanation FROM pyq_explanations WHERE question_id = :qid"),
                {"qid": payload.question_id},
            ).fetchone()
            if row:
                return {"explanation": row[0]}
    except Exception as e:
        print(f"[pyq_explanation] DB read error: {e}")

    answer_part = f"'{payload.correct_answer}'" if payload.correct_answer else "the correct answer"
    prompt = (
        f"In one sentence, explain why {answer_part} is correct for this question:\n"
        f"'{payload.question_text}'\nBe concise and educational."
    )

    try:
        completion = _groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        explanation = (completion.choices[0].message.content or "").strip()

        try:
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM pyq_explanations WHERE question_id = :qid"),
                    {"qid": payload.question_id},
                )
                conn.execute(
                    text("INSERT INTO pyq_explanations (question_id, explanation, generated_at) VALUES (:qid, :exp, :ts)"),
                    {"qid": payload.question_id, "exp": explanation, "ts": datetime.now(timezone.utc).isoformat()},
                )
        except Exception as e:
            print(f"[pyq_explanation] DB write error: {e}")

        return {"explanation": explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Coding Platform Stats ──────────────────────────────────────────────────────

async def _fetch_leetcode_stats(username: str) -> dict:
    query = (
        "{ matchedUser(username: \"%s\") { submitStats { acSubmissionNum { difficulty count } } "
        "profile { ranking } } }" % username
    )
    headers = {
        "Content-Type": "application/json",
        "Referer": "https://leetcode.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        resp = await client.post(
            "https://leetcode.com/graphql",
            json={"query": query},
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()
        user = data.get("data", {}).get("matchedUser")
        if not user:
            return {"error": "User not found or profile is private"}
        counts = {s["difficulty"]: s["count"] for s in user.get("submitStats", {}).get("acSubmissionNum", [])}
        return {
            "username": username,
            "total_solved": counts.get("All", 0),
            "easy_solved": counts.get("Easy", 0),
            "medium_solved": counts.get("Medium", 0),
            "hard_solved": counts.get("Hard", 0),
            "ranking": user.get("profile", {}).get("ranking", 0),
            "profile_url": f"https://leetcode.com/{username}/",
        }


async def _fetch_codechef_stats(username: str) -> dict:
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=headers) as client:
        resp = await client.get(f"https://www.codechef.com/users/{username}")
        if resp.status_code == 404:
            return {"error": "User not found"}
        soup = BeautifulSoup(resp.text, "html.parser")

        rating = 0
        el = soup.find("div", class_="rating-number")
        if el:
            try:
                rating = int(el.get_text(strip=True))
            except ValueError:
                pass

        highest_rating = rating
        for small in soup.find_all("small"):
            txt = small.get_text()
            if "Highest" in txt:
                digits = "".join(c for c in txt if c.isdigit())
                if digits:
                    highest_rating = int(digits)
                break

        stars = 0
        full_text = soup.get_text()
        for marker in ["★★★★★★★", "★★★★★★", "★★★★★", "★★★★", "★★★", "★★", "★"]:
            if marker in full_text:
                stars = len(marker)
                break

        global_rank = country_rank = problems_solved = 0
        ranks_div = soup.find("div", class_="rating-ranks")
        if ranks_div:
            strong_els = ranks_div.find_all("strong")
            for i, el in enumerate(strong_els[:2]):
                val = "".join(c for c in el.get_text() if c.isdigit() or c == ",").replace(",", "")
                if val:
                    if i == 0:
                        global_rank = int(val)
                    else:
                        country_rank = int(val)

        for section in soup.find_all("section"):
            h5 = section.find("h5")
            if h5 and "problem" in h5.get_text().lower():
                problems_solved = len(section.find_all("a"))
                break

        return {
            "username": username,
            "rating": rating,
            "highest_rating": highest_rating,
            "stars": stars,
            "global_rank": global_rank,
            "country_rank": country_rank,
            "problems_solved": problems_solved,
            "profile_url": f"https://www.codechef.com/users/{username}",
        }


async def _fetch_codeforces_stats(username: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"https://codeforces.com/api/user.info?handles={username}")
        data = resp.json()
        if data.get("status") != "OK":
            return {"error": data.get("comment", "User not found")}
        user = data["result"][0]
        return {
            "username": username,
            "rating": user.get("rating", 0),
            "max_rating": user.get("maxRating", 0),
            "rank": user.get("rank", "unrated"),
            "max_rank": user.get("maxRank", "unrated"),
            "contribution": user.get("contribution", 0),
            "profile_url": f"https://codeforces.com/profile/{username}",
        }


@app.get("/api/coding/stats")
async def coding_stats(leetcode: str = "", codechef: str = "", codeforces: str = ""):
    result: dict = {}

    async def get_stats(platform: str, username: str, fetch_fn):
        if not username.strip():
            return None
        uname = username.strip()
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    text("SELECT stats_json, cached_at FROM coding_stats_cache WHERE platform = :p AND username = :u"),
                    {"p": platform, "u": uname},
                ).fetchone()
                if row:
                    cached_at = datetime.fromisoformat(row[1])
                    if cached_at.tzinfo is None:
                        cached_at = cached_at.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) - cached_at <= timedelta(hours=6):
                        return json.loads(row[0])
        except Exception as e:
            print(f"[coding_stats] Cache read ({platform}): {e}")

        try:
            stats = await fetch_fn(uname)
        except Exception as e:
            stats = {"error": str(e)}

        try:
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM coding_stats_cache WHERE platform = :p AND username = :u"),
                    {"p": platform, "u": uname},
                )
                conn.execute(
                    text("INSERT INTO coding_stats_cache (platform, username, stats_json, cached_at) VALUES (:p, :u, :s, :t)"),
                    {"p": platform, "u": uname, "s": json.dumps(stats), "t": datetime.now(timezone.utc).isoformat()},
                )
        except Exception as e:
            print(f"[coding_stats] Cache write ({platform}): {e}")

        return stats

    if leetcode:
        result["leetcode"] = await get_stats("leetcode", leetcode, _fetch_leetcode_stats)
    if codechef:
        result["codechef"] = await get_stats("codechef", codechef, _fetch_codechef_stats)
    if codeforces:
        result["codeforces"] = await get_stats("codeforces", codeforces, _fetch_codeforces_stats)

    return result
