from sqlalchemy import Column, Integer, String, Float, JSON, Text
from pydantic import BaseModel, Field
from typing import List
from database import Base


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    college = Column(String, nullable=False)
    branch = Column(String, nullable=False)
    year = Column(String, nullable=False)
    cgpa = Column(Float, nullable=False)
    skills = Column(JSON, nullable=False)
    target_role = Column(String, nullable=False)
    placement_score = Column(Integer, nullable=False)
    score_reasoning = Column(Text, nullable=True, server_default="")
    college_tier = Column(String, nullable=True, server_default="")
    # Step 4
    projects_count = Column(String, nullable=True, server_default="0")
    has_internship = Column(String, nullable=True, server_default="no")
    internship_months = Column(String, nullable=True, server_default="")
    hackathons = Column(String, nullable=True, server_default="0")
    # Step 5
    leetcode_count = Column(String, nullable=True, server_default="0")
    open_source = Column(String, nullable=True, server_default="no")
    certifications = Column(String, nullable=True, server_default="0")
    github_active = Column(String, nullable=True, server_default="no")


class ProfileIn(BaseModel):
    email: str
    college: str
    branch: str
    year: str
    cgpa: float = Field(ge=0, le=10)
    skills: List[str]
    targetRole: str
    projectsCount: str = "0"
    hasInternship: str = "no"
    internshipMonths: str = ""
    hackathons: str = "0"
    leetcodeCount: str = "0"
    openSource: str = "no"
    certifications: str = "0"
    githubActive: str = "no"


class ProfileOut(BaseModel):
    email: str
    college: str
    branch: str
    year: str
    cgpa: float
    skills: List[str]
    targetRole: str
    placementScore: int
    scoreReasoning: str
    collegeTier: str
    projectsCount: str
    hasInternship: str
    internshipMonths: str
    hackathons: str
    leetcodeCount: str
    openSource: str
    certifications: str
    githubActive: str

    model_config = {"from_attributes": True}


class SkillsGapIn(BaseModel):
    target_role: str
    skills: List[str]
    college_tier: str = ""
    branch: str = ""
    cgpa: float = 0.0


class CompanyMatchIn(BaseModel):
    college: str = ""
    college_tier: str = ""
    branch: str = ""
    cgpa: float = 0.0
    skills: List[str] = []
    target_role: str = ""
    projects_count: str = "0"
    has_internship: str = "no"
    internship_months: str = ""
    leetcode_count: str = "0"
    hackathons: str = "0"
    github_active: str = "no"


class RoadmapIn(BaseModel):
    college: str = ""
    college_tier: str = ""
    branch: str = ""
    cgpa: float = 0.0
    skills: List[str] = []
    target_role: str = ""
    target_companies: List[str] = []
    leetcode_count: str = "0"
    projects_count: str = "0"
    has_internship: str = "no"
    internship_months: str = ""
    must_have_missing: List[str] = []


class RoadmapChatIn(BaseModel):
    user_message: str
    current_roadmap: dict
    profile: dict
