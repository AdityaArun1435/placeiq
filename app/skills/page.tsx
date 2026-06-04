"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Flame, Check, X } from "lucide-react";
import config, { fetchWithTimeout } from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

type TrendingSkill = {
  skill_name: string;
  category: string;
  demand_score: number;
  why_it_matters: string;
  free_resource: string;
};

function TrendingSkillCard({ skill }: { skill: TrendingSkill }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 10,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        transition: "border-color 150ms ease-out",
      }}
      onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)")}
      onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-default)")}
    >
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <h4 style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 13, lineHeight: 1.3 }}>{skill.skill_name}</h4>
          <span style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 9999,
            fontWeight: 500,
            background: "var(--accent-blue-muted)",
            color: "var(--accent-blue)",
            flexShrink: 0,
          }}>
            {skill.category}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ flex: 1, height: 3, background: "var(--border-default)", borderRadius: 9999, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 9999, background: "var(--accent-blue)", width: `${skill.demand_score}%` }} />
          </div>
          <span style={{ fontSize: 10, color: "var(--text-tertiary)", width: 28, textAlign: "right", flexShrink: 0 }}>{skill.demand_score}%</span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, flex: 1 }}>{skill.why_it_matters}</p>
      {skill.free_resource && (
        <a
          href={skill.free_resource}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            background: "transparent",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
            borderRadius: 6,
            padding: "7px 14px",
            fontSize: 13,
            textAlign: "center",
            textDecoration: "none",
            fontWeight: 500,
            transition: "color 150ms ease-out, border-color 150ms ease-out",
            boxSizing: "border-box",
          }}
          onMouseEnter={e => { const el = e.currentTarget; el.style.color = "var(--text-primary)"; el.style.borderColor = "var(--border-strong)"; }}
          onMouseLeave={e => { const el = e.currentTarget; el.style.color = "var(--text-secondary)"; el.style.borderColor = "var(--border-default)"; }}
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
  Low: { bg: "bg-gray-500/15", text: "text-muted", border: "border-gray-500/20" },
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
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border-default)" }}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[10px] text-faint w-8 text-right">{pct}%</span>
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
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-default)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 transition text-left bg-elevated hover:bg-[var(--bg-hover)]"
      >
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${accentColor}`}>{category}</span>
          <span className="text-xs text-faint">{items.length} skill{items.length !== 1 ? "s" : ""}</span>
        </div>
        <span className="text-faint text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div>
          {items.map((item, i) => (
            <div key={i} className="px-4 py-4 border-t border-theme">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-semibold text-main text-sm">{item.skill}</p>
                    <PriorityBadge priority={item.priority} />
                  </div>
                  <p className="text-muted text-xs mb-1 leading-relaxed">{item.why_important}</p>
                  <DemandBar pct={item.demand_percentage} />
                  <p className={`text-xs mt-1.5 ${accentColor} opacity-70`}>
                    Time to learn: {item.time_to_learn}
                  </p>
                </div>
                <a
                  href={item.learning_resource || item.free_resource_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 border border-theme hover:border-theme text-muted hover:text-main text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap"
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

type RoleGap = {
  role: string;
  missing_critical: string[];
  missing_good: string[];
  has_skills: string[];
  match_percentage: number;
  resources: Record<string, string>;
  core_skills: string[];
  good_to_have: string[];
};

export default function SkillGap() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasFetched = useRef(false);

  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [result, setResult] = useState<SkillGapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [roleGap, setRoleGap] = useState<RoleGap | null>(null);
  const [roleGapLoading, setRoleGapLoading] = useState(false);

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
      // Fetch role-based skill gap
      const role = profile.targetRole || "Software Engineer";
      const skillsJoined = (profile.skills || []).join(",");
      setRoleGapLoading(true);
      fetch(`${config.apiUrl}/api/role/skill-gap?role=${encodeURIComponent(role)}&user_skills=${encodeURIComponent(skillsJoined)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setRoleGap(data); })
        .catch(() => {})
        .finally(() => setRoleGapLoading(false));
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
    <main className="min-h-screen bg-primary-bg text-main">
      <div className="max-w-4xl mx-auto px-8 py-10">

        {/* ── Trending Skills 2025 ────────────────────────────────────────── */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-2xl font-bold flex items-center gap-2"><Flame size={22} className="text-orange-400" /> Trending Skills in 2025</h2>
            {trendingLoading && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
          </div>
          <p className="text-faint text-sm mb-6">
            Most in-demand technical skills in the Indian + global job market right now — based on real hiring data.
          </p>
          {trendingSkills.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {trendingSkills.map((skill, i) => (
                <TrendingSkillCard key={i} skill={skill} />
              ))}
            </div>
          ) : !trendingLoading ? (
            <div className="text-center py-8 text-faint text-sm">Could not load trending skills. Make sure the backend is running.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="bg-surface border border-theme rounded-xl p-4 animate-pulse h-36" />
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-theme mb-10" />

        {/* Role-Based Skill Gap Section */}
        {(roleGap || roleGapLoading) && (
          <section className="mb-10">
            <h2 className="text-2xl font-bold mb-1">
              Skill Gap for {profile?.targetRole || "Software Engineer"}
            </h2>
            <p className="text-faint text-sm mb-4">Based on what companies actually require for this role.</p>

            {roleGapLoading && (
              <div className="flex items-center gap-3 py-6">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-muted text-sm">Loading role requirements...</span>
              </div>
            )}

            {roleGap && !roleGapLoading && (
              <div className="space-y-5">
                {/* Match percentage bar */}
                <div className="bg-surface border border-theme rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-main">Core Skill Match</span>
                    <span className="text-sm font-bold" style={{ color: roleGap.match_percentage >= 70 ? "var(--accent-green)" : roleGap.match_percentage >= 30 ? "var(--accent-amber)" : "#ef4444" }}>
                      {roleGap.match_percentage}%
                    </span>
                  </div>
                  <div style={{ height: 8, background: "var(--border-default)", borderRadius: 9999, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 9999,
                      width: `${roleGap.match_percentage}%`,
                      background: roleGap.match_percentage >= 70 ? "var(--accent-green)" : roleGap.match_percentage >= 30 ? "var(--accent-amber)" : "#ef4444",
                      transition: "width 0.8s ease-out",
                    }} />
                  </div>
                  <p className="text-xs text-faint mt-2">{roleGap.has_skills.length} of {roleGap.core_skills.length} core skills matched</p>
                </div>

                {/* Missing Critical */}
                {roleGap.missing_critical.length > 0 && (
                  <div className="bg-surface border border-theme rounded-xl p-5">
                    <h4 className="text-sm font-semibold mb-3" style={{ color: "#ef4444" }}>Must Learn — Core Requirements</h4>
                    <div className="flex flex-wrap gap-2">
                      {roleGap.missing_critical.map(skill => (
                        <span key={skill} className="text-xs px-3 py-1 rounded-full font-medium" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                          Must Learn: {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing Good to Have */}
                {roleGap.missing_good.length > 0 && (
                  <div className="bg-surface border border-theme rounded-xl p-5">
                    <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--accent-amber)" }}>Good to Have — Get an Edge</h4>
                    <div className="flex flex-wrap gap-2">
                      {roleGap.missing_good.map(skill => (
                        <span key={skill} className="text-xs px-3 py-1 rounded-full font-medium" style={{ background: "rgba(245,158,11,0.1)", color: "var(--accent-amber)", border: "1px solid rgba(245,158,11,0.3)" }}>
                          Good to Have: {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Role Resources */}
                {Object.keys(roleGap.resources).length > 0 && (
                  <div className="bg-surface border border-theme rounded-xl p-5">
                    <h4 className="text-sm font-semibold mb-3 text-main">Curated Resources for {profile?.targetRole || "your role"}</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(roleGap.resources).map(([key, url]) => (
                        <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                          className="text-xs px-3 py-1.5 rounded-lg border border-theme text-muted hover:text-main hover:border-gray-500 transition capitalize">
                          {key.replace(/_/g, " ")} →
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <div className="border-t border-theme mb-10" />

        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-3xl font-bold">Skill Gap Engine</h2>
            <p className="text-muted mt-2">
              Analysing job postings to find what skills are in demand for your target role.
              {profile?.targetRole && (
                <span className="text-blue-400"> Targeting: {profile.targetRole}</span>
              )}
            </p>
          </div>
          {result && !loading && (
            <button
              onClick={reAnalyse}
              className="shrink-0 border border-theme text-muted hover:border-gray-500 hover:text-main px-4 py-2 rounded-lg text-sm transition"
            >
              Re-analyse
            </button>
          )}
        </div>

        {profileChecked && !profile && !loading && (
          <div className="mt-10 bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <p className="text-muted mb-2">Complete your profile first to get personalised skill gap analysis.</p>
            <p className="text-faint text-sm mb-6">Redirecting to onboarding in a moment…</p>
            <button
              onClick={() => router.push("/onboarding")}
              className="bg-blue-600 hover:bg-blue-500 text-main px-6 py-3 rounded-lg font-medium transition"
            >
              Complete Profile
            </button>
          </div>
        )}

        {loading && (
          <div className="mt-24 flex flex-col items-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-6" />
            <p className="text-muted text-sm">Analysing job postings...</p>
          </div>
        )}

        {error && !loading && (
          <div className="mt-6 bg-red-950/40 border border-red-500/25 rounded-xl p-5">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={reAnalyse} className="mt-3 text-xs text-red-300 hover:text-main underline transition">
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
                {result.service_company_ready ? <Check size={14} className="inline" /> : <X size={14} className="inline" />} Service Company Ready
              </span>
              <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium ${
                result.product_company_ready
                  ? "bg-green-500/15 border-green-500/30 text-green-400"
                  : "bg-red-500/15 border-red-500/30 text-red-400"
              }`}>
                {result.product_company_ready ? <Check size={14} className="inline" /> : <X size={14} className="inline" />} Product Company Ready
              </span>
              {result.match_percentage != null && (
                <span className="ml-auto text-sm text-muted">
                  <span className="text-main font-semibold">{result.match_percentage}%</span> skill match
                  {allMissingCount > 0 && <span className="text-faint"> · {allMissingCount} gaps found</span>}
                </span>
              )}
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-faint">
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
                <p className="text-faint text-sm mb-4">Non-negotiable skills missing from your profile for this role.</p>
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
                <p className="text-faint text-sm mb-4">Not mandatory but will significantly improve your chances.</p>
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
                <p className="text-faint text-sm mb-4">You have these listed but likely need to deepen them.</p>
                <div className="space-y-3">
                  {result.skills_to_improve.map((item, i) => (
                    <div key={i} className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-main">{item.skill}</p>
                            {item.category && (
                              <span className="text-[10px] text-blue-400/70 bg-blue-500/10 px-2 py-0.5 rounded-full">
                                {item.category}
                              </span>
                            )}
                          </div>
                          <p className="text-muted text-sm leading-relaxed">{item.what_to_focus_on}</p>
                        </div>
                        <a
                          href={item.learning_resource || item.free_resource_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs rounded-lg transition"
                          style={{ background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-primary)", borderRadius: 6, padding: "6px 14px", fontSize: 13 }}
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
                <p className="text-muted text-sm">No critical skill gaps detected. Focus on deepening what you already have.</p>
              </div>
            )}

            {/* Verdict */}
            <div className="bg-surface border border-theme rounded-2xl p-6">
              <p className="text-xs text-faint uppercase tracking-widest mb-3">Market Verdict</p>
              <p className="text-muted leading-relaxed font-medium">{result.verdict}</p>
            </div>

            {/* Data attribution */}
            <div className="space-y-1 pb-2">
              {result.total_roles_analysed && result.total_roles_analysed > 0 ? (
                <p className="text-xs text-faint text-center">
                  Based on{" "}
                  <span className="text-faint">{result.total_roles_analysed.toLocaleString()}</span>{" "}
                  job postings for{" "}
                  <span className="text-faint">{profile?.targetRole || "your target role"}</span>
                  {result.data_source ? ` · ${result.data_source}` : ""}
                </p>
              ) : null}
              {result.college_info && result.college_info.sources_count > 0 ? (
                <p className="text-xs text-faint text-center">
                  Calibrated for{" "}
                  <span className="text-faint">{result.college_info.college_name}</span>{" "}
                  ({result.college_info.college_tier}) · {result.college_info.sources_count} data source{result.college_info.sources_count !== 1 ? "s" : ""} · 2024
                </p>
              ) : profile?.college ? (
                <p className="text-xs text-faint text-center">
                  Calibrated for{" "}
                  <span className="text-faint">{profile.college}</span>{" "}
                  ({profile.collegeTier})
                </p>
              ) : null}
              <p className="text-xs text-faint text-center">
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
