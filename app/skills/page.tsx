"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import config, { fetchWithTimeout } from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

type TrendingSkill = {
  skill_name: string;
  category: string;
  demand_score: number;
  why_it_matters: string;
  free_resource: string;
};

function categoryBadgeColor(cat: string) {
  if (cat === "AI/ML") return { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30", bar: "bg-purple-500" };
  if (cat === "Cloud") return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30", bar: "bg-blue-500" };
  if (cat === "DevOps") return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30", bar: "bg-orange-500" };
  if (cat === "Data") return { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/30", bar: "bg-green-500" };
  if (cat === "Frontend") return { bg: "bg-cyan-500/15", text: "text-cyan-400", border: "border-cyan-500/30", bar: "bg-cyan-500" };
  if (cat === "Backend") return { bg: "bg-indigo-500/15", text: "text-indigo-400", border: "border-indigo-500/30", bar: "bg-indigo-500" };
  if (cat === "Mobile") return { bg: "bg-pink-500/15", text: "text-pink-400", border: "border-pink-500/30", bar: "bg-pink-500" };
  return { bg: "bg-gray-500/15", text: "text-gray-400", border: "border-gray-500/30", bar: "bg-gray-500" };
}

function TrendingSkillCard({ skill }: { skill: TrendingSkill }) {
  const colors = categoryBadgeColor(skill.category);
  return (
    <div className="bg-[#111] border border-gray-800 rounded-xl p-4 hover:border-blue-500/50 transition flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-semibold text-white text-sm leading-tight">{skill.skill_name}</h4>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
            {skill.category}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${skill.demand_score}%` }} />
          </div>
          <span className="text-[10px] text-gray-500 w-8 text-right shrink-0">{skill.demand_score}%</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed flex-1">{skill.why_it_matters}</p>
      {skill.free_resource && (
        <a
          href={skill.free_resource}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400 rounded-lg px-3 py-1.5 text-center transition font-medium"
        >
          Learn Free →
        </a>
      )}
    </div>
  );
}

type SkillItem = {
  skill: string;
  why_important: string;
  time_to_learn: string;
  free_resource_link: string;
  learning_resource?: string;
  demand_percentage?: number;
  priority?: "High" | "Medium" | "Low";
  category?: string;
};

type ImproveItem = {
  skill: string;
  what_to_focus_on: string;
  free_resource_link: string;
  learning_resource?: string;
  category?: string;
};

type CollegeInfo = {
  college_name: string;
  college_tier: string;
  sources_count: number;
  combined_placement_rate: number | null;
  combined_median_salary: number | null;
};

type SkillGapResult = {
  must_have_missing: SkillItem[];
  good_to_have_missing: SkillItem[];
  skills_to_improve: ImproveItem[];
  service_company_ready: boolean;
  product_company_ready: boolean;
  verdict: string;
  college_info?: CollegeInfo;
  match_percentage?: number;
  total_roles_analysed?: number;
  data_source?: string;
  skill_demand_last_updated?: string;
};

type StoredProfile = {
  targetRole: string;
  skills: string[];
  collegeTier: string;
  college: string;
  branch: string;
  cgpa: number;
};

const PRIORITY_COLORS = {
  High: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30" },
  Medium: { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/30" },
  Low: { bg: "bg-gray-500/15", text: "text-gray-400", border: "border-gray-500/20" },
};

const CATEGORY_ORDER = [
  "Languages", "Frontend", "Backend", "Mobile", "Databases",
  "Cloud & DevOps", "Data & AI", "Security", "Concepts", "Trending 2024-25",
];

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  const p = priority as "High" | "Medium" | "Low";
  const c = PRIORITY_COLORS[p] || PRIORITY_COLORS.Low;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
      {priority}
    </span>
  );
}

function DemandBar({ pct }: { pct?: number }) {
  if (pct == null) return null;
  const color = pct >= 40 ? "bg-red-500" : pct >= 20 ? "bg-yellow-500" : "bg-gray-500";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function CollapsibleCategory({
  category,
  items,
  accentColor,
  defaultOpen,
}: {
  category: string;
  items: SkillItem[];
  accentColor: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/8 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/4 hover:bg-white/7 transition text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${accentColor}`}>{category}</span>
          <span className="text-xs text-gray-500">{items.length} skill{items.length !== 1 ? "s" : ""}</span>
        </div>
        <span className="text-gray-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="divide-y divide-white/5">
          {items.map((item, i) => (
            <div key={i} className="px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-semibold text-white text-sm">{item.skill}</p>
                    <PriorityBadge priority={item.priority} />
                  </div>
                  <p className="text-gray-400 text-xs mb-1 leading-relaxed">{item.why_important}</p>
                  <DemandBar pct={item.demand_percentage} />
                  <p className={`text-xs mt-1.5 ${accentColor} opacity-70`}>
                    Time to learn: {item.time_to_learn}
                  </p>
                </div>
                <a
                  href={item.learning_resource || item.free_resource_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 border border-white/15 hover:border-white/30 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap"
                >
                  Learn free →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByCategory(items: SkillItem[]): Record<string, SkillItem[]> {
  const groups: Record<string, SkillItem[]> = {};
  for (const item of items) {
    const cat = item.category || "Concepts";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }
  return groups;
}

function sortItems(items: SkillItem[]): SkillItem[] {
  const pOrder = { High: 0, Medium: 1, Low: 2 };
  return [...items].sort((a, b) => {
    const pa = pOrder[(a.priority as keyof typeof pOrder) ?? "Low"] ?? 2;
    const pb = pOrder[(b.priority as keyof typeof pOrder) ?? "Low"] ?? 2;
    if (pa !== pb) return pa - pb;
    return (b.demand_percentage ?? 0) - (a.demand_percentage ?? 0);
  });
}

export default function SkillGap() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasFetched = useRef(false);

  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [result, setResult] = useState<SkillGapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [trendingSkills, setTrendingSkills] = useState<TrendingSkill[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("placeiq_profile");
      if (stored) {
        const p = JSON.parse(stored);
        setProfile({
          targetRole: p.targetRole || "",
          skills: Array.isArray(p.skills) ? p.skills : [],
          collegeTier: p.collegeTier || "",
          college: p.college || "",
          branch: p.branch || "",
          cgpa: Number(p.cgpa) || 0,
        });
      }
    } catch {}
    setProfileChecked(true);
  }, []);

  useEffect(() => {
    if (!profileChecked || profile) return;
    const timer = setTimeout(() => router.push('/onboarding'), 2000);
    return () => clearTimeout(timer);
  }, [profileChecked, profile]);

  useEffect(() => {
    if (profile && !hasFetched.current) {
      hasFetched.current = true;
      analyse(profile);
    }
  }, [profile]);

  useEffect(() => {
    const cached = localStorage.getItem("placeiq_trending_skills");
    if (cached) {
      try {
        const { skills, ts } = JSON.parse(cached);
        const ageHours = (Date.now() - ts) / 3600000;
        if (ageHours < 48 && skills?.length) {
          setTrendingSkills(skills);
          return;
        }
      } catch {}
    }
    setTrendingLoading(true);
    fetch(`${config.apiUrl}/api/skills/trending`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.skills?.length) {
          setTrendingSkills(data.skills);
          try { localStorage.setItem("placeiq_trending_skills", JSON.stringify({ skills: data.skills, ts: Date.now() })); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setTrendingLoading(false));
  }, []);

  const analyse = async (p: StoredProfile) => {
    try {
      const cached = localStorage.getItem("placeiq_skillgap");
      if (cached) {
        setResult(JSON.parse(cached));
        return;
      }
    } catch {}

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetchWithTimeout(`${config.apiUrl}/api/skills/gap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_role: p.targetRole,
          skills: p.skills,
          college_tier: p.collegeTier,
          college: p.college,
          branch: p.branch,
          cgpa: p.cgpa,
        }),
      }, 10000);

      if (!res) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Analysis failed");
      }

      const parsed = await res.json();
      if (!parsed) { setError("No response from server."); return; }
      if (parsed.error) { setError(parsed.error); return; }

      const newResult: SkillGapResult = {
        ...parsed,
        must_have_missing: parsed.must_have_missing || [],
        good_to_have_missing: parsed.good_to_have_missing || [],
        skills_to_improve: parsed.skills_to_improve || [],
        service_company_ready: parsed.service_company_ready ?? false,
        product_company_ready: parsed.product_company_ready ?? false,
        verdict: parsed.verdict || "",
      };
      setResult(newResult);
      try { localStorage.setItem("placeiq_skillgap", JSON.stringify(newResult)); } catch {}
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError("Backend is waking up, please wait 30 seconds and refresh.");
      } else {
        setError(err instanceof Error ? err.message : "Analysis failed. Make sure the backend is running.");
      }
    } finally {
      setLoading(false);
    }
  };

  const reAnalyse = () => {
    if (!profile) return;
    if (!window.confirm("This will replace your current skill gap analysis. Continue?")) return;
    localStorage.removeItem("placeiq_skillgap");
    hasFetched.current = false;
    analyse(profile);
  };

  if (status === "loading") return <LoadingScreen />;

  const mustSorted = result ? sortItems(result.must_have_missing) : [];
  const goodSorted = result ? sortItems(result.good_to_have_missing) : [];
  const allMissingCount = mustSorted.length + goodSorted.length;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-4xl mx-auto px-8 py-10">

        {/* ── Trending Skills 2025 ────────────────────────────────────────── */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-2xl font-bold">🔥 Trending Skills in 2025</h2>
            {trendingLoading && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
          </div>
          <p className="text-gray-500 text-sm mb-6">
            Most in-demand technical skills in the Indian + global job market right now — based on real hiring data.
          </p>
          {trendingSkills.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {trendingSkills.map((skill, i) => (
                <TrendingSkillCard key={i} skill={skill} />
              ))}
            </div>
          ) : !trendingLoading ? (
            <div className="text-center py-8 text-gray-600 text-sm">Could not load trending skills. Make sure the backend is running.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="bg-[#111] border border-gray-800 rounded-xl p-4 animate-pulse h-36" />
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-gray-800 mb-10" />

        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-3xl font-bold">Skill Gap Engine</h2>
            <p className="text-gray-400 mt-2">
              Analysing job postings to find what skills are in demand for your target role.
              {profile?.targetRole && (
                <span className="text-blue-400"> Targeting: {profile.targetRole}</span>
              )}
            </p>
          </div>
          {result && !loading && (
            <button
              onClick={reAnalyse}
              className="shrink-0 border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white px-4 py-2 rounded-lg text-sm transition"
            >
              Re-analyse
            </button>
          )}
        </div>

        {profileChecked && !profile && !loading && (
          <div className="mt-10 bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <p className="text-gray-300 mb-2">Complete your profile first to get personalised skill gap analysis.</p>
            <p className="text-gray-500 text-sm mb-6">Redirecting to onboarding in a moment…</p>
            <button
              onClick={() => router.push("/onboarding")}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              Complete Profile
            </button>
          </div>
        )}

        {loading && (
          <div className="mt-24 flex flex-col items-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-6" />
            <p className="text-gray-400 text-sm">Analysing job postings...</p>
          </div>
        )}

        {error && !loading && (
          <div className="mt-6 bg-red-950/40 border border-red-500/25 rounded-xl p-5">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={reAnalyse} className="mt-3 text-xs text-red-300 hover:text-white underline transition">
              Try again
            </button>
          </div>
        )}

        {result && !loading && (
          <div className="mt-8 space-y-8">

            {/* Readiness + match */}
            <div className="flex flex-wrap gap-3 items-center">
              <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium ${
                result.service_company_ready
                  ? "bg-green-500/15 border-green-500/30 text-green-400"
                  : "bg-red-500/15 border-red-500/30 text-red-400"
              }`}>
                {result.service_company_ready ? "✓" : "✗"} Service Company Ready
              </span>
              <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium ${
                result.product_company_ready
                  ? "bg-green-500/15 border-green-500/30 text-green-400"
                  : "bg-red-500/15 border-red-500/30 text-red-400"
              }`}>
                {result.product_company_ready ? "✓" : "✗"} Product Company Ready
              </span>
              {result.match_percentage != null && (
                <span className="ml-auto text-sm text-gray-400">
                  <span className="text-white font-semibold">{result.match_percentage}%</span> skill match
                  {allMissingCount > 0 && <span className="text-gray-600"> · {allMissingCount} gaps found</span>}
                </span>
              )}
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> High priority (≥40% demand)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Medium (20–40%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> Low (&lt;20%)
              </span>
            </div>

            {/* Must Have — grouped by category */}
            {mustSorted.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-red-400 mb-1">Must Have — Get These First</h3>
                <p className="text-gray-500 text-sm mb-4">Non-negotiable skills missing from your profile for this role.</p>
                <div className="space-y-2">
                  {CATEGORY_ORDER.filter(cat => groupByCategory(mustSorted)[cat]).map((cat, i) => (
                    <CollapsibleCategory
                      key={cat}
                      category={cat}
                      items={groupByCategory(mustSorted)[cat]}
                      accentColor="text-red-400"
                      defaultOpen={i === 0}
                    />
                  ))}
                  {/* Uncategorised */}
                  {groupByCategory(mustSorted)["Uncategorised"] && (
                    <CollapsibleCategory
                      category="Uncategorised"
                      items={groupByCategory(mustSorted)["Uncategorised"]}
                      accentColor="text-red-400"
                      defaultOpen={false}
                    />
                  )}
                </div>
              </section>
            )}

            {/* Good to Have — grouped by category */}
            {goodSorted.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-yellow-400 mb-1">Good to Have — Get an Edge</h3>
                <p className="text-gray-500 text-sm mb-4">Not mandatory but will significantly improve your chances.</p>
                <div className="space-y-2">
                  {CATEGORY_ORDER.filter(cat => groupByCategory(goodSorted)[cat]).map((cat, i) => (
                    <CollapsibleCategory
                      key={cat}
                      category={cat}
                      items={groupByCategory(goodSorted)[cat]}
                      accentColor="text-yellow-400"
                      defaultOpen={i === 0}
                    />
                  ))}
                  {groupByCategory(goodSorted)["Uncategorised"] && (
                    <CollapsibleCategory
                      category="Uncategorised"
                      items={groupByCategory(goodSorted)["Uncategorised"]}
                      accentColor="text-yellow-400"
                      defaultOpen={false}
                    />
                  )}
                </div>
              </section>
            )}

            {/* Skills to Strengthen */}
            {result.skills_to_improve.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-blue-400 mb-1">Skills to Strengthen</h3>
                <p className="text-gray-500 text-sm mb-4">You have these listed but likely need to deepen them.</p>
                <div className="space-y-3">
                  {result.skills_to_improve.map((item, i) => (
                    <div key={i} className="bg-blue-950/20 border border-blue-500/20 rounded-xl p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-white">{item.skill}</p>
                            {item.category && (
                              <span className="text-[10px] text-blue-400/70 bg-blue-500/10 px-2 py-0.5 rounded-full">
                                {item.category}
                              </span>
                            )}
                          </div>
                          <p className="text-gray-400 text-sm leading-relaxed">{item.what_to_focus_on}</p>
                        </div>
                        <a
                          href={item.learning_resource || item.free_resource_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-300 text-xs px-3 py-1.5 rounded-lg transition"
                        >
                          Learn free →
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* All gaps filled */}
            {mustSorted.length === 0 && goodSorted.length === 0 && (
              <div className="bg-green-950/30 border border-green-500/25 rounded-2xl p-6 text-center">
                <p className="text-green-400 font-semibold text-lg mb-1">Strong profile for this role</p>
                <p className="text-gray-400 text-sm">No critical skill gaps detected. Focus on deepening what you already have.</p>
              </div>
            )}

            {/* Verdict */}
            <div className="bg-[#111] border border-gray-700 rounded-2xl p-6">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Market Verdict</p>
              <p className="text-gray-200 leading-relaxed font-medium">{result.verdict}</p>
            </div>

            {/* Data attribution */}
            <div className="space-y-1 pb-2">
              {result.total_roles_analysed && result.total_roles_analysed > 0 ? (
                <p className="text-xs text-gray-600 text-center">
                  Based on{" "}
                  <span className="text-gray-500">{result.total_roles_analysed.toLocaleString()}</span>{" "}
                  job postings for{" "}
                  <span className="text-gray-500">{profile?.targetRole || "your target role"}</span>
                  {result.data_source ? ` · ${result.data_source}` : ""}
                </p>
              ) : null}
              {result.college_info && result.college_info.sources_count > 0 ? (
                <p className="text-xs text-gray-600 text-center">
                  Calibrated for{" "}
                  <span className="text-gray-500">{result.college_info.college_name}</span>{" "}
                  ({result.college_info.college_tier}) · {result.college_info.sources_count} data source{result.college_info.sources_count !== 1 ? "s" : ""} · 2024
                </p>
              ) : profile?.college ? (
                <p className="text-xs text-gray-600 text-center">
                  Calibrated for{" "}
                  <span className="text-gray-500">{profile.college}</span>{" "}
                  ({profile.collegeTier})
                </p>
              ) : null}
              <p className="text-xs text-gray-600 text-center">
                {result.skill_demand_last_updated
                  ? `Skill demand data last updated: ${new Date(result.skill_demand_last_updated).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} — refreshes daily`
                  : "Skill demand data refreshes daily"}
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
