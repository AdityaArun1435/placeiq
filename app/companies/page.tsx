"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import config from '@/lib/config'

type Company = {
  name: string;
  type: "Service" | "Product" | "Startup";
  match_score: number;
  cgpa_cutoff: string;
  visits_college_tier: string;
  likely_to_visit: boolean;
  hiring_mode: "On Campus" | "Off Campus" | "Both";
  role_offered: string;
  package_range: string;
  why_match: string;
  biggest_gap: string;
  apply_link: string;
};

type CompanyMatchResult = {
  companies: Company[];
  summary: string;
};

type StoredProfile = {
  college: string;
  college_tier: string;
  branch: string;
  cgpa: number;
  skills: string[];
  target_role: string;
  projects_count: string;
  has_internship: string;
  internship_months: string;
  leetcode_count: string;
  hackathons: string;
  github_active: string;
};

const TYPE_STYLES: Record<string, string> = {
  Service: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Product: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  Startup: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const HIRING_STYLES: Record<string, string> = {
  "On Campus": "bg-green-500/15 text-green-400 border-green-500/30",
  "Off Campus": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  Both: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function parseLPA(range: string): number {
  const m = (range ?? "").match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseCGPACutoff(cutoff: string): number {
  if (!cutoff || /no cutoff/i.test(cutoff)) return 0;
  const m = cutoff.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : 0;
}

const SELECT_CLS =
  "bg-[#111] border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 cursor-pointer";

function scoreColor(score: number) {
  return score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
}

function MatchBar({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-bold w-7 text-right" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

function CompanyCard({ company }: { company: Company }) {
  const isValidUrl = company.apply_link?.startsWith("http");
  return (
    <div className="bg-[#111] border border-gray-800 hover:border-gray-700 rounded-2xl p-5 flex flex-col gap-3 transition">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-white text-base leading-tight truncate">
            {company.name}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                TYPE_STYLES[company.type] ?? "bg-gray-700/50 text-gray-400 border-gray-600"
              }`}
            >
              {company.type}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                HIRING_STYLES[company.hiring_mode] ?? "bg-gray-700/50 text-gray-400 border-gray-600"
              }`}
            >
              {company.hiring_mode}
            </span>
            {!company.likely_to_visit && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-700/30 text-gray-500 border-gray-700">
                Off-campus only
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Match score label + bar + tooltip */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-gray-600 text-xs">Match Score</span>
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-700 text-gray-600 text-[9px] cursor-help leading-none"
            title="Computed from your skill overlap with this company's requirements, your college tier, and CGPA. 70+ = strong match, 50-70 = possible with effort, below 50 = stretch goal."
          >
            ?
          </span>
        </div>
        <MatchBar score={company.match_score} />
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <p className="text-gray-600 text-xs mb-0.5">Package</p>
          <p className="text-gray-200 font-medium text-xs">{company.package_range}</p>
        </div>
        <div>
          <p className="text-gray-600 text-xs mb-0.5">CGPA Cutoff</p>
          <p className="text-gray-200 font-medium text-xs">{company.cgpa_cutoff}</p>
        </div>
        <div>
          <p className="text-gray-600 text-xs mb-0.5">Role</p>
          <p className="text-gray-200 font-medium text-xs truncate">{company.role_offered}</p>
        </div>
        <div>
          <p className="text-gray-600 text-xs mb-0.5">Campus Reach</p>
          <p className="text-gray-200 font-medium text-xs">{company.visits_college_tier}</p>
        </div>
      </div>

      {/* Why match / gap */}
      <div className="space-y-1.5">
        <p className="text-green-400 text-xs leading-relaxed">+ {company.why_match}</p>
        <p className="text-red-400 text-xs leading-relaxed">- {company.biggest_gap}</p>
      </div>

      {/* Apply */}
      {isValidUrl ? (
        <a
          href={company.apply_link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto block text-center bg-blue-600/15 hover:bg-blue-600/30 border border-blue-500/25 text-blue-300 text-sm py-2 rounded-xl transition"
        >
          Apply &rarr;
        </a>
      ) : (
        <button
          disabled
          className="mt-auto block w-full text-center bg-gray-800/50 border border-gray-700 text-gray-600 text-sm py-2 rounded-xl cursor-not-allowed"
        >
          Apply
        </button>
      )}
    </div>
  );
}

export default function Companies() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasFetched = useRef(false);

  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [result, setResult] = useState<CompanyMatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [hiringFilter, setHiringFilter] = useState("All");
  const [scoreFilter, setScoreFilter] = useState("All");
  const [packageFilter, setPackageFilter] = useState("All");
  const [sortBy, setSortBy] = useState("score");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("placeiq_profile");
      if (stored) {
        const p = JSON.parse(stored);
        setProfile({
          college: p.college || "",
          college_tier: p.collegeTier || "",
          branch: p.branch || "",
          cgpa: Number(p.cgpa) || 0,
          skills: Array.isArray(p.skills) ? p.skills : [],
          target_role: p.targetRole || "",
          projects_count: p.projectsCount || "0",
          has_internship: p.hasInternship || "no",
          internship_months: p.internshipMonths || "",
          leetcode_count: p.leetcodeCount || "0",
          hackathons: p.hackathons || "0",
          github_active: p.githubActive || "no",
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (profile && !hasFetched.current) {
      hasFetched.current = true;
      fetchMatches(profile);
    }
  }, [profile]);

  const fetchMatches = async (p: StoredProfile) => {
    // Serve from cache unless this is an explicit refresh
    try {
      const cached = localStorage.getItem("placeiq_companies");
      if (cached) {
        setResult(JSON.parse(cached));
        return;
      }
    } catch {}

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch(`${config.apiUrl}/api/companies/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to fetch company matches");
      }

      const parsed = await res.json();
      if (!parsed) {
        setError("No response from server. Please try again.");
        return;
      }
      if (parsed.error) {
        setError(parsed.error);
        return;
      }

      const newResult = {
        companies: (parsed.companies || []).map((c: Partial<Company>) => ({
          ...c,
          match_score: Math.max(0, Math.min(100, Number(c.match_score) || 0)),
          must_have_missing: [],
        })),
        summary: parsed.summary || "",
      };
      setResult(newResult);
      try { localStorage.setItem("placeiq_companies", JSON.stringify(newResult)); } catch {}
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Analysis failed. Make sure the backend is running."
      );
    } finally {
      setLoading(false);
    }
  };

  const reAnalyse = () => {
    if (!profile) return;
    if (
      !window.confirm(
        "Are you sure? This will replace your current company matches and cannot be undone."
      )
    )
      return;
    localStorage.removeItem("placeiq_companies");
    hasFetched.current = false;
    fetchMatches(profile);
  };

  const clearFilters = () => {
    setTypeFilter("All");
    setHiringFilter("All");
    setScoreFilter("All");
    setPackageFilter("All");
    setSortBy("score");
  };

  const hasActiveFilters =
    typeFilter !== "All" || hiringFilter !== "All" ||
    scoreFilter !== "All" || packageFilter !== "All" || sortBy !== "score";

  const displayed = (result?.companies ?? [])
    .filter(c => {
      if (typeFilter !== "All" && c.type !== typeFilter) return false;
      if (hiringFilter !== "All") {
        if (hiringFilter === "Both" && c.hiring_mode !== "Both") return false;
        if (hiringFilter === "On Campus" && c.hiring_mode !== "On Campus" && c.hiring_mode !== "Both") return false;
        if (hiringFilter === "Off Campus" && c.hiring_mode !== "Off Campus" && c.hiring_mode !== "Both") return false;
      }
      if (scoreFilter === "70+" && c.match_score < 70) return false;
      if (scoreFilter === "50-70" && (c.match_score < 50 || c.match_score >= 70)) return false;
      if (scoreFilter === "<50" && c.match_score >= 50) return false;
      if (packageFilter !== "All") {
        const lpa = parseLPA(c.package_range);
        if (packageFilter === "<5" && lpa >= 5) return false;
        if (packageFilter === "5-10" && (lpa < 5 || lpa >= 10)) return false;
        if (packageFilter === "10-20" && (lpa < 10 || lpa >= 20)) return false;
        if (packageFilter === "20+" && lpa < 20) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "score") return b.match_score - a.match_score;
      if (sortBy === "package") return parseLPA(b.package_range) - parseLPA(a.package_range);
      if (sortBy === "cgpa") return parseCGPACutoff(a.cgpa_cutoff) - parseCGPACutoff(b.cgpa_cutoff);
      return 0;
    });

  if (status === "loading")
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-3xl font-bold">Company Match List</h2>
            <p className="text-gray-400 mt-2">
              Matched by skills and college tier against 15 companies in the Indian job market.
              {profile?.target_role && (
                <span className="text-blue-400"> Role: {profile.target_role}</span>
              )}
            </p>
          </div>
          {result && !loading && (
            <button
              onClick={reAnalyse}
              className="shrink-0 border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white px-4 py-2 rounded-lg text-sm transition"
            >
              Refresh Matches
            </button>
          )}
        </div>

        {/* No profile */}
        {!profile && !loading && (
          <div className="mt-10 bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <p className="text-gray-300 mb-4">
              Complete your profile to get personalised company matches.
            </p>
            <button
              onClick={() => router.push("/onboarding")}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              Complete Profile
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-24 flex flex-col items-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-6" />
            <p className="text-gray-400 text-sm">Finding your best company matches...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mt-6 bg-red-950/40 border border-red-500/25 rounded-xl p-5">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={reAnalyse}
              className="mt-3 text-xs text-red-300 hover:text-white underline transition"
            >
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="mt-8">
            {/* Summary */}
            {result.summary && (
              <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl px-6 py-4 mb-8">
                <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">
                  Strategy
                </p>
                <p className="text-gray-300 text-sm leading-relaxed">{result.summary}</p>
              </div>
            )}

            {/* Filter bar */}
            <div className="flex flex-wrap gap-3 items-center mb-3">
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className={SELECT_CLS}
                style={{ colorScheme: "dark" }}
              >
                <option value="All">All Types</option>
                <option value="Service">Service</option>
                <option value="Product">Product</option>
                <option value="Startup">Startup</option>
              </select>

              <select
                value={hiringFilter}
                onChange={e => setHiringFilter(e.target.value)}
                className={SELECT_CLS}
                style={{ colorScheme: "dark" }}
              >
                <option value="All">All Hiring Modes</option>
                <option value="On Campus">On Campus</option>
                <option value="Off Campus">Off Campus</option>
                <option value="Both">Both</option>
              </select>

              <select
                value={scoreFilter}
                onChange={e => setScoreFilter(e.target.value)}
                className={SELECT_CLS}
                style={{ colorScheme: "dark" }}
              >
                <option value="All">All Match Scores</option>
                <option value="70+">Strong Match (70+)</option>
                <option value="50-70">Possible (50–70)</option>
                <option value="<50">Stretch (&lt;50)</option>
              </select>

              <select
                value={packageFilter}
                onChange={e => setPackageFilter(e.target.value)}
                className={SELECT_CLS}
                style={{ colorScheme: "dark" }}
              >
                <option value="All">All Packages</option>
                <option value="<5">Below 5 LPA</option>
                <option value="5-10">5–10 LPA</option>
                <option value="10-20">10–20 LPA</option>
                <option value="20+">20+ LPA</option>
              </select>

              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className={SELECT_CLS}
                style={{ colorScheme: "dark" }}
              >
                <option value="score">Sort: Match Score ↓</option>
                <option value="package">Sort: Package ↓</option>
                <option value="cgpa">Sort: CGPA Cutoff ↑</option>
              </select>

              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-lg transition"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Results count */}
            <p className="text-gray-600 text-sm mb-5">
              Showing {displayed.length} of {result.companies.length} companies
            </p>

            {/* Company grid */}
            {displayed.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayed.map((company, i) => (
                  <CompanyCard key={`${company.name}-${i}`} company={company} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-gray-600">
                No companies match the selected filters.{" "}
                <button
                  onClick={clearFilters}
                  className="text-blue-500 hover:text-blue-400 underline"
                >
                  Clear filters
                </button>
              </div>
            )}
            <p className="text-xs text-gray-700 text-center mt-6 pb-2">
              Match scores computed from skill overlap, college tier, and CGPA · No AI involved
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
