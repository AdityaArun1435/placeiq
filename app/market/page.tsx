"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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

export default function MarketPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [ctcTrends, setCtcTrends] = useState<CtcTrend[]>([]);
  const [placementMarket, setPlacementMarket] = useState<PlacementMarket | null>(null);
  const [placementLoading, setPlacementLoading] = useState(true);

  const [payload, setPayload] = useState<NewsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [userCity, setUserCity] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    Promise.all([
      fetch("http://localhost:8000/api/placement/market/ctc-trends").then(r => r.ok ? r.json() : []),
      fetch("http://localhost:8000/api/placement/market/top-companies").then(r => r.ok ? r.json() : null),
    ]).then(([trends, market]) => {
      setCtcTrends(trends);
      if (market) setPlacementMarket(market);
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
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold">Market Intelligence</h2>
            <p className="text-gray-400 mt-1">
              Live hiring trends scraped from India&apos;s top job news sources
              {!insights?.is_ai_estimate && articles.length > 0 && freshAt && (
                <span className="text-gray-500 ml-1">
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
                className="text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 px-3 py-1.5 rounded-lg transition disabled:opacity-40"
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
            <p className="text-gray-400 text-sm">
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
              className="border border-gray-700 text-gray-400 hover:text-white px-4 py-2 rounded-lg text-sm transition"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Real Campus Placement Data Section ── */}
        {!placementLoading && (ctcTrends.length > 0 || placementMarket) && (
          <div className="space-y-6 mb-10">
            {placementMarket && (
              <p className="text-xs text-gray-600">
                Based on real campus placement data — {placementMarket.total_records} records across {placementMarket.total_colleges} colleges
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* CTC Trend Line Chart */}
              {ctcTrends.length > 0 && (
                <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-base font-semibold mb-1">Average CTC Trend (2022–2024)</h3>
                  <p className="text-gray-500 text-xs mb-4">Avg campus placement package across all colleges in our DB</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={ctcTrends} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="year" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "#111", border: "1px solid #374151", borderRadius: 8 }} labelStyle={{ color: "#fff" }} itemStyle={{ color: "#60a5fa" }} />
                      <Line type="monotone" dataKey="avg_ctc" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 4 }} name="Avg CTC (LPA)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Top Companies Bar Chart */}
              {placementMarket && placementMarket.companies.length > 0 && (
                <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-base font-semibold mb-1">Top Companies by Hiring Volume</h3>
                  <p className="text-gray-500 text-xs mb-4">Total avg headcount across all campus visits</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={placementMarket.companies.slice(0, 10)}
                      layout="vertical"
                      margin={{ top: 5, right: 20, left: 60, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <YAxis type="category" dataKey="company_name" tick={{ fill: "#9ca3af", fontSize: 10 }} width={58} />
                      <Tooltip contentStyle={{ background: "#111", border: "1px solid #374151", borderRadius: 8 }} labelStyle={{ color: "#fff" }} itemStyle={{ color: "#a855f7" }} />
                      <Bar dataKey="total_headcount" fill="#a855f7" radius={[0, 4, 4, 0]} name="Total Headcount" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}

        {placementLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 animate-pulse h-64" />
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 animate-pulse h-64" />
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
              <label className="text-sm text-gray-400 shrink-0">Filter by city:</label>
              <input
                value={cityFilter}
                onChange={e => setCityFilter(e.target.value)}
                placeholder={userCity || "e.g. Bangalore, Hyderabad..."}
                className="bg-[#111] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition w-56"
              />
              {cityFilter && (
                <button
                  onClick={() => setCityFilter("")}
                  className="text-xs text-gray-500 hover:text-white transition"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Trending This Week */}
            {(insights?.trending_skills ?? []).length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-1">Trending This Week</h3>
                <p className="text-gray-500 text-sm mb-4">
                  Skills appearing most in recent Indian hiring news
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(insights?.trending_skills ?? []).slice(0, 10).map((s, i) => (
                    <div
                      key={s.skill}
                      className="bg-[#111] border border-gray-800 rounded-2xl p-5"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-600 w-5 shrink-0">#{i + 1}</span>
                        <p className="font-semibold text-white">{s.skill}</p>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">
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
            {(insights?.hot_roles ?? []).length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-1">Hottest Roles Right Now</h3>
                <p className="text-gray-500 text-sm mb-4">
                  Job roles getting the most coverage in hiring news this week
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {(insights?.hot_roles ?? []).slice(0, 8).map(r => (
                    <div
                      key={r.role}
                      className="bg-[#111] border border-gray-800 rounded-2xl p-5"
                    >
                      <p className="font-semibold text-white mb-1 text-sm">{r.role}</p>
                      <p className="text-xs text-gray-500">
                        {r.article_count} mention{r.article_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Companies Actively Hiring */}
            {(insights?.hiring_companies ?? []).length > 0 && (
              <section>
                <h3 className="text-xl font-semibold mb-1">Companies Actively Hiring</h3>
                <p className="text-gray-500 text-sm mb-4">
                  Companies mentioned in recent hiring or expansion news
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(insights?.hiring_companies ?? []).map((c, i) => (
                    <div
                      key={i}
                      className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4"
                    >
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-bold shrink-0">
                        {c.company[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm">{c.company}</p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.context}</p>
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
                <p className="text-gray-500 text-sm mb-4">
                  What the news says about hiring in your city
                </p>
                {filteredCities.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    {filteredCities.map((c, i) => (
                      <div key={i} className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4">
                        <p className="font-medium text-white text-sm mb-1">{c.city}</p>
                        <p className="text-xs text-gray-400">{c.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
                {cityArticles.length > 0 && (
                  <div className="space-y-3">
                    {cityArticles.slice(0, 5).map((a, i) => (
                      <div
                        key={i}
                        className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium leading-snug mb-1">{a.title}</p>
                          <span className="text-xs text-gray-600">{a.source_name}</span>
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
                <p className="text-gray-500 text-sm mb-4">
                  Most recent articles from Indian hiring news sources
                </p>
                <div className="space-y-3">
                  {articles.slice(0, 10).map((a, i) => (
                    <div
                      key={i}
                      className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium leading-snug mb-1.5">
                          {a.title}
                        </p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-gray-600">{a.source_name}</span>
                          {a.published_date && (
                            <span className="text-xs text-gray-700">{a.published_date}</span>
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
            <div className="flex items-center justify-between pt-4 border-t border-gray-800 flex-wrap gap-3">
              <div>
                <p className="text-xs text-gray-600">
                  Live data from {articles.length} articles scraped from Economic Times, TimesJobs, YourStory, Naukri Blog, and LinkedIn Talent Blog.
                </p>
                {freshAt && (
                  <p className="text-xs text-gray-700 mt-0.5">
                    Last scraped: {freshAt} · Auto-refreshes every 24 hours · No AI used for trend extraction
                  </p>
                )}
              </div>
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
