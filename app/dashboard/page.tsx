"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import {
  Zap, Building2, Map as MapIcon, Globe, GraduationCap, Briefcase,
  Mail, Users, ClipboardList, TrendingUp, FileText, FileSearch,
  BookOpen, BarChart2, Database,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import config, { fetchWithTimeout } from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

type Profile = {
  placementScore: number;
  scoreReasoning: string;
  collegeTier: string;
  skills: string[];
  targetRole: string;
  college: string;
  branch: string;
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
      {
        path: "/skills",
        name: "Skill Gap Analysis",
        Icon: Zap,
        description:
          "Analyses job postings for your target role and shows exactly what skills are in demand. Get a prioritised list of must-learn skills with free resources — based on live job data, not AI guesses.",
      },
      {
        path: "/companies",
        name: "Company Matches",
        Icon: Building2,
        description:
          "See which companies are most likely to hire you based on your skill overlap, college tier, and CGPA. Match scores are computed from data — no AI involved.",
      },
      {
        path: "/roadmap",
        name: "90-Day Roadmap",
        Icon: MapIcon,
        description:
          "A personalised day-by-day preparation plan built around your college tier and target role. Follow it to systematically close your placement gaps in 90 days.",
      },
    ],
  },
  {
    label: "Find Opportunities",
    features: [
      {
        path: "/offcampus",
        name: "Off Campus Jobs",
        Icon: Globe,
        description:
          "Browse live off-campus job listings curated from multiple job boards for Indian engineering students. Apply directly without waiting for your college's placement cell.",
      },
      {
        path: "/oncampus",
        name: "On Campus Drives",
        Icon: GraduationCap,
        description:
          "Track upcoming on-campus placement drives and predict your eligibility for each company visiting your college. Know which drives to prepare for before they're announced.",
      },
      {
        path: "/internships",
        name: "Internships",
        Icon: Briefcase,
        description:
          "Find internship opportunities from live listings, AI-matched startups, and major structured programs like Google STEP and Goldman Sachs Insight. Filter by role, location, and stipend.",
      },
      {
        path: "/coldemail",
        name: "Cold Email",
        Icon: Mail,
        description:
          "Generate personalised cold emails to recruiters and hiring managers at companies not doing campus drives. AI writes the email based on your profile — you just send it.",
      },
      {
        path: "/referral",
        name: "Referral Radar",
        Icon: Users,
        description:
          "Find alumni and professionals at your target companies who are open to giving referrals. A single referral can multiply your chances of clearing the screening round.",
      },
    ],
  },
  {
    label: "Track & Prepare",
    features: [
      {
        path: "/tracker",
        name: "Application Tracker",
        Icon: ClipboardList,
        description:
          "Track every company you've applied to, the round you're in, and follow-up dates in one place. Never lose track of an application or miss a critical deadline again.",
      },
      {
        path: "/progress",
        name: "Progress Tracker",
        Icon: TrendingUp,
        description:
          "Add skills you want to learn, check them off as you complete them, and build a daily streak. See exactly how far along you are in your placement preparation.",
      },
      {
        path: "/pyq",
        name: "Previous Year Questions",
        Icon: FileText,
        description:
          "Practice company-specific aptitude and coding questions from previous placement seasons. Know exactly what TCS, Infosys, Amazon, and others actually ask in their drives.",
      },
      {
        path: "/resume",
        name: "Resume Analyser",
        Icon: FileSearch,
        description:
          "Upload your resume and get AI feedback on ATS compatibility, keyword gaps, and formatting issues. Know what recruiters see before sending your resume to any company.",
      },
      {
        path: "/resources",
        name: "Resources",
        Icon: BookOpen,
        description:
          "Curated free resources for DSA, aptitude, system design, and interview prep trusted by placed students across India. No affiliate links, no paid courses — all free.",
      },
    ],
  },
  {
    label: "Market & Research",
    features: [
      {
        path: "/market",
        name: "Market Intelligence",
        Icon: BarChart2,
        description:
          "Live hiring trends scraped from India's top job news sources every 24 hours. Skill and role counts are extracted directly from article text — no AI interpretation.",
      },
      {
        path: "/company-directory",
        name: "Company Directory",
        Icon: Database,
        description:
          "Browse detailed profiles of 50+ Indian tech companies with salary data, hiring patterns, and what skills they look for. Research a company thoroughly before you apply.",
      },
    ],
  },
];

const TIER_STYLES: Record<string, string> = {
  "Tier 1": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "Tier 2": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "Tier 3": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

const SOURCE_LINKS: Record<string, string> = {
  "NIRF 2024": "https://www.nirfindia.org/2024/EngineeringRanking.html",
  Shiksha: "https://www.shiksha.com",
  Careers360: "https://engineering.careers360.com",
};

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);
  const [backendSleeping, setBackendSleeping] = useState(false);
  const [liveScore, setLiveScore] = useState<LiveScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreTimedOut, setScoreTimedOut] = useState(false);
  const [skillGaps, setSkillGaps] = useState<SkillItem[] | null>(null);
  const [skillGapLoading, setSkillGapLoading] = useState(false);
  const [companyMatches, setCompanyMatches] = useState<Array<{ name: string; type: string }> | null>(null);
  const [companyCount, setCompanyCount] = useState(0);
  const [companyMatchLoading, setCompanyMatchLoading] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.email) return;

    // Primary: read from localStorage (source of truth)
    try {
      const stored = localStorage.getItem("placeiq_profile");
      if (stored) {
        setProfile(JSON.parse(stored));
        setProfileLoading(false);
        setProfileChecked(true);
        return;
      }
    } catch (e) { console.error('Dashboard error:', e) }

    // Fallback: fetch from backend and cache locally
    const email = encodeURIComponent(session.user.email);
    fetchWithTimeout(`${config.apiUrl}/api/user/profile/${email}`, {}, 30000)
      .then(res => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then(data => {
        if (data) localStorage.setItem("placeiq_profile", JSON.stringify(data));
        setProfile(data);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') setBackendSleeping(true);
        setProfile(null);
      })
      .finally(() => { setProfileLoading(false); setProfileChecked(true); });
  }, [status, session?.user?.email]);

  // Redirect to onboarding if no profile found after 2 seconds
  useEffect(() => {
    if (!profileChecked || profile) return;
    const timer = setTimeout(() => router.push('/onboarding'), 2000);
    return () => clearTimeout(timer);
  }, [profileChecked, profile]);

  // Fetch live score from backend (never use cached placementScore)
  useEffect(() => {
    if (!profile?.email) return;
    setScoreLoading(true);
    fetchWithTimeout(`${config.apiUrl}/api/placement/probability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: profile.email,
        college: profile.college,
        branch: profile.branch,
        year: "",
        cgpa: profile.cgpa,
        skills: (profile?.skills ?? []),
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
    }, 30000)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setLiveScore(data); })
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') {
          setScoreTimedOut(true);
        } else {
          console.error('Dashboard error:', e);
        }
      })
      .finally(() => setScoreLoading(false));
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    setSkillGapLoading(true);
    (async () => {
      try {
        const res = await fetchWithTimeout(`${config.apiUrl}/api/skills/gap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_role: profile.targetRole,
            skills: (profile?.skills ?? []),
            college_tier: profile.collegeTier,
            branch: profile.branch,
            cgpa: profile.cgpa,
          }),
        }, 30000);
        if (!res.ok) return;
        const parsed = await res.json();
        if (parsed && !parsed.error && Array.isArray(parsed.must_have_missing)) {
          setSkillGaps(parsed.must_have_missing.slice(0, 3));
        }
      } catch (e) {
        console.error('Dashboard error:', e)
      } finally {
        setSkillGapLoading(false);
      }
    })();
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    setCompanyMatchLoading(true);
    (async () => {
      try {
        const res = await fetchWithTimeout(`${config.apiUrl}/api/companies/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            college: profile.college,
            college_tier: profile.collegeTier,
            branch: profile.branch,
            cgpa: profile.cgpa,
            skills: (profile?.skills ?? []),
            target_role: profile.targetRole,
            projects_count: profile.projectsCount || "0",
            has_internship: profile.hasInternship || "no",
            internship_months: profile.internshipMonths || "",
            leetcode_count: profile.leetcodeCount || "0",
            hackathons: profile.hackathons || "0",
            github_active: profile.githubActive || "no",
          }),
        }, 30000);
        if (!res.ok) return;
        const parsed = await res.json();
        if (parsed && !parsed.error && Array.isArray(parsed.companies)) {
          setCompanyCount(parsed.companies.length);
          setCompanyMatches(
            parsed.companies
              .sort((a: { match_score: number }, b: { match_score: number }) => b.match_score - a.match_score)
              .slice(0, 3)
              .map((c: { name: string; type: string }) => ({ name: c.name, type: c.type }))
          );
        }
      } catch (e) {
        console.error('Dashboard error:', e)
      } finally {
        setCompanyMatchLoading(false);
      }
    })();
  }, [profile]);

  const displayScore = scoreTimedOut ? undefined : (liveScore?.score ?? profile?.placementScore);
  const displayTier = liveScore?.college_tier ?? profile?.collegeTier;

  if (status === "loading") return <LoadingScreen />;

  if (backendSleeping && !profile) return (
    <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4 px-6">
      <div className="max-w-md text-center">
        <p className="text-yellow-400 font-semibold text-lg mb-2">Backend is waking up</p>
        <p className="text-gray-400 text-sm mb-6">
          The server is starting up (Render free tier takes 30–60 seconds). Please wait and refresh.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-yellow-600/20 hover:bg-yellow-600/40 border border-yellow-500/30 text-yellow-300 px-6 py-2.5 rounded-lg text-sm font-medium transition"
        >
          Refresh page
        </button>
      </div>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">Welcome, {session?.user?.name?.split(" ")?.[0] ?? "there"}</h2>
        <p className="text-gray-400 mb-10">
          {profile ? `Targeting ${profile.targetRole} · ${profile.college}` : "Complete your profile to get your placement score."}
        </p>

        {/* Profile banner — shown briefly before 2s redirect fires */}
        {profileChecked && !profile && (
          <div className="bg-blue-600/10 border border-blue-500/30 rounded-xl px-5 py-3 flex items-center justify-between mb-6">
            <p className="text-sm text-gray-300">Complete your profile to get personalised insights</p>
            <button
              onClick={() => router.push('/onboarding')}
              className="shrink-0 ml-4 bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-1.5 rounded-lg font-medium transition"
            >
              Complete Profile →
            </button>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">

          {/* Placement Score Card */}
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-400 text-sm">Placement Score</p>
              {displayTier && (
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TIER_STYLES[displayTier] ?? "bg-gray-700/50 text-gray-400 border-gray-600"}`}>
                  {displayTier}
                </span>
              )}
            </div>

            {profileLoading || scoreLoading ? (
              <div className="h-10 w-16 bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-4xl font-bold text-blue-500">
                {displayScore !== undefined ? displayScore : "--"}
              </p>
            )}

            <p className="text-gray-600 text-xs mt-2">
              {profile ? "out of 100 · Predicted by ML model trained on NIRF data" : "Complete profile to unlock"}
            </p>
            {liveScore?.model_last_retrained && (
              <p className="text-gray-700 text-[10px] mt-1">
                Model last retrained:{" "}
                {new Date(liveScore.model_last_retrained).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}{" "}
                &mdash; retrains monthly
              </p>
            )}

            {/* Per-source placement rate — each source on its own line */}
            {liveScore && (liveScore.nirf_stats?.matched || (liveScore.sources?.length ?? 0) > 0) && (
              <div className="mt-3 pt-3 border-t border-gray-800 space-y-1.5">
                {liveScore.nirf_stats?.matched && liveScore.nirf_stats.placement_rate != null && (
                  <div className="flex items-center justify-between">
                    <a
                      href="https://www.nirfindia.org/2024/EngineeringRanking.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-400 hover:text-blue-300 underline underline-offset-2"
                    >
                      NIRF 2024
                    </a>
                    <span className="text-[11px] text-gray-300 font-medium">{liveScore.nirf_stats.placement_rate}%</span>
                  </div>
                )}
                {(liveScore.sources ?? []).map((src, i) => src.placement_rate != null && (
                  <div key={i} className="flex items-center justify-between">
                    <a
                      href={src.url || SOURCE_LINKS[src.source_name] || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-400 hover:text-blue-300 underline underline-offset-2"
                    >
                      {src.source_name}{src.year ? ` (${src.year})` : ""}
                    </a>
                    <span className="text-[11px] text-gray-300 font-medium">{src.placement_rate}%</span>
                  </div>
                ))}
                <p className="text-[10px] text-gray-600 pt-0.5">Placement data · 2024 · All sources · Score predicted by XGBoost trained on NIRF data</p>
              </div>
            )}
          </div>

          {/* Score reasoning — spans full width, below the 3-card row */}
          {!profileLoading && profile?.scoreReasoning && (
            <div className="md:col-span-3 bg-blue-600/5 border border-blue-500/20 rounded-2xl px-6 py-4">
              <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">ML Score Analysis</p>
              <p className="text-gray-300 text-sm leading-relaxed">{profile.scoreReasoning}</p>
              <p className="text-xs text-gray-700 mt-2">Predicted by ML model trained on NIRF placement data</p>
            </div>
          )}

          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-400 text-sm">Top Skill Gaps</p>
              {profile && (
                <button
                  onClick={() => router.push("/skills")}
                  className="text-xs text-blue-400 hover:text-blue-300 transition"
                >
                  View all &rarr;
                </button>
              )}
            </div>
            {profileLoading || skillGapLoading ? (
              <div className="space-y-2.5 mt-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-3.5 bg-gray-800 rounded animate-pulse" style={{ width: `${75 - i * 10}%` }} />
                ))}
              </div>
            ) : !profile ? (
              <>
                <p className="text-4xl font-bold text-gray-700">--</p>
                <p className="text-gray-600 text-xs mt-2">Complete profile to unlock</p>
              </>
            ) : skillGaps && skillGaps.length > 0 ? (
              <ul className="space-y-2 mt-1">
                {skillGaps.map((gap, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-red-500 shrink-0">!</span>
                    <span className="text-gray-300 truncate">{gap.skill}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-green-400 text-sm font-medium mt-1">No critical gaps found</p>
            )}
          </div>

          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-2">Skills Listed</p>
            {profileLoading ? (
              <div className="h-10 w-16 bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-4xl font-bold text-yellow-500">
                {profile ? (profile?.skills?.length ?? 0) : "--"}
              </p>
            )}
            <p className="text-gray-600 text-xs mt-2">
              {profile ? "skills on your profile" : "Complete profile to unlock"}
            </p>
          </div>

          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-400 text-sm">Company Matches</p>
              {profile && (
                <button
                  onClick={() => router.push("/companies")}
                  className="text-xs text-blue-400 hover:text-blue-300 transition"
                >
                  View all &rarr;
                </button>
              )}
            </div>
            {profileLoading || companyMatchLoading ? (
              <div className="space-y-2.5 mt-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-3.5 bg-gray-800 rounded animate-pulse" style={{ width: `${80 - i * 12}%` }} />
                ))}
              </div>
            ) : !profile ? (
              <>
                <p className="text-4xl font-bold text-gray-700">--</p>
                <p className="text-gray-600 text-xs mt-2">Complete profile to unlock</p>
              </>
            ) : companyMatches && companyMatches.length > 0 ? (
              <>
                <p className="text-4xl font-bold text-green-500 mb-2">{companyCount}</p>
                <ul className="space-y-1.5">
                  {companyMatches.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
                        c.type === "Product"
                          ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                          : c.type === "Startup"
                          ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
                          : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                      }`}>
                        {c.type?.[0]}
                      </span>
                      <span className="text-gray-300 truncate">{c.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-gray-500 text-sm mt-1">No matches found</p>
            )}
          </div>
        </div>

        {/* Multi-source placement data panel */}
        {!profileLoading && profile && liveScore && (liveScore.nirf_stats?.matched || (liveScore.sources?.length ?? 0) > 0) && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-sm">Placement Data Sources</h3>
                <p className="text-gray-500 text-xs mt-0.5">{profile.college}</p>
              </div>
              {liveScore.num_sources > 1 && (
                <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">
                  avg {liveScore.combined_base}% across {liveScore.num_sources} sources
                </span>
              )}
            </div>

            <div className="space-y-2">
              {/* NIRF row */}
              {liveScore.nirf_stats?.matched && (
                <div className="flex items-center justify-between py-2.5 px-3 bg-gray-900/60 rounded-xl">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                      NIRF
                    </span>
                    <div>
                      <a
                        href="https://www.nirfindia.org/2024/EngineeringRanking.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-200 hover:text-white transition"
                      >
                        NIRF 2024
                      </a>
                      <p className="text-[11px] text-gray-600">Official govt ranking · Last updated: 2024</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">
                      {liveScore.nirf_stats.placement_rate != null ? `${liveScore.nirf_stats.placement_rate}%` : "—"}
                    </p>
                    {liveScore.nirf_stats.median_salary != null && (
                      <p className="text-[11px] text-gray-500">{liveScore.nirf_stats.median_salary} LPA median</p>
                    )}
                  </div>
                </div>
              )}

              {/* Shiksha / Careers360 rows */}
              {(liveScore.sources ?? []).map((src, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 px-3 bg-gray-900/60 rounded-xl">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
                      {src.source_name[0]}
                    </span>
                    <div>
                      <a
                        href={src.url || SOURCE_LINKS[src.source_name] || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-200 hover:text-white transition"
                      >
                        {src.source_name}
                      </a>
                      <p className="text-[11px] text-gray-600">
                        {src.year ? `${src.year} data` : "Placement report"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">
                      {src.placement_rate != null ? `${src.placement_rate}%` : "—"}
                    </p>
                    {src.median_salary != null && (
                      <p className="text-[11px] text-gray-500">{src.median_salary} LPA median</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA — only shown when no profile */}
        {!profileLoading && !profile && (
          <div className="bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <h3 className="text-xl font-bold mb-2">Complete your profile</h3>
            <p className="text-gray-400 mb-6">Tell us about your college, skills, and goals to get personalised insights.</p>
            <button
              onClick={() => router.push("/onboarding")}
              className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-medium transition"
            >
              Get Started →
            </button>
          </div>
        )}

        {/* Skills summary — shown when profile exists */}
        {!profileLoading && profile && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Your Skills</h3>
              <button
                onClick={() => router.push("/onboarding")}
                className="text-sm text-blue-400 hover:text-blue-300 transition"
              >
                Update profile →
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Array.isArray(profile?.skills) ? profile.skills : []).map(skill => (
                <span key={skill} className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* View Full Roadmap CTA */}
        {!profileLoading && profile && (
          <div className="mt-6 bg-[#111] border border-gray-800 rounded-2xl p-6 flex items-center justify-between">
            <div>
              <h3 className="font-semibold mb-1">Your 90-Day Prep Roadmap</h3>
              <p className="text-gray-400 text-sm">
                Personalised daily plan to get placed at your target companies.
              </p>
            </div>
            <button
              onClick={() => router.push("/roadmap")}
              className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              View Roadmap →
            </button>
          </div>
        )}

        {/* ── Feature Overview ──────────────────────────────────────────── */}
        <div className="mt-16 mb-4">
          <h2 className="text-2xl font-bold mb-1">Explore PlaceIQ</h2>
          <p className="text-gray-400 mb-10">Everything you need for placements in one place.</p>

          <div className="space-y-10">
            {FEATURE_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-4">
                  {group.label}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.features.map(({ path, name, Icon, description }) => (
                    <div
                      key={path}
                      onClick={() => router.push(path)}
                      className="bg-[#111] border border-gray-800 rounded-xl p-5 hover:border-blue-500/50 hover:bg-[#161616] transition-all cursor-pointer flex flex-col"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                          <Icon size={15} />
                        </div>
                        <h4 className="font-semibold text-white text-sm leading-snug">{name}</h4>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed flex-1">{description}</p>
                      <p className="text-xs text-blue-400 font-medium mt-3">Open →</p>
                    </div>
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
