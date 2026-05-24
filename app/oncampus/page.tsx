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
  const season = new Date(now.getFullYear(), 7, 1); // Aug 1
  if (now >= season) {
    season.setFullYear(season.getFullYear() + 1);
  }
  return Math.ceil((season.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function OnCampus() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [result, setResult] = useState<OnCampusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const days = daysUntilSeason();

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

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("placeiq_profile");
      if (raw) setProfile(JSON.parse(raw));
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

  async function predict() {
    if (!profile) return;
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
          skills: profile.skills,
          cgpa: profile.cgpa,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-start justify-between mb-8 gap-6 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold mb-2">On Campus Predictions</h2>
            <p className="text-gray-400">Which companies are likely to visit your campus this placement season</p>
          </div>
          {/* Countdown */}
          <div className="bg-[#111] border border-gray-800 rounded-2xl px-6 py-4 text-center shrink-0">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Season Starts In</p>
            <p className="text-4xl font-bold text-blue-500">{days}</p>
            <p className="text-xs text-gray-500 mt-1">days · Aug 1 {new Date().getFullYear() + (new Date().getMonth() >= 7 ? 1 : 0)}</p>
          </div>
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
            {/* Profile chip */}
            <div className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4 mb-6 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-6 text-sm flex-wrap">
                <span><span className="text-gray-500">College: </span><span className="text-white">{profile.college}</span></span>
                <span><span className="text-gray-500">Tier: </span><span className="text-blue-400">{profile.collegeTier}</span></span>
                <span><span className="text-gray-500">CGPA: </span><span className="text-white">{profile.cgpa}</span></span>
                <span><span className="text-gray-500">Target: </span><span className="text-white">{profile.targetRole}</span></span>
              </div>
              <button
                onClick={predict}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition"
              >
                {loading ? "Predicting..." : result ? "Re-predict" : "Predict Companies →"}
              </button>
            </div>

            {/* Your College Stats card */}
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
                {/* Season advice */}
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
                </div>

                <div className="space-y-4">
                  {result.companies.map((co, idx) => (
                    <div key={co.name} className={`bg-[#111] border rounded-2xl overflow-hidden transition-colors ${co.student_eligible ? "border-gray-800" : "border-gray-800/50 opacity-70"}`}>
                      {/* Company header */}
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
                                  <div className={`h-full rounded-full ${probBg(co.probability)}`} style={{ width: `${co.probability}%` }} />
                                </div>
                                <span className={`font-bold text-sm ${probColor(co.probability)}`}>{co.probability}%</span>
                              </div>
                            </div>
                            <span className="text-gray-600 text-sm">{expandedIdx === idx ? "▲" : "▼"}</span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">{co.why_likely}</p>
                      </button>

                      {/* Expanded prep guide */}
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

                          {/* AmbitionBox Interview Intel */}
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
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
