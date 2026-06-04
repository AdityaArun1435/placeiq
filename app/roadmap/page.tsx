"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import config, { fetchWithTimeout } from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

type Task = {
  name: string;
  description: string;
  time_per_day: string;
  priority: "Critical" | "High" | "Medium";
  resource_link: string;
};

type Phase = {
  goal: string;
  tasks: Task[];
};

type Milestone = {
  day: number;
  milestone: string;
};

type Roadmap = {
  overview: string;
  day_30: Phase;
  day_60: Phase;
  day_90: Phase;
  daily_schedule: {
    morning: string;
    evening: string;
    weekend: string;
  };
  milestones: Milestone[];
  warnings: string[];
};

type StoredProfile = {
  college: string;
  collegeTier: string;
  branch: string;
  cgpa: number;
  skills: string[];
  targetRole: string;
  leetcodeCount: string;
  projectsCount: string;
  hasInternship: string;
  internshipMonths: string;
};

type CollegeSalaryData = {
  combined_median_salary: number | null;
  combined_placement_rate: number | null;
  sources_count: number;
  nirf_stats: { college_name: string; matched: boolean } | null;
};

type ChatMessage = {
  role: "user" | "ai";
  text: string;
};

const PRIORITY_STYLES: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-400 border-red-500/30",
  High: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  Medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

function TaskCard({ task }: { task: Task }) {
  const isValidUrl =
    task.resource_link &&
    (task.resource_link.startsWith("http://") || task.resource_link.startsWith("https://"));

  return (
    <div className="bg-primary-bg border border-theme rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-main leading-snug">{task.name}</p>
        <span
          className={`shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium ${
            PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.Medium
          }`}
        >
          {task.priority}
        </span>
      </div>
      <p className="text-xs text-muted leading-relaxed mb-3">{task.description}</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-faint">{task.time_per_day}</span>
        {isValidUrl && (
          <a
            href={task.resource_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 transition"
          >
            Free resource &rarr;
          </a>
        )}
      </div>
    </div>
  );
}

function PhaseColumn({
  label,
  phase,
  accent,
}: {
  label: string;
  phase: Phase;
  accent: string;
}) {
  return (
    <div className="bg-surface border border-theme rounded-2xl p-6">
      <div className={`text-xs font-semibold uppercase tracking-widest mb-1 ${accent}`}>
        {label}
      </div>
      <p className="text-sm text-muted mb-4 leading-snug">{phase.goal}</p>
      <div className="space-y-3">
        {(phase.tasks ?? []).map((task, i) => (
          <TaskCard key={i} task={task} />
        ))}
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasFetched = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  type RoleRoadmap = { role: string; match_percentage: number; personalized_intro: string; phase_1: { weeks: string; label: string; tasks: string[] }; phase_2: { weeks: string; label: string; tasks: string[] }; phase_3: { weeks: string; label: string; tasks: string[] }; missing_critical: string[] };
  const [roleRoadmap, setRoleRoadmap] = useState<RoleRoadmap | null>(null);
  const [collegeSalary, setCollegeSalary] = useState<CollegeSalaryData | null>(null);

  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [toast, setToast] = useState("");

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
          collegeTier: p.collegeTier || "",
          branch: p.branch || "",
          cgpa: Number(p.cgpa) || 0,
          skills: Array.isArray(p.skills) ? p.skills : [],
          targetRole: p.targetRole || "",
          leetcodeCount: p.leetcodeCount || "0",
          projectsCount: p.projectsCount || "0",
          hasInternship: p.hasInternship || "no",
          internshipMonths: p.internshipMonths || "",
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
      generate(profile);
      // Fetch role-specific roadmap
      const role = profile.targetRole || "Software Engineer";
      const skillsJoined = (profile.skills || []).join(",");
      const tierNum = profile.collegeTier?.includes("1") ? 1 : 2;
      fetch(`${config.apiUrl}/api/role/roadmap/${encodeURIComponent(role)}?user_skills=${encodeURIComponent(skillsJoined)}&cgpa=${profile.cgpa}&college_tier=${tierNum}&weeks_to_placement=12`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setRoleRoadmap(data); })
        .catch(() => {});
    }
    if (profile?.college) {
      fetch(`${config.apiUrl}/api/placement/sources?college=${encodeURIComponent(profile.college)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setCollegeSalary(d); })
        .catch(() => {});
    }
  }, [profile]);

  // Scroll chat to bottom whenever history grows
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const generate = async (p: StoredProfile) => {
    // Serve from cache unless this is an explicit regenerate
    try {
      const cached = localStorage.getItem("placeiq_roadmap");
      if (cached) {
        setRoadmap(JSON.parse(cached));
        return;
      }
    } catch {}

    setLoading(true);
    setError("");
    setRoadmap(null);
    setChatHistory([]);

    let mustHaveMissing: string[] = [];

    try {
      setStatusMsg("Analysing your skill gaps...");
      const gapRes = await fetchWithTimeout(`${config.apiUrl}/api/skills/gap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_role: p.targetRole,
          skills: p.skills,
          college_tier: p.collegeTier,
          branch: p.branch,
          cgpa: p.cgpa,
        }),
      }, 10000);
      if (gapRes && gapRes.ok) {
        const gapData = await gapRes.json();
        if (gapData && Array.isArray(gapData.must_have_missing)) {
          mustHaveMissing = gapData.must_have_missing
            .slice(0, 5)
            .map((item: { skill: string }) => item.skill);
        }
      }
    } catch {
      // silently continue
    }

    try {
      setStatusMsg("Building your personalised roadmap...");
      const res = await fetchWithTimeout(`${config.apiUrl}/api/roadmap/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          college: p.college,
          college_tier: p.collegeTier,
          branch: p.branch,
          cgpa: p.cgpa,
          skills: p.skills,
          target_role: p.targetRole,
          target_companies: [],
          leetcode_count: p.leetcodeCount,
          projects_count: p.projectsCount,
          has_internship: p.hasInternship,
          internship_months: p.internshipMonths,
          must_have_missing: mustHaveMissing,
        }),
      });

      if (!res) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to generate roadmap");
      }

      const parsed = await res.json();
      if (!parsed) throw new Error("Empty response from server");
      if (parsed.error) throw new Error(parsed.error);
      setRoadmap(parsed);
      try { localStorage.setItem("placeiq_roadmap", JSON.stringify(parsed)); } catch {}
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError("Backend is waking up, please wait 30 seconds and refresh.");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to generate roadmap. Make sure the backend is running."
        );
      }
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  const regenerate = () => {
    if (!profile) return;
    if (
      !window.confirm(
        "Are you sure? This will replace your current roadmap and cannot be undone."
      )
    )
      return;
    localStorage.removeItem("placeiq_roadmap");
    hasFetched.current = false;
    generate(profile);
  };

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || !roadmap || chatLoading) return;

    setChatInput("");
    setChatHistory(h => [...h, { role: "user", text: msg }]);
    setChatLoading(true);

    try {
      const res = await fetch(`${config.apiUrl}/api/roadmap/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: msg,
          current_roadmap: roadmap,
          profile: profile
            ? {
                college: profile.college,
                college_tier: profile.collegeTier,
                branch: profile.branch,
                cgpa: profile.cgpa,
                skills: profile.skills,
                target_role: profile.targetRole,
                leetcode_count: profile.leetcodeCount,
                projects_count: profile.projectsCount,
                has_internship: profile.hasInternship,
              }
            : {},
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Chat request failed");
      }

      const parsed = await res.json();
      if (!parsed) throw new Error("Empty response");

      if (parsed.type === "roadmap_update" && parsed.updated_roadmap) {
        setRoadmap(parsed.updated_roadmap);
        try { localStorage.setItem("placeiq_roadmap", JSON.stringify(parsed.updated_roadmap)); } catch {}
        setChatHistory(h => [
          ...h,
          { role: "ai", text: "Done! I've updated your roadmap based on your request." },
        ]);
        showToast("Roadmap updated!");
      } else if (parsed.type === "message" && parsed.message) {
        setChatHistory(h => [...h, { role: "ai", text: parsed.message }]);
      } else {
        setChatHistory(h => [
          ...h,
          { role: "ai", text: "Sorry, I couldn't process that. Please try rephrasing." },
        ]);
      }
    } catch (err: unknown) {
      setChatHistory(h => [
        ...h,
        {
          role: "ai",
          text:
            err instanceof Error
              ? err.message
              : "Something went wrong. Make sure the backend is running.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  if (status === "loading") return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-primary-bg text-main">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-main text-sm px-5 py-2.5 rounded-xl shadow-lg transition-all">
          {toast}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-3xl font-bold">Prep Roadmap</h2>
            <p className="text-muted mt-2">
              Your personalised 90-day placement preparation plan.
              {profile?.targetRole && (
                <span className="text-blue-400"> Targeting: {profile.targetRole}</span>
              )}
            </p>
          </div>
          {roadmap && !loading && (
            <button
              onClick={regenerate}
              className="shrink-0 border border-theme text-muted hover:border-gray-500 hover:text-main px-4 py-2 rounded-lg text-sm transition"
            >
              Regenerate Roadmap
            </button>
          )}
        </div>

        {/* No profile */}
        {profileChecked && !profile && !loading && (
          <div className="mt-10 bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <h3 className="text-xl font-bold mb-2">Complete your profile first</h3>
            <p className="text-muted mb-2">
              We need your college, skills, and goals to generate a personalised roadmap.
            </p>
            <p className="text-faint text-sm mb-6">Redirecting to onboarding in a moment…</p>
            <button
              onClick={() => router.push("/onboarding")}
              className="bg-blue-600 hover:bg-blue-500 text-main px-8 py-3 rounded-lg font-medium transition"
            >
              Get Started →
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-20 flex flex-col items-center gap-6">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-muted text-sm">{statusMsg}</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mt-10 bg-red-600/10 border border-red-500/30 rounded-2xl p-6 text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={regenerate}
              className="border border-theme text-muted hover:text-main px-4 py-2 rounded-lg text-sm transition"
            >
              Try again
            </button>
          </div>
        )}

        {/* Roadmap content */}
        {roadmap && !loading && (
          <div className="mt-8 space-y-8">
            {/* Overview */}
            <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl px-6 py-5">
              <p className="text-xs text-blue-400 uppercase tracking-widest mb-2">Overview</p>
              <p className="text-muted leading-relaxed">{roadmap.overview}</p>
            </div>

            {/* Salary target from combined sources */}
            {collegeSalary && collegeSalary.combined_median_salary != null && (
              <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-400">
                    Salary Target: {collegeSalary.combined_median_salary} LPA median
                  </p>
                  <p className="text-xs text-faint mt-0.5">
                    Based on {collegeSalary.sources_count} source{collegeSalary.sources_count !== 1 ? "s" : ""} for {profile?.college} · 2024
                  </p>
                </div>
                <span className="text-xs text-faint bg-elevated px-2.5 py-1 rounded-full shrink-0">
                  {collegeSalary.sources_count} source{collegeSalary.sources_count !== 1 ? "s" : ""}
                </span>
              </div>
            )}

            {/* Role-specific roadmap milestones */}
            {roleRoadmap && (
              <div className="bg-surface border border-theme rounded-2xl p-5">
                <p className="text-xs text-faint uppercase tracking-widest mb-3">Role-Specific Plan · {roleRoadmap.role}</p>
                {roleRoadmap.personalized_intro && (
                  <p className="text-sm text-muted leading-relaxed mb-4 italic">{roleRoadmap.personalized_intro}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[roleRoadmap.phase_1, roleRoadmap.phase_2, roleRoadmap.phase_3].map((phase, i) => (
                    <div key={i} className="bg-primary-bg border border-theme rounded-xl p-4">
                      <p className={`text-xs font-semibold uppercase tracking-widest mb-2 ${["text-blue-400", "text-purple-400", "text-green-400"][i]}`}>
                        {phase.label} · {phase.weeks}
                      </p>
                      <ul className="space-y-1.5">
                        {phase.tasks.map((t, j) => (
                          <li key={j} className="text-xs text-muted flex gap-2">
                            <span className="text-faint mt-0.5">·</span><span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 30/60/90 columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <PhaseColumn label="Days 1–30" phase={roadmap.day_30} accent="text-blue-400" />
              <PhaseColumn label="Days 31–60" phase={roadmap.day_60} accent="text-purple-400" />
              <PhaseColumn label="Days 61–90" phase={roadmap.day_90} accent="text-green-400" />
            </div>

            {/* Daily Schedule */}
            <div className="bg-surface border border-theme rounded-2xl p-6">
              <h3 className="font-semibold mb-4">Daily Schedule</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Morning", value: roadmap.daily_schedule?.morning, color: "text-yellow-400" },
                  { label: "Evening", value: roadmap.daily_schedule?.evening, color: "text-blue-400" },
                  { label: "Weekend", value: roadmap.daily_schedule?.weekend, color: "text-green-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-primary-bg border border-theme rounded-xl p-4">
                    <p className={`text-xs font-semibold uppercase tracking-widest mb-2 ${color}`}>
                      {label}
                    </p>
                    <p className="text-sm text-muted leading-relaxed">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Milestones */}
            {roadmap.milestones && roadmap.milestones.length > 0 && (
              <div className="bg-surface border border-theme rounded-2xl p-6">
                <h3 className="font-semibold mb-6">Milestones</h3>
                <div className="relative">
                  <div className="absolute left-[52px] top-0 bottom-0 w-px" style={{ background: "var(--border-default)" }} />
                  <div className="space-y-5">
                    {roadmap.milestones.map((m, i) => (
                      <div key={i} className="flex items-start gap-4">
                        <div className="shrink-0 w-[52px] text-right">
                          <span className="text-xs text-faint" style={{ fontFamily: "var(--font-mono)" }}>Day {m.day}</span>
                        </div>
                        <div className="shrink-0 rounded-full bg-blue-500 mt-1 relative z-10" style={{ width: 8, height: 8 }} />
                        <p className="text-sm text-main leading-snug">{m.milestone}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Warnings */}
            {roadmap.warnings && roadmap.warnings.length > 0 && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.04)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderLeft: '3px solid #ef4444',
                borderRadius: 8,
                padding: '16px 20px',
              }}>
                <h3 style={{ color: '#ef4444', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                  Warnings
                </h3>
                <ul className="space-y-2.5">
                  {roadmap.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-main" style={{ fontSize: 14, lineHeight: 1.6 }}>
                      <span style={{ color: '#ef4444', fontSize: 14, flexShrink: 0, marginTop: 2 }}>!</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI Chat */}
            <div className="bg-surface border border-theme rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-theme">
                <h3 className="font-semibold">Ask AI to adjust your roadmap</h3>
                <p className="text-faint text-xs mt-0.5">
                  Ask to modify tasks, change time allocation, or get advice
                </p>
              </div>

              {/* Chat history */}
              {chatHistory.length > 0 && (
                <div className="px-6 py-4 space-y-4 max-h-80 overflow-y-auto">
                  {chatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-blue-600 text-main rounded-br-sm"
                            : "bg-elevated border border-theme text-muted rounded-bl-sm"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-elevated border border-theme rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              {/* Input */}
              <div className="px-6 py-4 flex gap-3">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  disabled={chatLoading}
                  placeholder={
                    chatHistory.length === 0
                      ? 'e.g. "I only have 1 hour per day, adjust the roadmap"'
                      : "Ask a follow-up..."
                  }
                  className="flex-1 bg-primary-bg border border-theme rounded-xl px-4 py-2.5 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50 transition"
                />
                <button
                  onClick={sendChat}
                  disabled={!chatInput.trim() || chatLoading}
                  className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-main px-5 py-2.5 rounded-xl text-sm font-medium transition"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
