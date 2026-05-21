"use client";
import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────

type TrendingSkill = {
  skill: string;
  demand_score: number;
  trend: "rising" | "stable" | "falling";
  avg_salary_lpa: number;
  job_count: number;
  why_trending?: string;
  top_companies?: string[];
};

type RoleDemand = {
  role: string;
  openings: number;
  avg_lpa: number;
  yoy_change: string;
  top_companies?: string[];
  key_skills?: string[];
  reality_check?: string;
};

type CityData = {
  city: string;
  avg_lpa: number;
  cost_of_living: "High" | "Medium" | "Low";
  best_for_roles: string[];
};

type Sector = {
  sector: string;
  status: "Booming" | "Stable" | "Slow";
  reason: string;
};

type SkillToAvoid = {
  skill: string;
  reason: string;
};

type MarketData = {
  trending_skills: TrendingSkill[];
  role_demand: RoleDemand[];
  top_hiring_companies: string[];
  salary_by_city: CityData[];
  hot_sectors: Sector[];
  skills_to_avoid: SkillToAvoid[];
  market_summary: string;
  data_freshness: string;
};

type MarketPayload = {
  timestamp: string;
  data: MarketData;
  meta: {
    total_jobs: number;
    role_counts: Record<string, number>;
  };
};

// ── Sub-components ─────────────────────────────────────────────────────────

function DemandBar({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-xs text-gray-500">Demand Score</span>
        <span
          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-700 text-gray-600 text-[9px] cursor-help leading-none shrink-0"
          title="Score out of 100 based on frequency in live Indian job postings. Higher = more employers are actively looking for this skill right now."
        >
          ?
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.min(score, 100)}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-xs font-bold w-6 text-right shrink-0" style={{ color }}>
          {score}
        </span>
      </div>
      <p className="text-[10px] text-gray-700 mt-1 leading-tight">
        Based on job posting frequency across 450+ live Indian listings from Adzuna
      </p>
    </div>
  );
}

function TrendBadge({ trend }: { trend: TrendingSkill["trend"] }) {
  if (trend === "rising")
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/15 text-green-400 border-green-500/30 font-medium">
        ↑ Rising
      </span>
    );
  if (trend === "falling")
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border bg-red-500/15 text-red-400 border-red-500/30 font-medium">
        ↓ Falling
      </span>
    );
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-700/50 text-gray-400 border-gray-600 font-medium">
      → Stable
    </span>
  );
}

const SECTOR_STYLES: Record<Sector["status"], string> = {
  Booming: "bg-green-500/15 text-green-400 border-green-500/30",
  Stable: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  Slow: "bg-red-500/15 text-red-400 border-red-500/30",
};

const COL_STYLES: Record<CityData["cost_of_living"], string> = {
  High: "bg-red-500/15 text-red-400 border-red-500/30",
  Medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  Low: "bg-green-500/15 text-green-400 border-green-500/30",
};

function Tag({ label, color = "blue" }: { label: string; color?: "blue" | "gray" | "purple" }) {
  const cls =
    color === "blue"
      ? "bg-blue-500/15 text-blue-400 border-blue-500/25"
      : color === "purple"
      ? "bg-purple-500/15 text-purple-400 border-purple-500/25"
      : "bg-gray-700/50 text-gray-400 border-gray-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function MarketPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [payload, setPayload] = useState<MarketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (status === "authenticated") fetchData();
  }, [status]);

  const fetchData = async (url = "http://localhost:8000/api/market/intelligence") => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch market data");
      const json = await res.json();
      setPayload(json);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not load market data. Make sure the backend is running."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const forceRefresh = async () => {
    if (!window.confirm("This will fetch fresh data from Adzuna and regenerate the analysis. It may take ~30 seconds. Continue?"))
      return;
    setRefreshing(true);
    await fetchData("http://localhost:8000/api/market/refresh");
  };

  const data = payload?.data;
  const meta = payload?.meta;

  // Format timestamp
  const freshAt = payload?.timestamp
    ? new Date(payload.timestamp).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }) + " IST"
    : null;

  if (status === "loading")
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1
            className="text-xl font-bold cursor-pointer"
            onClick={() => router.push("/dashboard")}
          >
            Place<span className="text-blue-500">IQ</span>
          </h1>
          <div className="flex gap-6">
            <button onClick={() => router.push("/dashboard")} className="text-sm text-gray-400 hover:text-white transition">
              Dashboard
            </button>
            <button onClick={() => router.push("/skills")} className="text-sm text-gray-400 hover:text-white transition">
              Skill Gap
            </button>
            <button onClick={() => router.push("/companies")} className="text-sm text-gray-400 hover:text-white transition">
              Companies
            </button>
            <button onClick={() => router.push("/roadmap")} className="text-sm text-gray-400 hover:text-white transition">
              Roadmap
            </button>
            <button className="text-sm text-white border-b border-blue-500 pb-0.5">
              Market
            </button>
            <button onClick={() => router.push("/resume")} className="text-sm text-gray-400 hover:text-white transition">
              Resume Analyser
            </button>
            <button onClick={() => router.push("/tracker")} className="text-sm text-gray-400 hover:text-white transition">
              Tracker
            </button>
            <button onClick={() => router.push("/company-directory")} className="text-sm text-gray-400 hover:text-white transition">
              Directory
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <img src={session?.user?.image || ""} className="w-8 h-8 rounded-full" alt="" />
          <span className="text-gray-400 text-sm">{session?.user?.name}</span>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-sm text-gray-500 hover:text-white transition">
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-8 py-10">

        {/* Page header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold">Market Intelligence</h2>
          <p className="text-gray-400 mt-2">
            Live Indian job market trends for 2026 — powered by real Adzuna listings.
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="mt-24 flex flex-col items-center gap-6">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Analysing Indian job market trends for 2026...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-950/30 border border-red-500/25 rounded-2xl p-6 text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button onClick={() => fetchData()} className="border border-gray-700 text-gray-400 hover:text-white px-4 py-2 rounded-lg text-sm transition">
              Try again
            </button>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-10">

            {/* ── 1. Market Summary ──────────────────────────────────────── */}
            <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl px-6 py-5">
              <div className="flex items-center gap-3 mb-3">
                <p className="text-xs text-blue-400 uppercase tracking-widest font-semibold">Market Summary</p>
                <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/15 text-green-400 border-green-500/30 font-medium">
                  ● Live data from Adzuna API
                </span>
                {meta && (
                  <span className="text-xs text-gray-600">
                    {meta.total_jobs.toLocaleString()} jobs analysed
                  </span>
                )}
              </div>
              <p className="text-gray-300 leading-relaxed">{data.market_summary}</p>
            </div>

            {/* ── 2. Trending Skills ─────────────────────────────────────── */}
            <section>
              <h3 className="text-xl font-semibold mb-4">Trending Skills</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(data.trending_skills ?? []).map((s) => (
                  <div key={s.skill} className="bg-[#111] border border-gray-800 rounded-2xl p-5 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-white">{s.skill}</p>
                      <TrendBadge trend={s.trend} />
                    </div>
                    <DemandBar score={s.demand_score} />
                    {s.why_trending && (
                      <p className="text-xs text-gray-500 leading-relaxed mt-1">{s.why_trending}</p>
                    )}
                    <div className="flex items-center justify-between mt-auto pt-2">
                      <span className="text-xs text-gray-600">
                        ~{s.job_count?.toLocaleString()} jobs · ₹{s.avg_salary_lpa}L avg
                      </span>
                    </div>
                    {s.top_companies && s.top_companies.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {s.top_companies.slice(0, 3).map((c) => (
                          <Tag key={c} label={c} color="blue" />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* ── 3. Hottest Roles ───────────────────────────────────────── */}
            <section>
              <h3 className="text-xl font-semibold mb-4">Hottest Roles</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(data.role_demand ?? []).map((r) => (
                  <div key={r.role} className="bg-[#111] border border-gray-800 rounded-2xl p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-white">{r.role}</p>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium ${
                        r.yoy_change?.startsWith("+")
                          ? "bg-green-500/15 text-green-400 border-green-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30"
                      }`}>
                        {r.yoy_change} YoY
                      </span>
                    </div>
                    <div className="flex items-end gap-1">
                      <p className="text-3xl font-bold text-blue-400">₹{r.avg_lpa}L</p>
                      <p className="text-gray-500 text-sm mb-0.5">avg package</p>
                    </div>
                    <p className="text-gray-600 text-xs">{r.openings?.toLocaleString()} active openings</p>
                    {r.top_companies && r.top_companies.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {r.top_companies.slice(0, 4).map((c) => (
                          <Tag key={c} label={c} color="gray" />
                        ))}
                      </div>
                    )}
                    {r.key_skills && r.key_skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {r.key_skills.slice(0, 5).map((sk) => (
                          <Tag key={sk} label={sk} color="purple" />
                        ))}
                      </div>
                    )}
                    {r.reality_check && (
                      <p className="text-xs text-red-400/80 italic leading-relaxed border-t border-gray-800 pt-2 mt-1">
                        {r.reality_check}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* ── 4. Salary by City ─────────────────────────────────────── */}
            {data.salary_by_city && data.salary_by_city.length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-4">Salary by City</h3>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {data.salary_by_city.map((city) => (
                    <div
                      key={city.city}
                      className="shrink-0 bg-[#111] border border-gray-800 rounded-2xl p-5 w-52 flex flex-col gap-2"
                    >
                      <p className="font-semibold text-white">{city.city}</p>
                      <p className="text-2xl font-bold text-green-400">₹{city.avg_lpa}L</p>
                      <p className="text-xs text-gray-500">avg fresher package</p>
                      <span className={`self-start text-xs px-2 py-0.5 rounded-full border font-medium ${COL_STYLES[city.cost_of_living] ?? COL_STYLES.Medium}`}>
                        {city.cost_of_living} cost
                      </span>
                      {city.best_for_roles && city.best_for_roles.length > 0 && (
                        <div className="flex flex-col gap-1 mt-1">
                          <p className="text-xs text-gray-600">Best for:</p>
                          {city.best_for_roles.slice(0, 2).map((role) => (
                            <p key={role} className="text-xs text-gray-400">{role}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── 5. Hot Sectors ────────────────────────────────────────── */}
            {data.hot_sectors && data.hot_sectors.length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-4">Hot Sectors</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.hot_sectors.map((s) => (
                    <div key={s.sector} className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-white">{s.sector}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${SECTOR_STYLES[s.status] ?? SECTOR_STYLES.Stable}`}>
                          {s.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">{s.reason}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── 6. Skills to Avoid ────────────────────────────────────── */}
            {data.skills_to_avoid && data.skills_to_avoid.length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-4">Skills to Avoid</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.skills_to_avoid.map((s) => (
                    <div
                      key={s.skill}
                      className="bg-red-950/20 border border-red-500/20 rounded-2xl p-5"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-red-500 font-bold text-lg leading-none">!</span>
                        <p className="font-semibold text-red-300">{s.skill}</p>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">{s.reason}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-800">
              <p className="text-xs text-gray-600">
                Data refreshes every 24 hours from live Adzuna job listings.
                {freshAt && <span> Last updated: {freshAt}.</span>}
              </p>
              <button
                onClick={forceRefresh}
                disabled={refreshing}
                className="shrink-0 border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-xs transition"
              >
                {refreshing ? "Refreshing..." : "Force Refresh"}
              </button>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
