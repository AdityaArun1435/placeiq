"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Zap, Building2, Map as MapIcon, Globe, GraduationCap, Briefcase,
  Users, ClipboardList, TrendingUp, FileText, FileSearch,
  BookOpen, BarChart2, Database, School, Star,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import config from "@/lib/config";
import LoadingScreen from "@/components/LoadingScreen";

type Profile = {
  placementScore: number;
  scoreReasoning: string;
  collegeTier: string;
  skills: string[];
  targetRole: string;
  college: string;
  branch: string;
  year: string;
  cgpa: number;
  projectsCount: string;
  hasInternship: string;
  internshipMonths: string;
  leetcodeCount: string;
  hackathons: string;
  githubActive: string;
  email: string;
};

type SkillItem = {
  skill: string;
  why_important: string;
  time_to_learn: string;
  free_resource_link: string;
};

type PlacementSource = {
  source_name: string;
  placement_rate: number | null;
  median_salary: number | null;
  highest_salary: number | null;
  top_companies: string[];
  year: number;
  url: string;
};

type ScoreBreakdown = {
  base_rate: number;
  college_name: string;
  cgpa_impact: number;
  skills_impact: number;
  skill_reasoning?: string;
  internship_impact: number;
  leetcode_impact: number;
  projects_impact: number;
  other_impact: number;
  total_adjustment: number;
  final_score: number;
  data_source: string;
  override_notes: string;
};

type LiveScore = {
  score: number;
  college_tier: string;
  nirf_stats: {
    college_name: string;
    nirf_rank: number | null;
    college_tier: string;
    placement_rate: number | null;
    median_salary: number | null;
    highest_salary: number | null;
    matched: boolean;
    score_breakdown?: ScoreBreakdown;
  } | null;
  sources: PlacementSource[];
  combined_base: number;
  num_sources: number;
  model_last_retrained?: string | null;
};

type FeatureItem = {
  path: string;
  name: string;
  Icon: ComponentType<LucideProps>;
  description: string;
};

type FeatureGroup = {
  label: string;
  features: FeatureItem[];
};

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    label: "Placement Intelligence",
    features: [
      { path: "/skills", name: "Skill Gap Analysis", Icon: Zap, description: "See exactly which skills you are missing for your target role based on real job postings." },
      { path: "/companies", name: "Company Matches", Icon: Building2, description: "Personalised company match list ranked by fit with reasoning for each match." },
      { path: "/roadmap", name: "90-Day Roadmap", Icon: MapIcon, description: "Personalised 30/60/90 day prep plan with direct clickable resource links." },
    ],
  },
  {
    label: "Find Opportunities",
    features: [
      { path: "/offcampus", name: "Off Campus Jobs", Icon: Globe, description: "Live job listings from Adzuna filtered by your skills and salary expectations." },
      { path: "/oncampus", name: "On Campus Drives", Icon: GraduationCap, description: "Companies likely to visit your college this season with probability scores." },
      { path: "/internships", name: "Internships", Icon: Briefcase, description: "Live internships with an AI strategy tailored to your college tier and profile." },
      { path: "/referral", name: "Referral Radar", Icon: Users, description: "Find alumni from your college working at top companies." },
      { path: "/starred", name: "Starred Companies", Icon: Star, description: "Track companies you want to join and get notified of drives." },
    ],
  },
  {
    label: "Track & Prepare",
    features: [
      { path: "/tracker", name: "Application Tracker", Icon: ClipboardList, description: "Track every company through: Saved, Applied, Interview, Offer, Rejected." },
      { path: "/progress", name: "Progress Tracker", Icon: TrendingUp, description: "Track which skills you have learned. Watch your placement score improve." },
      { path: "/pyq", name: "Previous Year Questions", Icon: FileText, description: "Interview questions by company and round — Aptitude, Coding, Technical, HR." },
      { path: "/resume", name: "Resume Analyser", Icon: FileSearch, description: "Upload your resume, paste a JD. Get an AI-powered gap analysis." },
      { path: "/resources", name: "Resources", Icon: BookOpen, description: "Direct links to DSA sheets, YouTube channels, free courses, and aptitude prep." },
    ],
  },
  {
    label: "Market & Research",
    features: [
      { path: "/market", name: "Market Intelligence", Icon: BarChart2, description: "Trending roles, top hiring companies, CTC trends, and campus placement insights." },
      { path: "/college-stats", name: "College Stats", Icon: School, description: "Placement data for 24 colleges. Year-wise CTC trends and company visit history." },
      { path: "/company-directory", name: "Company Directory", Icon: Database, description: "All companies with hiring details, tech stack, and prep guides." },
    ],
  },
];

const TIER_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  "Tier 1": { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.3)" },
  "Tier 2": { bg: "var(--accent-blue-muted)", text: "var(--accent-blue)", border: "rgba(59,130,246,0.3)" },
  "Tier 3": { bg: "rgba(245,158,11,0.1)", text: "var(--accent-amber)", border: "rgba(245,158,11,0.3)" },
};

const SOURCE_LINKS: Record<string, string> = {
  "NIRF 2024": "https://www.nirfindia.org/2024/EngineeringRanking.html",
  Shiksha: "https://www.shiksha.com",
  Careers360: "https://engineering.careers360.com",
};

function getGraduationYear(yearOfStudy: string): number {
  const current = new Date().getFullYear();
  const map: Record<string, number> = { "1st": 3, "2nd": 2, "3rd": 1, "4th": 0 };
  return current + (map[yearOfStudy] ?? 1);
}

function getHourGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getDaysToSeason() {
  const today = new Date();
  const season = new Date(today.getFullYear(), 9, 1); // October 1
  if (today >= season) season.setFullYear(today.getFullYear() + 1);
  return Math.ceil((season.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getProfileStrength(profile: Profile): number {
  let score = 0;
  if (profile.college) score += 15;
  if (profile.branch) score += 10;
  if (profile.cgpa > 0) score += 10;
  if ((profile.skills?.length ?? 0) >= 3) score += 20;
  if (Number(profile.projectsCount) >= 1) score += 15;
  if (profile.hasInternship === "yes") score += 15;
  if (Number(profile.leetcodeCount) > 0) score += 10;
  if (profile.targetRole) score += 5;
  return score;
}

function getScoreColor(score: number) {
  if (score < 40) return "#ef4444";
  if (score < 65) return "var(--accent-amber)";
  return "var(--accent-green)";
}

function ScoreRing({ score, loading }: { score: number | undefined; loading: boolean }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const [animated, setAnimated] = useState(false);
  const dashoffset = animated && score !== undefined
    ? circumference * (1 - score / 100)
    : circumference;

  useEffect(() => {
    if (!loading && score !== undefined) {
      requestAnimationFrame(() => setAnimated(true));
    }
  }, [loading, score]);

  const color = score !== undefined ? getScoreColor(score) : "var(--border-default)";

  return (
    <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0 }}>
      <svg
        width={120}
        height={120}
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden="true"
      >
        <circle
          cx={60} cy={60} r={radius}
          fill="none"
          stroke="var(--border-default)"
          strokeWidth={8}
        />
        <circle
          cx={60} cy={60} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s var(--ease-out), stroke 0.3s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loading ? (
          <div style={{ width: 32, height: 8, background: "var(--bg-elevated)", borderRadius: 4 }} />
        ) : (
          <>
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                color,
                fontFamily: "var(--font-sans)",
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {score ?? "--"}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2, fontFamily: "var(--font-sans)" }}>
              / 100
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: string | number;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderLeft: accent ? "3px solid var(--accent-blue)" : "1px solid var(--border-default)",
        borderRadius: 10,
        padding: "20px 24px",
        height: 96,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        transition: `background-color var(--duration-fast) var(--ease-out)`,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-surface)"; }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-sans)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {loading ? (
        <div style={{ width: 48, height: 24, background: "var(--bg-elevated)", borderRadius: 4 }} className="animate-pulse" />
      ) : (
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);
  const [liveScore, setLiveScore] = useState<LiveScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [skillGaps, setSkillGaps] = useState<SkillItem[] | null>(null);
  const [skillGapLoading, setSkillGapLoading] = useState(false);
  const [companyMatches, setCompanyMatches] = useState<Array<{ name: string; type: string }> | null>(null);
  const [companyCount, setCompanyCount] = useState(0);
  const [companyMatchLoading, setCompanyMatchLoading] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [cardEntered, setCardEntered] = useState(false);
  const [scoreNonce, setScoreNonce] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.email) return;
    let isMounted = true;
    try {
      const stored = localStorage.getItem("placeiq_profile");
      if (stored) {
        setProfile(JSON.parse(stored));
        setProfileLoading(false);
        setProfileChecked(true);
        return () => { isMounted = false; };
      }
    } catch (e) { console.error("Dashboard error:", e); }
    const email = encodeURIComponent(session.user.email);
    fetch(`${config.apiUrl}/api/user/profile/${email}`)
      .then((res) => { if (res.status === 404) return null; if (!res.ok) throw new Error("fetch failed"); return res.json(); })
      .then((data) => { if (!isMounted) return; if (data) localStorage.setItem("placeiq_profile", JSON.stringify(data)); setProfile(data); })
      .catch(() => { if (!isMounted) return; setProfile(null); })
      .finally(() => { if (!isMounted) return; setProfileLoading(false); setProfileChecked(true); });
    return () => { isMounted = false; };
  }, [status, session?.user?.email]);

  useEffect(() => {
    if (!profileChecked || profile) return;
    const timer = setTimeout(() => router.push("/onboarding"), 2000);
    return () => clearTimeout(timer);
  }, [profileChecked, profile]);

  useEffect(() => {
    if (!profile?.email) return;
    const cacheKey = `placeiq_score_${profile.email}`;
    if (scoreNonce === 0) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
            setLiveScore(data);
            return;
          }
        }
      } catch { /* ignore */ }
    }
    let isMounted = true;
    setScoreLoading(true);
    fetch(`${config.apiUrl}/api/placement/probability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: profile.email,
        college: profile.college,
        branch: profile.branch,
        year: "",
        cgpa: profile.cgpa,
        skills: profile?.skills ?? [],
        targetRole: profile.targetRole,
        projectsCount: profile.projectsCount || "0",
        hasInternship: profile.hasInternship || "no",
        internshipMonths: profile.internshipMonths || "",
        hackathons: profile.hackathons || "0",
        leetcodeCount: profile.leetcodeCount || "0",
        openSource: "no",
        certifications: "0",
        githubActive: profile.githubActive || "no",
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data) {
          setLiveScore(data);
          try { localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() })); } catch { /* ignore */ }
        }
      })
      .catch((e) => { if (!isMounted) return; console.error("Dashboard error:", e); })
      .finally(() => { if (isMounted) setScoreLoading(false); });
    return () => { isMounted = false; };
  }, [profile, scoreNonce]);

  useEffect(() => {
    if (!profile) return;
    let isMounted = true;
    setSkillGapLoading(true);
    (async () => {
      try {
        const res = await fetch(`${config.apiUrl}/api/skills/gap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_role: profile.targetRole, skills: profile?.skills ?? [], college_tier: profile.collegeTier, branch: profile.branch, cgpa: profile.cgpa }),
        });
        if (!res.ok || !isMounted) return;
        const parsed = await res.json();
        if (!isMounted) return;
        if (parsed && !parsed.error && Array.isArray(parsed.must_have_missing)) {
          setSkillGaps(parsed.must_have_missing.slice(0, 3));
        }
      } catch (e) { if (!isMounted) return; console.error("Dashboard error:", e); }
      finally { if (isMounted) setSkillGapLoading(false); }
    })();
    return () => { isMounted = false; };
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    try {
      const cached = localStorage.getItem("placeiq_companies");
      if (cached) {
        const companies = JSON.parse(cached);
        if (Array.isArray(companies) && companies.length > 0) {
          setCompanyCount(companies.length);
          setCompanyMatches(
            companies
              .sort((a: { match_score?: number }, b: { match_score?: number }) => (b.match_score ?? 0) - (a.match_score ?? 0))
              .slice(0, 3)
              .map((c: { name: string; type: string }) => ({ name: c.name, type: c.type }))
          );
          return;
        }
      }
    } catch { /* ignore */ }
    let isMounted = true;
    setCompanyMatchLoading(true);
    (async () => {
      try {
        const res = await fetch(`${config.apiUrl}/api/companies/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            college: profile.college, college_tier: profile.collegeTier, branch: profile.branch,
            cgpa: profile.cgpa, skills: profile?.skills ?? [], target_role: profile.targetRole,
            projects_count: profile.projectsCount || "0", has_internship: profile.hasInternship || "no",
            internship_months: profile.internshipMonths || "", leetcode_count: profile.leetcodeCount || "0",
            hackathons: profile.hackathons || "0", github_active: profile.githubActive || "no",
          }),
        });
        if (!res.ok || !isMounted) return;
        const parsed = await res.json();
        if (!isMounted) return;
        if (parsed && !parsed.error && Array.isArray(parsed.companies)) {
          setCompanyCount(parsed.companies.length);
          setCompanyMatches(
            parsed.companies
              .sort((a: { match_score: number }, b: { match_score: number }) => b.match_score - a.match_score)
              .slice(0, 3)
              .map((c: { name: string; type: string }) => ({ name: c.name, type: c.type }))
          );
        }
      } catch (e) { if (!isMounted) return; console.error("Dashboard error:", e); }
      finally { if (isMounted) setCompanyMatchLoading(false); }
    })();
    return () => { isMounted = false; };
  }, [profile]);

  // Stagger cards in on mount
  useEffect(() => {
    const timer = requestAnimationFrame(() => setCardEntered(true));
    return () => cancelAnimationFrame(timer);
  }, []);

  const displayScore = liveScore?.nirf_stats?.score_breakdown?.final_score ?? liveScore?.score ?? profile?.placementScore;
  const displayTier = liveScore?.college_tier ?? profile?.collegeTier;
  const tierStyle = displayTier ? TIER_STYLES[displayTier] : null;
  const daysToSeason = getDaysToSeason();
  const profileStrength = profile ? getProfileStrength(profile) : 0;

  if (status === "loading" || (status === "authenticated" && profileLoading)) return <LoadingScreen message="Loading your profile..." />;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* No profile banner */}
        {profileChecked && !profile && !profileLoading && (
          <div
            style={{
              background: "var(--accent-blue-muted)",
              border: "1px solid rgba(59,130,246,0.25)",
              borderRadius: 10,
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 24,
            }}
          >
            <p style={{ fontSize: 14, color: "var(--text-secondary)", fontFamily: "var(--font-sans)" }}>
              Complete your profile to get personalised insights
            </p>
            <button
              onClick={() => router.push("/onboarding")}
              className="focus-ring"
              style={{
                background: "var(--accent-blue)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                flexShrink: 0,
                fontFamily: "var(--font-sans)",
              }}
            >
              Complete Profile
            </button>
          </div>
        )}

        {/* ── TOP ROW: Greeting + Score ring ───────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
            marginBottom: 32,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans)",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                marginBottom: 6,
              }}
            >
              {getHourGreeting()}, {session?.user?.name?.split(" ")?.[0] ?? "there"}
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>
              {profile
                ? `${profile.college} · ${profile.branch} · ${getGraduationYear(profile.year ?? "")}`
                : "Complete your profile to get your placement score"}
            </p>

            {/* Score reasoning */}
            {!profileLoading && profile?.scoreReasoning && (
              <div
                style={{
                  marginTop: 16,
                  maxWidth: 560,
                  padding: "12px 16px",
                  background: "var(--accent-blue-muted)",
                  border: "1px solid rgba(59,130,246,0.2)",
                  borderRadius: 8,
                }}
              >
                <p style={{ fontSize: 11, color: "var(--accent-blue)", fontFamily: "var(--font-sans)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  Why this score?
                </p>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, fontFamily: "var(--font-sans)" }}>
                  {profile.scoreReasoning}
                </p>
              </div>
            )}
          </div>

          {/* Score ring + label */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <ScoreRing score={displayScore} loading={profileLoading || scoreLoading} />
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>
                  Placement Score
                </div>
                {!scoreLoading && (
                  <button
                    onClick={() => {
                      try { localStorage.removeItem(`placeiq_score_${profile?.email}`); } catch { /* ignore */ }
                      setScoreNonce(n => n + 1);
                    }}
                    style={{ fontSize: 10, color: "var(--text-tertiary)", background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", padding: "2px 4px", borderRadius: 4, textDecoration: "underline" }}
                    title="Clear cached score and fetch fresh"
                  >
                    Recalculate
                  </button>
                )}
              </div>
              {tierStyle && displayTier && (
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 4,
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 20,
                    background: tierStyle.bg,
                    color: tierStyle.text,
                    border: `1px solid ${tierStyle.border}`,
                    fontFamily: "var(--font-sans)",
                    fontWeight: 500,
                  }}
                >
                  {displayTier}
                </span>
              )}
              {!scoreLoading && liveScore && (liveScore.nirf_stats?.placement_rate != null || liveScore.combined_base != null) && (
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4, fontFamily: "var(--font-sans)" }}>
                  {profile?.college?.split(" ").slice(0, 2).join(" ")} avg:{" "}
                  {liveScore.nirf_stats?.placement_rate ?? liveScore.combined_base}% placed
                </div>
              )}
            </div>

            {/* Score breakdown toggle */}
            {liveScore?.nirf_stats?.score_breakdown && displayScore !== undefined && (
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="focus-ring"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-sans)",
                  padding: "4px 8px",
                  borderRadius: 4,
                  transition: `color var(--duration-fast) var(--ease-out)`,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-tertiary)"; }}
              >
                {showBreakdown ? "Hide breakdown" : "Why this score?"}
              </button>
            )}
          </div>
        </div>

        {/* Score breakdown */}
        {showBreakdown && liveScore?.nirf_stats?.score_breakdown && (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: 10,
              padding: "20px 24px",
              marginBottom: 24,
              maxWidth: 480,
            }}
          >
            {(() => {
              const bd = liveScore.nirf_stats!.score_breakdown!;
              const adj = (n: number) => n === 0 ? "—" : n > 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`;
              const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8, fontFamily: "var(--font-sans)" };
              return (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12, fontFamily: "var(--font-sans)" }}>Score Breakdown</p>
                  <div style={rowStyle}><span style={{ color: "var(--text-secondary)" }}>Base rate ({bd.college_name})</span><span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{bd.base_rate}%</span></div>
                  <div style={rowStyle}><span style={{ color: "var(--text-tertiary)" }}>CGPA</span><span style={{ color: bd.cgpa_impact >= 0 ? "var(--accent-green)" : "#ef4444" }}>{adj(bd.cgpa_impact)}</span></div>
                  <div style={rowStyle}><span style={{ color: "var(--text-tertiary)" }}>Skills</span><span style={{ color: bd.skills_impact >= 0 ? "var(--accent-green)" : "#ef4444" }}>{adj(bd.skills_impact)}</span></div>
                  <div style={rowStyle}><span style={{ color: "var(--text-tertiary)" }}>Internship</span><span style={{ color: bd.internship_impact >= 0 ? "var(--accent-green)" : "#ef4444" }}>{adj(bd.internship_impact)}</span></div>
                  <div style={rowStyle}><span style={{ color: "var(--text-tertiary)" }}>LeetCode</span><span style={{ color: bd.leetcode_impact >= 0 ? "var(--accent-green)" : "#ef4444" }}>{adj(bd.leetcode_impact)}</span></div>
                  <div style={rowStyle}><span style={{ color: "var(--text-tertiary)" }}>Projects</span><span style={{ color: bd.projects_impact >= 0 ? "var(--accent-green)" : "#ef4444" }}>{adj(bd.projects_impact)}</span></div>
                  <div style={{ ...rowStyle, borderTop: "1px solid var(--border-subtle)", paddingTop: 8, marginTop: 4 }}>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Final score</span>
                    <span style={{ color: "var(--accent-blue)", fontWeight: 700 }}>{bd.final_score}/100</span>
                  </div>
                  <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 8, fontFamily: "var(--font-sans)" }}>{bd.data_source}</p>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── STATS CARDS ROW ──────────────────────────────────────── */}
        <div
          ref={cardRef}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            marginBottom: 32,
          }}
        >
          {[
            { label: "Companies Matched", value: profile ? (companyCount || "--") : "--", loading: profileLoading || companyMatchLoading, accent: true },
            { label: "Skills to Learn", value: profile ? (skillGaps?.length ?? "--") : "--", loading: profileLoading || skillGapLoading, accent: false },
            { label: "Days to Season", value: daysToSeason, loading: false, accent: false },
            { label: "Profile Strength", value: profile ? `${profileStrength}%` : "--", loading: profileLoading, accent: profileStrength >= 80 },
          ].map((card, i) => (
            <div
              key={card.label}
              style={{
                opacity: cardEntered ? 1 : 0,
                transform: cardEntered ? "translateY(0)" : "translateY(8px)",
                transition: `opacity 400ms var(--ease-out) ${i * 50}ms, transform 400ms var(--ease-out) ${i * 50}ms`,
              }}
            >
              <StatCard {...card} />
            </div>
          ))}
        </div>

        {/* Placement data sources panel */}
        {!profileLoading && profile && liveScore && (liveScore.nirf_stats?.matched || (liveScore.sources?.length ?? 0) > 0) && (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: 10,
              padding: "20px 24px",
              marginBottom: 32,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)", marginBottom: 2 }}>Placement Data Sources</h3>
                <p style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>{profile.college}</p>
              </div>
              {liveScore.num_sources > 1 && (
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-elevated)", padding: "4px 10px", borderRadius: 20, fontFamily: "var(--font-sans)" }}>
                  avg {liveScore.combined_base}% across {liveScore.num_sources} sources
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {liveScore.nirf_stats?.matched && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--accent-green)", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", padding: "2px 8px", borderRadius: 4, fontFamily: "var(--font-sans)" }}>NIRF</span>
                    <div>
                      <a href="https://www.nirfindia.org/2024/EngineeringRanking.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "var(--text-primary)", textDecoration: "none" }}>NIRF 2024</a>
                      <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>Official govt ranking</p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>{liveScore.nirf_stats.placement_rate != null ? `${liveScore.nirf_stats.placement_rate}%` : "—"}</p>
                    {liveScore.nirf_stats.median_salary != null && <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>{liveScore.nirf_stats.median_salary} LPA</p>}
                  </div>
                </div>
              )}
              {(liveScore.sources ?? []).map((src, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--accent-blue)", background: "var(--accent-blue-muted)", border: "1px solid rgba(59,130,246,0.2)", padding: "2px 8px", borderRadius: 4, fontFamily: "var(--font-sans)" }}>{src.source_name[0]}</span>
                    <div>
                      <a href={src.url || SOURCE_LINKS[src.source_name] || "#"} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "var(--text-primary)", textDecoration: "none" }}>{src.source_name}</a>
                      <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>{src.year ? `${src.year} data` : "Placement report"}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>{src.placement_rate != null ? `${src.placement_rate}%` : "—"}</p>
                    {src.median_salary != null && <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>{src.median_salary} LPA</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills chips */}
        {!profileLoading && profile && (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: 10,
              padding: "20px 24px",
              marginBottom: 32,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>Your Skills</h3>
              <button onClick={() => router.push("/onboarding")} className="focus-ring" style={{ fontSize: 12, color: "var(--accent-blue)", background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", padding: "4px 0", borderRadius: 4 }}>
                Update profile
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(Array.isArray(profile?.skills) ? profile.skills : []).map((skill) => (
                <span
                  key={skill}
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    padding: "4px 10px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 6,
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 90-day roadmap CTA */}
        {!profileLoading && profile && (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: 10,
              padding: "20px 24px",
              marginBottom: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)", marginBottom: 4 }}>Your 90-Day Prep Roadmap</h3>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", fontFamily: "var(--font-sans)" }}>Personalised daily plan to get placed at your target companies.</p>
            </div>
            <button
              onClick={() => router.push("/roadmap")}
              className="focus-ring"
              style={{ background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", flexShrink: 0, fontFamily: "var(--font-sans)", transition: `filter var(--duration-fast) var(--ease-out)` }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = ""; }}
            >
              View Roadmap
            </button>
          </div>
        )}

        {/* ── FEATURE CARDS ─────────────────────────────────────────── */}
        <div>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-sans)",
              marginBottom: 20,
            }}
          >
            Explore PlaceIQ
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {FEATURE_GROUPS.map((group, gi) => (
              <div key={group.label}>
                <p
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-sans)",
                    marginBottom: 12,
                    fontWeight: 500,
                  }}
                >
                  {group.label}
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 12,
                  }}
                >
                  {group.features.map(({ path, name, Icon, description }, fi) => (
                    <a
                      key={path}
                      href={path}
                      onClick={(e) => { e.preventDefault(); router.push(path); }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-default)",
                        borderRadius: 10,
                        padding: 20,
                        cursor: "pointer",
                        textDecoration: "none",
                        opacity: cardEntered ? 1 : 0,
                        transform: cardEntered ? "translateY(0)" : "translateY(8px)",
                        transition: cardEntered
                          ? `border-color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out), opacity 400ms var(--ease-out) ${(gi * 3 + fi) * 40 + 200}ms, transform 400ms var(--ease-out) ${(gi * 3 + fi) * 40 + 200}ms`
                          : `opacity 400ms var(--ease-out) ${(gi * 3 + fi) * 40 + 200}ms, transform 400ms var(--ease-out) ${(gi * 3 + fi) * 40 + 200}ms`,
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        el.style.borderColor = "var(--border-strong)";
                        el.style.background = "var(--bg-elevated)";
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget;
                        el.style.borderColor = "var(--border-default)";
                        el.style.background = "var(--bg-surface)";
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: "var(--accent-blue-muted)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginBottom: 12,
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={16} color="var(--accent-blue)" />
                      </div>
                      <h4
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          marginBottom: 4,
                          fontFamily: "var(--font-sans)",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {name}
                      </h4>
                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--text-secondary)",
                          lineHeight: 1.5,
                          fontFamily: "var(--font-sans)",
                          flex: 1,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {description}
                      </p>
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--accent-blue)",
                          marginTop: 12,
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        Open →
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
