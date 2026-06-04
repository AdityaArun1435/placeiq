"use client";
import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList,
} from "recharts";

type Article = {
  title: string;
  summary: string;
  source_name: string;
  source_url: string;
  published_date: string;
  scraped_at: string;
};

type TrendingSkill = {
  skill: string;
  article_count: number;
  sample_article_title?: string;
  sample_article_url?: string;
};

type HotRole = { role: string; article_count: number };
type HiringCompany = { company: string; context: string };
type TrendingCity = { city: string; reason: string };

type Insights = {
  trending_skills: TrendingSkill[];
  hot_roles: HotRole[];
  hiring_companies: HiringCompany[];
  trending_cities: TrendingCity[];
  is_ai_estimate: boolean;
};

type NewsPayload = {
  scraped_at: string;
  articles: Article[];
  insights: Insights;
  scrape_success: boolean;
};

type CtcTrend = { year: string; avg_ctc: number; record_count: number };
type TopCompany = { company_name: string; total_headcount: number; colleges_visited: number };
type PlacementMarket = {
  companies: TopCompany[];
  total_records: number;
  total_colleges: number;
};

type TopRole = { role_profile: string; total_headcount: number; record_count: number };
type TierBreakdown = { category_tier: string; company_count: number };
type MarketRole = {
  role_name: string;
  demand_level: number;
  yoy_growth_percent: number;
  avg_salary_lpa: number;
  top_hiring_companies: string[];
};
type TopRolesData = {
  campus_roles: TopRole[];
  market_roles: MarketRole[];
  tier_breakdown: TierBreakdown[];
  total_records: number;
  total_colleges: number;
};

const TIER_COLORS: Record<string, string> = {
  "Tier 1 Elite": "#F59E0B",
  "Super Dream": "#8B5CF6",
  "Core Tech": "#3B82F6",
  "Bulk IT": "#6B7280",
  "Consulting": "#06B6D4",
  "FinTech / BFSI": "#10B981",
  "Govt / PSU": "#EF4444",
  "Other": "#374151",
};

function groupTier(tier: string): string {
  const t = tier.toLowerCase();
  if (t.includes("tier 1") || t.includes("tier1") || t.includes("elite")) return "Tier 1 Elite";
  if (t.includes("super dream")) return "Super Dream";
  if (
    t.includes("core") ||
    t.includes("product mnc") ||
    t.includes("product fintech") ||
    t.includes("product – indian") ||
    t.includes("product - indian") ||
    t.includes("differential")
  ) return "Core Tech";
  if (t.includes("bulk") || t.includes("day 1") || t.includes("day 2") || t.includes("level 5")) return "Bulk IT";
  if (t.includes("consulting") || t.includes("deloitte") || t.includes("analytics")) return "Consulting";
  if (t.includes("fintech") || t.includes("finance") || t.includes("quant") || t.includes("hft") || t.includes("banking") || t.includes("bfsi")) return "FinTech / BFSI";
  if (t.includes("government") || t.includes("psu")) return "Govt / PSU";
  return "Other";
}

export default function MarketPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [ctcTrends, setCtcTrends] = useState<CtcTrend[]>([]);
  const [placementMarket, setPlacementMarket] = useState<PlacementMarket | null>(null);
  const [placementLoading, setPlacementLoading] = useState(true);
  const [topRolesData, setTopRolesData] = useState<TopRolesData | null>(null);

  const [payload, setPayload] = useState<NewsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [userCity, setUserCity] = useState("");

  const groupedTiers = useMemo(() => {
    if (!topRolesData?.tier_breakdown?.length) return [];
    const map: Record<string, number> = {};
    for (const entry of topRolesData.tier_breakdown) {
      const bucket = groupTier(entry.category_tier);
      map[bucket] = (map[bucket] ?? 0) + entry.company_count;
    }
    return Object.entries(map)
      .map(([category_tier, company_count]) => ({ category_tier, company_count }))
      .sort((a, b) => b.company_count - a.company_count);
  }, [topRolesData]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    Promise.all([
      fetch("http://localhost:8000/api/placement/market/ctc-trends").then(r => r.ok ? r.json() : []),
      fetch("http://localhost:8000/api/placement/market/top-companies").then(r => r.ok ? r.json() : null),
      fetch("http://localhost:8000/api/placement/market/top-roles").then(r => r.ok ? r.json() : null),
    ]).then(([trends, market, roles]) => {
      setCtcTrends(trends);
      if (market) setPlacementMarket(market);
      if (roles) setTopRolesData(roles);
    }).catch(() => {}).finally(() => setPlacementLoading(false));
  }, [status]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchData();
      try {
        const raw = localStorage.getItem("placeiq_profile");
        if (raw) {
          const profile = JSON.parse(raw);
          if (profile.city) {
            setUserCity(profile.city);
            setCityFilter(profile.city);
          }
        }
      } catch {}
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchData(refresh = false) {
    setLoading(true);
    setError("");
    try {
      const url = refresh
        ? `${config.apiUrl}/api/market/news/refresh`
        : `${config.apiUrl}/api/market/news`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch market data");
      setPayload(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load market data. Make sure the backend is running.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function forceRefresh() {
    if (!window.confirm("This will re-scrape news sources and may take ~30 seconds. Continue?")) return;
    setRefreshing(true);
    await fetchData(true);
  }

  const insights = payload?.insights;
  const articles = payload?.articles ?? [];

  const freshAt = payload?.scraped_at
    ? new Date(payload.scraped_at).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }) + " IST"
    : null;

  const cityLower = cityFilter.trim().toLowerCase();

  const filteredCities = cityLower
    ? (insights?.trending_cities ?? []).filter(c => c.city.toLowerCase().includes(cityLower))
    : (insights?.trending_cities ?? []);

  const cityArticles = cityLower
    ? articles.filter(
        a =>
          a.title.toLowerCase().includes(cityLower) ||
          (a.summary && a.summary.toLowerCase().includes(cityLower))
      )
    : [];

  if (status === "loading") return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-primary-bg text-main">
      <div className="max-w-6xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold">Market Intelligence</h2>
            <p className="text-muted mt-1">
              Live hiring trends scraped from India&apos;s top job news sources
              {!insights?.is_ai_estimate && articles.length > 0 && freshAt && (
                <span className="text-faint ml-1">
                  · {articles.length} articles · scraped {freshAt}
                </span>
              )}
            </p>
          </div>
          {freshAt && (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs px-2.5 py-1 rounded-full border bg-green-500/10 text-green-400 border-green-500/20 font-medium">
                ● Updated {freshAt}
              </span>
              <button
                onClick={forceRefresh}
                disabled={refreshing}
                className="text-xs border border-theme text-muted hover:text-main hover:border-gray-500 px-3 py-1.5 rounded-lg transition disabled:opacity-40"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-muted text-sm">
              Scraping latest hiring news from India&apos;s job sources...
            </p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-950/30 border border-red-500/25 rounded-2xl p-6 text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => fetchData()}
              className="border border-theme text-muted hover:text-main px-4 py-2 rounded-lg text-sm transition"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Real Campus Placement Data Section ── */}
        {!placementLoading && (ctcTrends.length > 0 || placementMarket) && (
          <div className="space-y-6 mb-10">
            {placementMarket && (
              <p className="text-xs text-faint">
                Based on real campus placement data — {placementMarket.total_records} records across {placementMarket.total_colleges} colleges
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* CTC Trend Line Chart */}
              {ctcTrends.length > 0 && (
                <div className="bg-surface border border-theme rounded-2xl p-5">
                  <h3 className="text-base font-semibold mb-1">Average CTC Trend (2022–2024)</h3>
                  <p className="text-faint text-xs mb-4">Avg campus placement package across all colleges in our DB</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={ctcTrends} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="year" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8 }} labelStyle={{ color: "var(--text-primary)" }} itemStyle={{ color: "#60a5fa" }} />
                      <Line type="monotone" dataKey="avg_ctc" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 4 }} name="Avg CTC (LPA)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Top Companies Bar Chart */}
              {placementMarket && placementMarket.companies.length > 0 && (
                <div className="bg-surface border border-theme rounded-2xl p-5">
                  <h3 className="text-base font-semibold mb-1">Top Companies by Hiring Volume</h3>
                  <p className="text-faint text-xs mb-4">Total avg headcount across all campus visits</p>
                  <ResponsiveContainer width="100%" height={500}>
                    <BarChart
                      data={placementMarket.companies.slice(0, 10)}
                      layout="vertical"
                      margin={{ left: 20, right: 30, top: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="company_name"
                        tick={{ fill: "#9ca3af", fontSize: 11 }}
                        width={160}
                        tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 18) + "…" : v}
                      />
                      <Tooltip contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8 }} labelStyle={{ color: "var(--text-primary)" }} itemStyle={{ color: "#a855f7" }} />
                      <Bar dataKey="total_headcount" fill="#a855f7" radius={[0, 4, 4, 0]} name="Total Headcount" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Top Job Roles Section */}
            {topRolesData && (
              (topRolesData.campus_roles?.length > 0 ||
               topRolesData.tier_breakdown?.length > 0 ||
               topRolesData.market_roles?.length > 0)
            ) && (
              <div className="bg-surface border border-theme rounded-2xl p-5">
                <h3 className="text-base font-semibold mb-1">Top Job Roles Trending in India</h3>
                <p className="text-faint text-xs mb-5">
                  Based on {topRolesData.total_records} campus placement records across {topRolesData.total_colleges} colleges — updated from our placement database
                </p>

                <div className="space-y-10">
                  {/* Chart A — Campus Hiring Roles */}
                  {topRolesData.campus_roles?.length > 0 && (
                    <div>
                      <p className="text-xs text-faint uppercase tracking-widest mb-3">Campus Hiring Roles</p>
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart
                          data={topRolesData.campus_roles.slice(0, 10)}
                          layout="vertical"
                          margin={{ left: 20, right: 30, top: 10, bottom: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                          <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="role_profile"
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            width={200}
                            tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + "…" : v}
                          />
                          <Tooltip
                            contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--text-primary)" }}
                            itemStyle={{ color: "#3b82f6" }}
                          />
                          <Bar dataKey="total_headcount" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Total Headcount" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Chart B — Market Demand in India 2025 */}
                  {topRolesData.market_roles?.length > 0 && (
                    <div>
                      <p className="text-xs text-faint uppercase tracking-widest mb-3">Market Demand in India 2025</p>
                      <ResponsiveContainer width="100%" height={500}>
                        <BarChart
                          data={[...topRolesData.market_roles].sort((a, b) => b.demand_level - a.demand_level)}
                          layout="vertical"
                          margin={{ left: 20, right: 130, top: 10, bottom: 10 }}
                        >
                          <defs>
                            <linearGradient id="marketBarGrad" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#3B82F6" />
                              <stop offset="100%" stopColor="#8B5CF6" />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: "#9ca3af", fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="role_name"
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            width={220}
                          />
                          <Tooltip
                            contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--text-primary)" }}
                            itemStyle={{ color: "#8b5cf6" }}
                            formatter={(value, name) => [value, name === "demand_level" ? "Demand Level" : name]}
                          />
                          <Bar dataKey="demand_level" fill="url(#marketBarGrad)" radius={[0, 4, 4, 0]} name="demand_level">
                            <LabelList
                              dataKey="avg_salary_lpa"
                              position="right"
                              style={{ fill: "#6b7280", fontSize: 10 }}
                              formatter={(v: unknown) => `avg ${v ?? ""} LPA`}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <p className="text-xs text-faint mt-2 text-center">
                        Source: Live Indian job market analysis — updated every 48 hours
                      </p>
                    </div>
                  )}

                  {/* Pie chart — Hiring by Company Category */}
                  {groupedTiers.length > 0 && (
                    <div>
                      <p className="text-xs text-faint uppercase tracking-widest mb-3">Hiring by Company Category</p>
                      <ResponsiveContainer width="100%" height={380}>
                        <PieChart>
                          <Pie
                            data={groupedTiers}
                            dataKey="company_count"
                            nameKey="category_tier"
                            cx="50%"
                            cy="50%"
                            outerRadius={130}
                            labelLine={false}
                            label={({ percent }) =>
                              (percent ?? 0) > 0.05 ? `${((percent ?? 0) * 100).toFixed(0)}%` : ""
                            }
                          >
                            {groupedTiers.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={TIER_COLORS[entry.category_tier] ?? "#374151"} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--text-primary)" }}
                            formatter={(value, name) => [`${value} companies`, name]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      {/* Custom legend */}
                      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-3">
                        {(() => {
                          const total = groupedTiers.reduce((s, e) => s + e.company_count, 0);
                          return groupedTiers.map(entry => (
                            <div key={entry.category_tier} className="flex items-center gap-1.5 text-xs text-muted">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ background: TIER_COLORS[entry.category_tier] ?? "#374151" }}
                              />
                              <span>{entry.category_tier}</span>
                              <span className="text-faint">
                                {total > 0 ? ((entry.company_count / total) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {placementLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <div className="bg-surface border border-theme rounded-2xl p-5 animate-pulse h-64" />
            <div className="bg-surface border border-theme rounded-2xl p-5 animate-pulse h-64" />
          </div>
        )}

        {!loading && payload && (
          <div className="space-y-10">

            {/* Fallback estimate banner */}
            {insights?.is_ai_estimate && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl px-5 py-4">
                <p className="text-yellow-400 text-sm font-medium">
                  Estimated data — live scrape unavailable
                </p>
                <p className="text-yellow-300/70 text-xs mt-1">
                  News sources could not be scraped right now. Showing curated baseline data for Indian job market trends.
                </p>
              </div>
            )}

            {/* City filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm text-muted shrink-0">Filter by city:</label>
              <input
                value={cityFilter}
                onChange={e => setCityFilter(e.target.value)}
                placeholder={userCity || "e.g. Bangalore, Hyderabad..."}
                className="bg-surface border border-theme rounded-lg px-3 py-2 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition w-56"
              />
              {cityFilter && (
                <button
                  onClick={() => setCityFilter("")}
                  className="text-xs text-faint hover:text-main transition"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Trending This Week */}
            {(insights?.trending_skills ?? []).length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-1">Trending This Week</h3>
                <p className="text-faint text-sm mb-4">
                  Skills appearing most in recent Indian hiring news
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(insights?.trending_skills ?? []).slice(0, 10).map((s, i) => (
                    <div
                      key={s.skill}
                      className="bg-surface border border-theme rounded-2xl p-5"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-faint w-5 shrink-0">#{i + 1}</span>
                        <p className="font-semibold text-main">{s.skill}</p>
                      </div>
                      <p className="text-xs text-faint mb-2">
                        Mentioned in {s.article_count}{" "}
                        article{s.article_count !== 1 ? "s" : ""}
                      </p>
                      {s.sample_article_url && (
                        <a
                          href={s.sample_article_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 transition line-clamp-1"
                        >
                          {s.sample_article_title || "Read article →"}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Hottest Roles Right Now */}
            {(() => {
              const FALLBACK_ROLES = [
                { role: "ML Engineer", avg_salary: "15-28 LPA", demand: "Very High", why: "Generative AI adoption is driving massive demand across all sectors" },
                { role: "Software Engineer", avg_salary: "12-20 LPA", demand: "Very High", why: "Core engineering demand at startups and MNCs remains highest in India" },
                { role: "Data Scientist", avg_salary: "10-18 LPA", demand: "High", why: "Data-driven decisions are core to every Indian startup and enterprise" },
                { role: "Backend Developer", avg_salary: "10-20 LPA", demand: "Very High", why: "India's fintech and SaaS boom is driving non-stop backend hiring" },
                { role: "DevOps Engineer", avg_salary: "10-22 LPA", demand: "High", why: "Cloud migration across Indian enterprises is creating strong DevOps demand" },
                { role: "Product Manager", avg_salary: "14-25 LPA", demand: "High", why: "Product-led growth companies are aggressively hiring APMs from top colleges" },
              ];
              const DEMAND_STYLE: Record<string, string> = {
                "Very High": "bg-green-500/15 text-green-400 border-green-500/30",
                "High": "bg-blue-500/15 text-blue-400 border-blue-500/30",
                "Medium": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
              };
              const marketRoles = topRolesData?.market_roles ?? [];
              const displayRoles = marketRoles.length > 0
                ? marketRoles.slice(0, 6).map(r => ({
                    role: r.role_name,
                    avg_salary: r.avg_salary_lpa ? `${r.avg_salary_lpa} LPA` : "Market rate",
                    demand: r.demand_level >= 70 ? "Very High" : r.demand_level >= 40 ? "High" : "Medium",
                    why: `Demand score: ${r.demand_level}/100 · YoY growth: ${r.yoy_growth_percent > 0 ? "+" : ""}${r.yoy_growth_percent}%`,
                  }))
                : FALLBACK_ROLES;
              return (
                <section>
                  <h3 className="text-xl font-semibold mb-1">Hottest Roles Right Now</h3>
                  <p className="text-faint text-sm mb-4">
                    Most in-demand roles in India&apos;s tech job market — with avg salaries and demand indicators
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {displayRoles.map((r, i) => (
                      <div key={i} className="bg-surface border border-theme rounded-2xl p-5">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="font-bold text-main text-sm leading-snug">{r.role}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${DEMAND_STYLE[r.demand] ?? DEMAND_STYLE["Medium"]}`}>
                            {r.demand}
                          </span>
                        </div>
                        <p className="text-xs text-green-400 font-medium mb-2">{r.avg_salary}</p>
                        <p className="text-xs text-faint leading-relaxed">{r.why}</p>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* Companies Actively Hiring */}
            {(insights?.hiring_companies ?? []).length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-1">Companies Actively Hiring</h3>
                <p className="text-faint text-sm mb-4">
                  Companies mentioned in recent hiring or expansion news
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(insights?.hiring_companies ?? []).map((c, i) => (
                    <div
                      key={i}
                      className="bg-surface border border-theme rounded-xl px-5 py-4 flex items-center gap-4"
                    >
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-bold shrink-0">
                        {c.company[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-main text-sm">{c.company}</p>
                        <p className="text-xs text-faint mt-0.5 line-clamp-1">{c.context}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* In Your City */}
            {cityFilter && (filteredCities.length > 0 || cityArticles.length > 0) && (
              <section>
                <h3 className="text-xl font-semibold mb-1">In {cityFilter}</h3>
                <p className="text-faint text-sm mb-4">
                  What the news says about hiring in your city
                </p>
                {filteredCities.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    {filteredCities.map((c, i) => (
                      <div key={i} className="bg-surface border border-theme rounded-xl px-5 py-4">
                        <p className="font-medium text-main text-sm mb-1">{c.city}</p>
                        <p className="text-xs text-muted">{c.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
                {cityArticles.length > 0 && (
                  <div className="space-y-3">
                    {cityArticles.slice(0, 5).map((a, i) => (
                      <div
                        key={i}
                        className="bg-surface border border-theme rounded-xl px-5 py-4 flex items-start justify-between gap-4"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-main font-medium leading-snug mb-1">{a.title}</p>
                          <span className="text-xs text-faint">{a.source_name}</span>
                        </div>
                        {a.source_url && (
                          <a
                            href={a.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 transition shrink-0"
                          >
                            Read →
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Latest News */}
            {articles.length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-1">Latest News</h3>
                <p className="text-faint text-sm mb-4">
                  Most recent articles from Indian hiring news sources
                </p>
                <div className="space-y-3">
                  {articles.slice(0, 10).map((a, i) => (
                    <div
                      key={i}
                      className="bg-surface border border-theme rounded-xl px-5 py-4 flex items-start justify-between gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-main font-medium leading-snug mb-1.5">
                          {a.title}
                        </p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-faint">{a.source_name}</span>
                          {a.published_date && (
                            <span className="text-xs text-faint">{a.published_date}</span>
                          )}
                        </div>
                      </div>
                      {a.source_url && (
                        <a
                          href={a.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 transition shrink-0 font-medium"
                        >
                          Read →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-theme flex-wrap gap-3">
              <div>
                <p className="text-xs text-faint">
                  Live data from {articles.length} articles scraped from Economic Times, TimesJobs, YourStory, Naukri Blog, and LinkedIn Talent Blog.
                </p>
                {freshAt && (
                  <p className="text-xs text-faint mt-0.5">
                    Last scraped: {freshAt} · Auto-refreshes every 24 hours · No AI used for trend extraction
                  </p>
                )}
              </div>
              <button
                onClick={forceRefresh}
                disabled={refreshing}
                className="shrink-0 border border-theme text-muted hover:border-gray-500 hover:text-main disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-xs transition"
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
