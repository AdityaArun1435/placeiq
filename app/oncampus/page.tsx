"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

type Profile = {
  college: string;
  collegeTier: string;
  branch: string;
  targetRole: string;
  skills: string[];
  cgpa: number;
};

type Company = {
  name: string;
  probability: number;
  visit_timing: string;
  role_offered: string;
  package_range: string;
  cgpa_cutoff: string;
  student_eligible: boolean;
  hiring_rounds: string[];
  topics_tested: string[];
  sample_questions: string[];
  prep_resource: string;
  careers_link: string;
  why_likely: string;
};

type OnCampusResult = {
  companies: Company[];
  season_advice: string;
  eligible_count: number;
};

type PlacementDriveCompany = {
  name: string;
  visit_date: string;
  role: string;
  category: string;
  ctc_min: number | null;
  ctc_max: number | null;
  ctc: number | null;
  eligibility_percent: number | null;
  students_applied: number;
  students_selected: number;
  selection_rate: number;
  source: string;
};

type YearSummary = {
  academic_year: string;
  total_companies: number;
  total_selected: number;
  highest_ctc: number | null;
  median_ctc: number | null;
  marquee_count: number;
  super_dream_count: number;
  dream_count: number;
};

type PlacementHistoryData = {
  found: boolean;
  college_name: string;
  available_years: string[];
  current_year: string;
  year_summary: YearSummary;
  companies_by_category: Record<string, PlacementDriveCompany[]>;
  data_note: string;
};

type PredictSnapshot = { cgpa: number; skills: string[] }


function probColor(p: number) {
  if (p >= 70) return "text-green-400";
  if (p >= 40) return "text-yellow-400";
  return "text-red-400";
}

function probBg(p: number) {
  if (p >= 70) return "bg-green-500";
  if (p >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

function daysUntilSeason(): number {
  const now = new Date();
  const season = new Date(now.getFullYear(), 7, 1);
  if (now >= season) season.setFullYear(season.getFullYear() + 1);
  return Math.ceil((season.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getSeasonInfo() {
  const month = new Date().getMonth();
  if (month >= 7 && month <= 9) return {
    name: "Peak Placement Season", multiplier: 1.3,
    desc: "Aug–Oct · Most companies visit during this period",
    textColor: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/30",
  };
  if (month >= 10 && month <= 11) return {
    name: "Active Season", multiplier: 1.1,
    desc: "Nov–Dec · Second wave of placement drives",
    textColor: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/30",
  };
  if (month >= 0 && month <= 2) return {
    name: "Slow Season", multiplier: 0.8,
    desc: "Jan–Mar · Mostly off-campus opportunities",
    textColor: "text-yellow-400", bgColor: "bg-yellow-500/10", borderColor: "border-yellow-500/30",
  };
  return {
    name: "Off-season", multiplier: 0.6,
    desc: "Apr–Jul · Minimal on-campus drives",
    textColor: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/30",
  };
}

const CATEGORY_STYLES: Record<string, string> = {
  "Marquee":       "border-l-yellow-400 bg-yellow-500/5",
  "Super Dream":   "border-l-purple-400 bg-purple-500/5",
  "Dream":         "border-l-blue-400 bg-blue-500/5",
  "Day 1/Day 2":   "border-l-green-400 bg-green-500/5",
  "Core":          "border-l-teal-400 bg-teal-500/5",
  "Non-Engineering":"border-l-gray-400 bg-gray-500/5",
  "Internship":    "border-l-slate-500 bg-slate-500/5",
};

const CATEGORY_BADGE: Record<string, string> = {
  "Marquee":       "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  "Super Dream":   "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "Dream":         "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "Day 1/Day 2":   "bg-green-500/15 text-green-400 border-green-500/30",
  "Core":          "bg-teal-500/15 text-teal-400 border-teal-500/30",
  "Non-Engineering":"bg-gray-500/15 text-gray-400 border-gray-500/30",
  "Internship":    "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const ALL_CATEGORIES = ["All", "Marquee", "Super Dream", "Dream", "Day 1/Day 2", "Core", "Internship"];

const PREDICT_SNAPSHOT_KEY = "placeiq_predict_snapshot";

export default function OnCampus() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [result, setResult] = useState<OnCampusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const days = daysUntilSeason();
  const [activeTab, setActiveTab] = useState<"predictor" | "history">("predictor");
  const seasonInfo = getSeasonInfo();

  // Repredict modal state
  const [showRepredictModal, setShowRepredictModal] = useState(false);
  const [repredictCgpa, setRepredictCgpa] = useState(0);
  const [repredictSkills, setRepredictSkills] = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [toast, setToast] = useState("");
  const [lastPredictSnapshot, setLastPredictSnapshot] = useState<PredictSnapshot | null>(null);

  // Placement history state
  const [historyData, setHistoryData] = useState<PlacementHistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  type OnCampusIntel = { difficulty: string; avg_salary: string; topics: string[]; source: "ambitionbox" | "ai" };
  type IntelEntry = { data: OnCampusIntel | null; status: "idle" | "loading" | "found" | "error" };
  const [intel, setIntel] = useState<Record<string, IntelEntry>>({});

  type PlacementSource = {
    source_name: string;
    placement_rate: number | null;
    median_salary: number | null;
    highest_salary: number | null;
    top_companies: string[];
    year: number | null;
    url: string;
  };
  type SourcesData = {
    nirf_stats: { college_name: string; nirf_rank: number | null; placement_rate: number | null; median_salary: number | null; highest_salary: number | null; matched: boolean } | null;
    sources: PlacementSource[];
    combined_placement_rate: number | null;
    num_sources: number;
  };
  const [sourcesData, setSourcesData] = useState<SourcesData | null>(null);


  // Whether profile has changed since last prediction
  const hasProfileChanged = !!(result && profile && lastPredictSnapshot && (
    profile.cgpa !== lastPredictSnapshot.cgpa ||
    JSON.stringify([...(profile.skills || [])].sort()) !== JSON.stringify([...(lastPredictSnapshot.skills || [])].sort())
  ));

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  }

  async function fetchIntel(company: string) {
    if (intel[company]?.status === "found" || intel[company]?.status === "loading") return;
    setIntel(prev => ({ ...prev, [company]: { data: null, status: "loading" } }));
    try {
      const res = await fetch(`${config.apiUrl}/api/oncampus/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setIntel(prev => ({ ...prev, [company]: { data, status: "found" } }));
    } catch {
      setIntel(prev => ({ ...prev, [company]: { data: null, status: "error" } }));
    }
  }

  async function fetchHistory(year?: string) {
    if (!profile?.college) return;
    setHistoryLoading(true);
    try {
      const collegeName = encodeURIComponent(profile.college);
      const yearParam = year ? `?year=${encodeURIComponent(year)}` : "";
      const res = await fetch(`${config.apiUrl}/api/oncampus/history/${collegeName}${yearParam}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setHistoryData(data);
      if (data.current_year) setSelectedYear(data.current_year);
    } catch {
      setHistoryData(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("placeiq_profile");
      if (raw) setProfile(JSON.parse(raw));
    } catch {}
    try {
      const snap = localStorage.getItem(PREDICT_SNAPSHOT_KEY);
      if (snap) setLastPredictSnapshot(JSON.parse(snap));
    } catch {}
  }, []);

  useEffect(() => {
    if (!profile?.college) return;
    let isMounted = true;
    fetch(`${config.apiUrl}/api/placement/sources?college=${encodeURIComponent(profile.college)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (isMounted && data) setSourcesData(data); })
      .catch(() => {});
    return () => { isMounted = false };
  }, [profile?.college]);

  useEffect(() => {
    if (activeTab === "history" && profile?.college && !historyData) {
      fetchHistory();
    }
  }, [activeTab, profile?.college]);

  async function predict(overrides?: { cgpa?: number; skills?: string[] }) {
    if (!profile) return;
    const cgpa = overrides?.cgpa ?? profile.cgpa;
    const skills = overrides?.skills ?? profile.skills;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${config.apiUrl}/api/oncampus/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          college: profile.college,
          college_tier: profile.collegeTier,
          branch: profile.branch,
          target_role: profile.targetRole,
          skills,
          cgpa,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
      const snapshot: PredictSnapshot = { cgpa, skills };
      setLastPredictSnapshot(snapshot);
      try { localStorage.setItem(PREDICT_SNAPSHOT_KEY, JSON.stringify(snapshot)); } catch {}
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function openRepredictModal() {
    setRepredictCgpa(profile?.cgpa ?? 0);
    setRepredictSkills([...(profile?.skills ?? [])]);
    setNewSkillInput("");
    setShowRepredictModal(true);
  }

  function submitRepredict() {
    const isUnchanged = lastPredictSnapshot &&
      repredictCgpa === lastPredictSnapshot.cgpa &&
      JSON.stringify([...repredictSkills].sort()) === JSON.stringify([...(lastPredictSnapshot.skills || [])].sort());

    if (isUnchanged) {
      setShowRepredictModal(false);
      showToast("Your profile hasn't changed — prediction is the same. Update your CGPA or skills to see a difference.");
      return;
    }
    setShowRepredictModal(false);
    predict({ cgpa: repredictCgpa, skills: repredictSkills });
  }

  function addRepredictSkill() {
    const trimmed = newSkillInput.trim();
    if (trimmed && !repredictSkills.includes(trimmed)) {
      setRepredictSkills(prev => [...prev, trimmed]);
    }
    setNewSkillInput("");
  }

  function removeRepredictSkill(skill: string) {
    setRepredictSkills(prev => prev.filter(s => s !== skill));
  }

  if (status === "loading") return <LoadingScreen />;

  // Filtered companies for history tab
  const filteredHistoryCompanies: PlacementDriveCompany[] = [];
  if (historyData?.companies_by_category) {
    for (const [cat, companies] of Object.entries(historyData.companies_by_category)) {
      if (selectedCategory === "All" || cat === selectedCategory) {
        filteredHistoryCompanies.push(...companies);
      }
    }
  }

  const currentMonthName = new Date().toLocaleString("default", { month: "long" });

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-gray-700 text-gray-200 text-sm px-5 py-3 rounded-xl shadow-2xl max-w-md text-center animate-fade-in">
          {toast}
        </div>
      )}

      {/* Repredict Modal */}
      {showRepredictModal && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-4">
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Update & Repredict</h3>
              <button onClick={() => setShowRepredictModal(false)} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="space-y-5">
              {/* CGPA */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">CGPA</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  value={repredictCgpa}
                  onChange={e => setRepredictCgpa(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              {/* Skills */}
              <div>
                <label className="text-xs text-gray-400 mb-2 block">Skills</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {repredictSkills.map(skill => (
                    <span key={skill} className="flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs px-2.5 py-1 rounded-full">
                      {skill}
                      <button onClick={() => removeRepredictSkill(skill)} className="text-blue-500 hover:text-red-400 ml-1 leading-none">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newSkillInput}
                    onChange={e => setNewSkillInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addRepredictSkill()}
                    placeholder="Add a new skill..."
                    className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                  <button
                    onClick={addRepredictSkill}
                    className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-sm transition"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Season month */}
              <div className={`${seasonInfo.bgColor} border ${seasonInfo.borderColor} rounded-lg px-4 py-3`}>
                <p className="text-xs text-gray-400 mb-0.5">Current month: <span className="text-white font-medium">{currentMonthName}</span></p>
                <p className={`text-xs ${seasonInfo.textColor}`}>{seasonInfo.name} · {seasonInfo.desc}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowRepredictModal(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2.5 rounded-lg text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={submitRepredict}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium transition"
              >
                Run New Prediction
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-start justify-between mb-8 gap-6 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold mb-2">On Campus</h2>
            <p className="text-gray-400">Predict companies and view real placement drive history</p>
          </div>
          <div className="bg-[#111] border border-gray-800 rounded-2xl px-6 py-4 text-center shrink-0">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Season Starts In</p>
            <p className="text-4xl font-bold text-blue-500">{days}</p>
            <p className="text-xs text-gray-500 mt-1">days · Aug 1 {new Date().getFullYear() + (new Date().getMonth() >= 7 ? 1 : 0)}</p>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex gap-2 mb-6 border-b border-gray-800">
          {(["predictor", "history"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-blue-500 text-blue-400 bg-blue-500/5"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab === "predictor" ? "Company Predictor" : "Placement History"}
            </button>
          ))}
        </div>

        {!profile ? (
          <div className="bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <h3 className="text-xl font-bold mb-2">Profile not found</h3>
            <p className="text-gray-400 mb-6">Complete your profile to get on-campus predictions personalised to your college.</p>
            <button onClick={() => router.push("/onboarding")} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-medium transition">
              Complete Profile →
            </button>
          </div>
        ) : (
          <>
            {/* ── PREDICTOR TAB ── */}
            {activeTab === "predictor" && (
              <>
                {/* Season banner */}
                <div className={`${seasonInfo.bgColor} border ${seasonInfo.borderColor} rounded-xl px-5 py-3.5 mb-5 flex items-center justify-between flex-wrap gap-3`}>
                  <div>
                    <p className={`text-sm font-semibold ${seasonInfo.textColor}`}>
                      {currentMonthName} · {seasonInfo.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{seasonInfo.desc}</p>
                  </div>
                  <span className={`text-xs font-medium ${seasonInfo.textColor} bg-white/5 border ${seasonInfo.borderColor} px-2.5 py-1 rounded-full shrink-0`}>
                    ×{seasonInfo.multiplier} probability factor
                  </span>
                </div>

                <div className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4 mb-6 flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-6 text-sm flex-wrap">
                    <span><span className="text-gray-500">College: </span><span className="text-white">{profile.college}</span></span>
                    <span><span className="text-gray-500">Tier: </span><span className="text-blue-400">{profile.collegeTier}</span></span>
                    <span><span className="text-gray-500">CGPA: </span><span className="text-white">{profile.cgpa}</span></span>
                    <span><span className="text-gray-500">Target: </span><span className="text-white">{profile.targetRole}</span></span>
                  </div>
                  {!result ? (
                    <button
                      onClick={() => predict()}
                      disabled={loading}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition"
                    >
                      {loading ? "Predicting..." : "Predict Companies →"}
                    </button>
                  ) : hasProfileChanged ? (
                    <button
                      onClick={openRepredictModal}
                      className="bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 px-5 py-2.5 rounded-lg text-sm font-medium transition"
                    >
                      Profile updated — repredict now
                    </button>
                  ) : (
                    <span className="text-xs text-gray-600 border border-gray-800 px-4 py-2 rounded-lg">Predicted ✓</span>
                  )}
                </div>

                {sourcesData && (sourcesData.nirf_stats?.matched || (sourcesData.sources?.length ?? 0) > 0) && (
                  <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-200">Your College Stats</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{profile?.college} · placement data 2024</p>
                      </div>
                      {sourcesData.num_sources > 1 && (
                        <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">
                          avg {sourcesData.combined_placement_rate}% · {sourcesData.num_sources} sources
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {sourcesData.nirf_stats?.matched && (
                        <div className="py-2.5 px-3 bg-gray-900/60 rounded-lg">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">NIRF</span>
                              <a href="https://www.nirfindia.org/2024/EngineeringRanking.html" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-300 hover:text-white">
                                NIRF 2024 <span className="text-gray-600 text-[11px]">· official govt ranking</span>
                              </a>
                            </div>
                            <span className="text-sm font-semibold">{sourcesData.nirf_stats.placement_rate != null ? `${sourcesData.nirf_stats.placement_rate}%` : "—"}</span>
                          </div>
                          <div className="flex gap-4 text-[11px] text-gray-500 pl-1">
                            {sourcesData.nirf_stats.median_salary != null && <span>Median: <span className="text-gray-300">{sourcesData.nirf_stats.median_salary} LPA</span></span>}
                            {sourcesData.nirf_stats.highest_salary != null && <span>Highest: <span className="text-gray-300">{sourcesData.nirf_stats.highest_salary} LPA</span></span>}
                          </div>
                        </div>
                      )}
                      {sourcesData.sources.map((src, i) => (
                        <div key={i} className="py-2.5 px-3 bg-gray-900/60 rounded-lg">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">{src.source_name[0]}</span>
                              <a href={src.url || "#"} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-300 hover:text-white">
                                {src.source_name}{src.year ? <span className="text-gray-600 text-[11px]"> · {src.year} data</span> : ""}
                              </a>
                            </div>
                            <span className="text-sm font-semibold">{src.placement_rate != null ? `${src.placement_rate}%` : "—"}</span>
                          </div>
                          <div className="flex gap-4 text-[11px] text-gray-500 pl-1">
                            {src.median_salary != null && <span>Median: <span className="text-gray-300">{src.median_salary} LPA</span></span>}
                            {src.highest_salary != null && <span>Highest: <span className="text-gray-300">{src.highest_salary} LPA</span></span>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-600 mt-3">Data from NIRF 2024, Shiksha, and Careers360 · 2024</p>
                  </div>
                )}

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">{error}</div>
                )}

                {loading && (
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="bg-[#111] border border-gray-800 rounded-2xl p-6 animate-pulse">
                        <div className="flex items-center justify-between mb-3">
                          <div className="h-5 w-32 bg-gray-800 rounded" />
                          <div className="h-5 w-16 bg-gray-800 rounded" />
                        </div>
                        <div className="h-3 w-full bg-gray-800 rounded mt-4" />
                      </div>
                    ))}
                  </div>
                )}

                {result && !loading && (
                  <>
                    <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl px-6 py-4 mb-6">
                      <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">Season Advice</p>
                      <p className="text-gray-300 text-sm leading-relaxed">{result.season_advice}</p>
                    </div>

                    <div className="flex items-center gap-4 mb-5 flex-wrap">
                      <p className="text-sm text-gray-400">
                        <span className="text-white font-semibold">{result.eligible_count}</span> companies you are CGPA-eligible for
                      </p>
                      <div className="flex gap-3 text-xs">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />≥70% likely</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />40–69%</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />&lt;40%</span>
                      </div>
                      <span className={`text-xs ${seasonInfo.textColor} ml-auto`}>
                        Probabilities adjusted for {seasonInfo.name.toLowerCase()} (×{seasonInfo.multiplier})
                      </span>
                    </div>

                    <div className="space-y-4">
                      {result.companies.map((co, idx) => {
                        const displayProb = Math.min(100, Math.round(co.probability * seasonInfo.multiplier));
                        return (
                          <div key={co.name} className={`bg-[#111] border rounded-2xl overflow-hidden transition-colors ${co.student_eligible ? "border-gray-800" : "border-gray-800/50 opacity-70"}`}>
                            <button
                              className="w-full text-left px-6 py-5"
                              onClick={() => {
                                const next = expandedIdx === idx ? null : idx;
                                setExpandedIdx(next);
                                if (next === idx) fetchIntel(co.name);
                              }}
                            >
                              <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="flex items-center gap-4">
                                  <div>
                                    <div className="flex items-center gap-2 mb-1">
                                      <h3 className="font-semibold text-white">{co.name}</h3>
                                      {!co.student_eligible && (
                                        <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Below CGPA cutoff</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500">{co.role_offered} · {co.package_range} · Visits: {co.visit_timing}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-6">
                                  <div className="text-right">
                                    <p className="text-xs text-gray-500 mb-1">Visit Probability</p>
                                    <div className="flex items-center gap-3">
                                      <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full ${probBg(displayProb)}`} style={{ width: `${displayProb}%` }} />
                                      </div>
                                      <span className={`font-bold text-sm ${probColor(displayProb)}`}>{displayProb}%</span>
                                    </div>
                                  </div>
                                  <span className="text-gray-600 text-sm">{expandedIdx === idx ? "▲" : "▼"}</span>
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 mt-2">{co.why_likely}</p>
                            </button>

                            {expandedIdx === idx && (
                              <div className="border-t border-gray-800 px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Hiring Rounds</p>
                                  <ol className="space-y-1.5">
                                    {co.hiring_rounds.map((r, i) => (
                                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                                        <span className="text-blue-500 font-bold text-xs mt-0.5 shrink-0">{i + 1}.</span>
                                        {r}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Topics Tested</p>
                                  <div className="flex flex-wrap gap-2">
                                    {co.topics_tested.map(t => (
                                      <span key={t} className="bg-gray-800 text-gray-300 text-xs px-2.5 py-1 rounded-full">{t}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="md:col-span-2">
                                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Sample Interview Questions</p>
                                  <ul className="space-y-2">
                                    {co.sample_questions.map((q, i) => (
                                      <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                                        <span className="text-gray-600 shrink-0">Q{i + 1}.</span>
                                        {q}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="md:col-span-2 flex gap-3 flex-wrap">
                                  {co.prep_resource && (
                                    <a href={co.prep_resource} target="_blank" rel="noopener noreferrer"
                                      className="bg-blue-600/10 border border-blue-500/30 text-blue-400 hover:bg-blue-600/20 text-xs px-4 py-2 rounded-lg transition">
                                      Prep Resource →
                                    </a>
                                  )}
                                  {co.careers_link && (
                                    <a href={co.careers_link} target="_blank" rel="noopener noreferrer"
                                      className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-4 py-2 rounded-lg transition">
                                      Careers Page →
                                    </a>
                                  )}
                                  <span className="text-xs text-gray-600 flex items-center">CGPA Cutoff: {co.cgpa_cutoff}</span>
                                </div>

                                <div className="md:col-span-2 bg-[#0d0d0d] border border-gray-800/60 rounded-xl p-4">
                                  <div className="flex items-center gap-2 mb-3">
                                    <p className="text-xs text-gray-500 uppercase tracking-widest">Interview Intel</p>
                                    {intel[co.name]?.data && (
                                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                                        intel[co.name].data!.source === "ambitionbox"
                                          ? "bg-green-900/30 text-green-400 border-green-700/40"
                                          : "bg-gray-800 text-gray-500 border-gray-700"
                                      }`}>
                                        {intel[co.name].data!.source === "ambitionbox" ? "Live from AmbitionBox" : "AI Generated"}
                                      </span>
                                    )}
                                  </div>
                                  {intel[co.name]?.status === "loading" && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                      <span className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                                      Fetching real interview data...
                                    </div>
                                  )}
                                  {intel[co.name]?.status === "error" && (
                                    <p className="text-xs text-gray-600">Could not fetch intel — backend may be offline.</p>
                                  )}
                                  {intel[co.name]?.data && (
                                    <div className="flex flex-wrap gap-6 text-sm">
                                      <div>
                                        <p className="text-xs text-gray-500 mb-1">Interview Difficulty</p>
                                        <span className={`font-semibold ${
                                          intel[co.name].data!.difficulty.toLowerCase().includes("hard") ? "text-red-400" :
                                          intel[co.name].data!.difficulty.toLowerCase().includes("moderate") ? "text-yellow-400" :
                                          "text-green-400"
                                        }`}>{intel[co.name].data!.difficulty}</span>
                                      </div>
                                      {intel[co.name].data!.avg_salary && (
                                        <div>
                                          <p className="text-xs text-gray-500 mb-1">Avg Salary (AmbitionBox)</p>
                                          <span className="text-green-400 font-semibold">{intel[co.name].data!.avg_salary}</span>
                                        </div>
                                      )}
                                      {intel[co.name].data!.topics?.length > 0 && (
                                        <div>
                                          <p className="text-xs text-gray-500 mb-1">Key Topics</p>
                                          <div className="flex flex-wrap gap-1.5">
                                            {intel[co.name].data!.topics.map(t => (
                                              <span key={t} className="bg-blue-900/20 text-blue-400 border border-blue-700/30 text-xs px-2 py-0.5 rounded-full">{t}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── HISTORY TAB ── */}
            {activeTab === "history" && (
              <>
                {historyLoading && (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="bg-[#111] border border-gray-800 rounded-2xl p-5 animate-pulse h-16" />
                    ))}
                  </div>
                )}

                {!historyLoading && (!historyData || !historyData.found) && (
                  <div className="bg-[#111] border border-gray-800 rounded-2xl p-10 text-center">
                    <p className="text-gray-400 text-lg font-medium mb-2">No placement drive history found</p>
                    <p className="text-gray-600 text-sm">
                      Real placement data is currently only available for SRM KTR (2025-26).
                      More colleges coming soon.
                    </p>
                  </div>
                )}

                {!historyLoading && historyData?.found && (
                  <>
                    {historyData.year_summary && (
                      <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-5">
                        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{historyData.college_name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{historyData.year_summary.academic_year} · Placement Season</p>
                          </div>
                          {historyData.available_years.length > 1 && (
                            <div className="flex gap-2">
                              {historyData.available_years.map(y => (
                                <button
                                  key={y}
                                  onClick={() => { setSelectedYear(y); fetchHistory(y); }}
                                  className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                                    y === selectedYear
                                      ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                                      : "border-gray-700 text-gray-500 hover:text-gray-300"
                                  }`}
                                >
                                  {y}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-gray-900/60 rounded-lg px-3 py-2.5">
                            <p className="text-xs text-gray-500 mb-0.5">Companies</p>
                            <p className="text-lg font-bold text-white">{historyData.year_summary.total_companies}</p>
                          </div>
                          <div className="bg-gray-900/60 rounded-lg px-3 py-2.5">
                            <p className="text-xs text-gray-500 mb-0.5">Students Placed</p>
                            <p className="text-lg font-bold text-green-400">{historyData.year_summary.total_selected.toLocaleString()}</p>
                          </div>
                          <div className="bg-gray-900/60 rounded-lg px-3 py-2.5">
                            <p className="text-xs text-gray-500 mb-0.5">Highest CTC</p>
                            <p className="text-lg font-bold text-yellow-400">
                              {historyData.year_summary.highest_ctc != null ? `${historyData.year_summary.highest_ctc} LPA` : "—"}
                            </p>
                          </div>
                          <div className="bg-gray-900/60 rounded-lg px-3 py-2.5">
                            <p className="text-xs text-gray-500 mb-0.5">Marquee / Super Dream</p>
                            <p className="text-lg font-bold text-purple-400">
                              {historyData.year_summary.marquee_count} / {historyData.year_summary.super_dream_count}
                            </p>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-600 mt-3">{historyData.data_note}</p>
                      </div>
                    )}

                    <div className="flex gap-2 flex-wrap mb-5">
                      {ALL_CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition ${
                            selectedCategory === cat
                              ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                              : "border-gray-700 text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    <div className="bg-[#111] border border-gray-800 rounded-2xl overflow-hidden">
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-4 px-4 py-2.5 border-b border-gray-800 text-[11px] text-gray-500 uppercase tracking-widest">
                        <span>Company / Role</span>
                        <span>Package</span>
                        <span>Eligibility</span>
                        <span>Applied</span>
                        <span>Selected</span>
                        <span>Rate</span>
                        <span>Category</span>
                      </div>
                      {filteredHistoryCompanies.length === 0 ? (
                        <div className="px-4 py-8 text-center text-gray-600 text-sm">No companies in this category</div>
                      ) : (
                        filteredHistoryCompanies.map((co, i) => {
                          const catStyle = CATEGORY_STYLES[co.category] || "border-l-gray-700";
                          const badgeStyle = CATEGORY_BADGE[co.category] || "bg-gray-700/30 text-gray-400 border-gray-600";
                          const ctcStr = co.ctc_min === co.ctc_max
                            ? (co.ctc != null ? `${co.ctc} LPA` : "—")
                            : (co.ctc_min != null && co.ctc_max != null ? `${co.ctc_min}–${co.ctc_max} LPA` : "—");
                          return (
                            <div
                              key={`${co.name}-${i}`}
                              className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-4 px-4 py-3.5 border-b border-gray-800/60 border-l-2 ${catStyle} hover:bg-white/[0.02] transition`}
                            >
                              <div>
                                <p className="text-sm font-medium text-white">{co.name}</p>
                                <p className="text-[11px] text-gray-500">{co.role}</p>
                              </div>
                              <span className="text-sm text-green-400 font-medium self-center">{ctcStr}</span>
                              <span className="text-sm text-gray-300 self-center">{co.eligibility_percent != null ? `${co.eligibility_percent}%` : "—"}</span>
                              <span className="text-sm text-gray-300 self-center">{co.students_applied.toLocaleString()}</span>
                              <span className="text-sm text-white font-medium self-center">{co.students_selected.toLocaleString()}</span>
                              <span className={`text-sm font-medium self-center ${co.selection_rate >= 10 ? "text-green-400" : co.selection_rate >= 3 ? "text-yellow-400" : "text-red-400"}`}>
                                {co.selection_rate}%
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border self-center ${badgeStyle}`}>{co.category}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <p className="text-[10px] text-gray-600 mt-3 text-center">
                      Data sourced from SRM KTR placement cell records · Academic year 2025-26 · Not official NIRF figures
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
