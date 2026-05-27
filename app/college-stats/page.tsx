"use client";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import LoadingScreen from "@/components/LoadingScreen";

type College = { college_name: string; data_tier: string };

type CollegeStat = {
  id: number;
  college_name: string;
  year: string;
  total_companies: number;
  highest_ctc: number | null;
  lowest_ctc: number | null;
  avg_ctc: number | null;
  median_ctc: number | null;
  total_offers: number | null;
  data_tier: string;
};

type PlacementRecord = {
  id: number;
  college_name: string;
  company_name: string;
  role_profile: string;
  category_tier: string;
  ctc_min: number | null;
  ctc_max: number | null;
  avg_headcount: number | null;
  year: string;
  hiring_rounds: string;
  key_topics: string;
  visit_month: string;
  source: string;
  data_tier: string;
};

const API = "http://localhost:8000";

export default function CollegeStatsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [colleges, setColleges] = useState<College[]>([]);
  const [selectedA, setSelectedA] = useState("");
  const [selectedB, setSelectedB] = useState("");
  const [compareMode, setCompareMode] = useState(false);

  const [statsA, setStatsA] = useState<CollegeStat[]>([]);
  const [statsB, setStatsB] = useState<CollegeStat[]>([]);
  const [recordsA, setRecordsA] = useState<PlacementRecord[]>([]);

  const [loadingColleges, setLoadingColleges] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);

  const [companySearch, setCompanySearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch(`${API}/api/placement/colleges`)
      .then(r => r.ok ? r.json() : [])
      .then(setColleges)
      .catch(() => {})
      .finally(() => setLoadingColleges(false));
  }, [status]);

  useEffect(() => {
    if (!selectedA) return;
    setLoadingStats(true);
    const enc = encodeURIComponent(selectedA);
    Promise.all([
      fetch(`${API}/api/placement/stats/${enc}`).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/placement/companies/${enc}?year=2024`).then(r => r.ok ? r.json() : []),
    ]).then(([stats, records]) => {
      setStatsA(stats);
      setRecordsA(records.length ? records : []);
      // If no 2024, load all
      if (!records.length) {
        fetch(`${API}/api/placement/companies/${enc}`)
          .then(r => r.ok ? r.json() : [])
          .then(setRecordsA)
          .catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoadingStats(false));
  }, [selectedA]);

  useEffect(() => {
    if (!selectedB || !compareMode) return;
    const enc = encodeURIComponent(selectedB);
    fetch(`${API}/api/placement/stats/${enc}`)
      .then(r => r.ok ? r.json() : [])
      .then(setStatsB)
      .catch(() => {});
  }, [selectedB, compareMode]);

  // Merge stats for compare chart: { year, avgCTC_A, avgCTC_B }
  const compareData = useMemo(() => {
    if (!compareMode) return [];
    const map: Record<string, { year: string; a?: number; b?: number }> = {};
    for (const s of statsA) { map[s.year] = { year: s.year, a: s.avg_ctc ?? undefined }; }
    for (const s of statsB) { map[s.year] = { ...map[s.year], year: s.year, b: s.avg_ctc ?? undefined }; }
    return Object.values(map).sort((x, y) => x.year.localeCompare(y.year));
  }, [statsA, statsB, compareMode]);

  const tier1Colleges = colleges.filter(c => c.data_tier === "tier1");
  const tier2Colleges = colleges.filter(c => c.data_tier === "tier2");

  const latestStat: CollegeStat | undefined = statsA.slice().sort((a, b) => b.year.localeCompare(a.year))[0];

  const categories = useMemo(() => {
    const cats = new Set(recordsA.map(r => r.category_tier).filter(Boolean));
    return ["All", ...Array.from(cats).sort()];
  }, [recordsA]);

  const filteredRecords = useMemo(() => {
    return recordsA.filter(r => {
      const ms = !companySearch || r.company_name?.toLowerCase().includes(companySearch.toLowerCase());
      const mc = categoryFilter === "All" || r.category_tier === categoryFilter;
      return ms && mc;
    });
  }, [recordsA, companySearch, categoryFilter]);

  if (status === "loading") return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-8 py-10">

        <div className="mb-8">
          <h2 className="text-3xl font-bold">College Stats</h2>
          <p className="text-gray-400 mt-1">Browse placement data across {colleges.length} colleges</p>
        </div>

        {/* College Selector */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-gray-500 uppercase tracking-widest mb-2 block">Select College</label>
              {loadingColleges ? (
                <div className="h-10 bg-gray-800 rounded-lg animate-pulse" />
              ) : (
                <select
                  value={selectedA}
                  onChange={e => { setSelectedA(e.target.value); setExpandedRow(null); setCompanySearch(""); setCategoryFilter("All"); }}
                  className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="">-- Select a college --</option>
                  {tier1Colleges.length > 0 && (
                    <optgroup label="Tier 1">
                      {tier1Colleges.map(c => <option key={c.college_name} value={c.college_name}>{c.college_name}</option>)}
                    </optgroup>
                  )}
                  {tier2Colleges.length > 0 && (
                    <optgroup label="Tier 2">
                      {tier2Colleges.map(c => <option key={c.college_name} value={c.college_name}>{c.college_name}</option>)}
                    </optgroup>
                  )}
                </select>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={compareMode}
                onChange={e => setCompareMode(e.target.checked)}
                className="accent-blue-500"
              />
              Compare with another college
            </label>

            {compareMode && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-gray-500 uppercase tracking-widest mb-2 block">Compare College</label>
                <select
                  value={selectedB}
                  onChange={e => setSelectedB(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="">-- Select second college --</option>
                  {tier1Colleges.length > 0 && (
                    <optgroup label="Tier 1">
                      {tier1Colleges.map(c => <option key={c.college_name} value={c.college_name}>{c.college_name}</option>)}
                    </optgroup>
                  )}
                  {tier2Colleges.length > 0 && (
                    <optgroup label="Tier 2">
                      {tier2Colleges.map(c => <option key={c.college_name} value={c.college_name}>{c.college_name}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
          </div>
        </div>

        {loadingStats && (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-[#111] border border-gray-800 rounded-2xl p-6 animate-pulse h-40" />
            ))}
          </div>
        )}

        {!loadingStats && selectedA && (
          <div className="space-y-6">
            {/* Stats Cards */}
            {latestStat && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Highest CTC", value: latestStat.highest_ctc != null ? `${latestStat.highest_ctc} LPA` : "—", color: "text-yellow-400" },
                  { label: "Avg CTC", value: latestStat.avg_ctc != null ? `${latestStat.avg_ctc} LPA` : "—", color: "text-blue-400" },
                  { label: "Total Companies", value: latestStat.total_companies?.toString() ?? "—", color: "text-white" },
                  { label: "Total Offers (latest)", value: latestStat.total_offers?.toString() ?? "—", color: "text-purple-400" },
                ].map(card => (
                  <div key={card.label} className="bg-[#111] border border-gray-800 rounded-2xl px-5 py-4">
                    <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                    <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Trend Charts */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <h3 className="text-base font-semibold mb-4">
                {compareMode && selectedB ? `${selectedA} vs ${selectedB} — Avg CTC Trend` : "Avg CTC Trend"}
              </h3>
              {compareMode && selectedB ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={compareData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="year" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#111", border: "1px solid #374151", borderRadius: 8 }} labelStyle={{ color: "#fff" }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
                    <Line type="monotone" dataKey="a" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 4 }} name={selectedA} connectNulls />
                    <Line type="monotone" dataKey="b" stroke="#a855f7" strokeWidth={2} dot={{ fill: "#a855f7", r: 4 }} name={selectedB} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={statsA} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="year" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#111", border: "1px solid #374151", borderRadius: 8 }} labelStyle={{ color: "#fff" }} itemStyle={{ color: "#60a5fa" }} />
                    <Line type="monotone" dataKey="avg_ctc" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 4 }} name="Avg CTC" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Company Table */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <h3 className="text-base font-semibold mb-1">Company Visits — {selectedA}</h3>
              <p className="text-gray-500 text-sm mb-4">{recordsA.length} records</p>

              <div className="flex gap-3 flex-wrap mb-4">
                <input
                  value={companySearch}
                  onChange={e => setCompanySearch(e.target.value)}
                  placeholder="Search company..."
                  className="bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition w-52"
                />
                <div className="flex gap-2 flex-wrap">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${
                        categoryFilter === cat
                          ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                          : "border-gray-700 text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-gray-800 text-[11px] text-gray-500 uppercase tracking-widest">
                      <th className="text-left py-2 pr-4">Company</th>
                      <th className="text-left py-2 pr-4">Role</th>
                      <th className="text-left py-2 pr-4">Category</th>
                      <th className="text-left py-2 pr-4">CTC Range</th>
                      <th className="text-left py-2 pr-4">Headcount</th>
                      <th className="text-left py-2">Visit Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-gray-600">No records match your filter</td></tr>
                    ) : filteredRecords.map((r, i) => (
                      <>
                        <tr
                          key={r.id}
                          onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                          className="border-b border-gray-800/50 hover:bg-white/[0.02] cursor-pointer transition"
                        >
                          <td className="py-3 pr-4 font-medium text-white">{r.company_name || "—"}</td>
                          <td className="py-3 pr-4 text-gray-400 max-w-[180px] truncate">{r.role_profile || "—"}</td>
                          <td className="py-3 pr-4">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
                              {r.category_tier || "—"}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-green-400 font-medium">
                            {r.ctc_min != null && r.ctc_max != null ? `${r.ctc_min}–${r.ctc_max} LPA` : r.ctc_min != null ? `${r.ctc_min}+ LPA` : "—"}
                          </td>
                          <td className="py-3 pr-4 text-gray-300">{r.avg_headcount ?? "—"}</td>
                          <td className="py-3 text-gray-400">{r.visit_month || "—"}</td>
                        </tr>
                        {expandedRow === i && (
                          <tr key={`exp-${r.id}`} className="border-b border-gray-800">
                            <td colSpan={6} className="py-3 px-2 bg-gray-900/40">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Hiring Rounds</p>
                                  <p className="text-gray-300">{r.hiring_rounds || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Key Topics Tested</p>
                                  <p className="text-gray-300">{r.key_topics || "—"}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!loadingStats && !selectedA && !loadingColleges && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-12 text-center">
            <p className="text-gray-400 text-lg font-medium mb-2">Select a college to get started</p>
            <p className="text-gray-600 text-sm">{colleges.length} colleges available in our placement database</p>
          </div>
        )}
      </div>
    </main>
  );
}
