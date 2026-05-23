"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import config from '@/lib/config'

// ── Types ──────────────────────────────────────────────────────────────────────

type LearningSkill = {
  id: string;
  name: string;
  addedAt: string;
  completedAt?: string;
  completed: boolean;
};

type ProgressData = {
  skills: LearningSkill[];
  streak: { lastDate: string; count: number };
};

type SkillGapResult = {
  must_have_missing: Array<{ skill: string }>;
  good_to_have_missing: Array<{ skill: string }>;
};

type CodingProfiles = {
  leetcode: string;
  codechef: string;
  codeforces: string;
};

type LeetCodeStats = {
  username: string;
  total_solved: number;
  easy_solved: number;
  medium_solved: number;
  hard_solved: number;
  ranking: number;
  profile_url: string;
};

type CodeChefStats = {
  username: string;
  rating: number;
  highest_rating: number;
  stars: number;
  global_rank: number;
  country_rank: number;
  problems_solved: number;
  profile_url: string;
};

type CodeforcesStats = {
  username: string;
  rating: number;
  max_rating: number;
  rank: string;
  max_rank: string;
  contribution: number;
  profile_url: string;
};

type CodingStatsResult = {
  leetcode?: LeetCodeStats | { error: string };
  codechef?: CodeChefStats | { error: string };
  codeforces?: CodeforcesStats | { error: string };
};

// ── Constants ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "placeiq_progress";
const PROFILES_KEY = "placeiq_coding_profiles";

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadData(): ProgressData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { skills: [], streak: { lastDate: "", count: 0 } };
}

function saveData(data: ProgressData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function loadProfiles(): CodingProfiles {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { leetcode: "", codechef: "", codeforces: "" };
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function updateStreak(data: ProgressData): ProgressData {
  const today = todayStr();
  if (data.streak.lastDate === today) return data;
  const count = data.streak.lastDate === yesterdayStr() ? data.streak.count + 1 : 1;
  return { ...data, streak: { lastDate: today, count } };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function getCfRankColor(rank: string): string {
  const r = (rank || "").toLowerCase();
  if (r.includes("legendary grandmaster")) return "text-red-500";
  if (r.includes("international grandmaster")) return "text-red-400";
  if (r.includes("grandmaster")) return "text-red-400";
  if (r.includes("international master")) return "text-orange-400";
  if (r.includes("master")) return "text-orange-400";
  if (r.includes("candidate master")) return "text-purple-400";
  if (r.includes("expert")) return "text-blue-400";
  if (r.includes("specialist")) return "text-cyan-400";
  if (r.includes("pupil")) return "text-green-400";
  return "text-gray-400";
}

function getCfRatingColor(rating: number): string {
  if (rating >= 2400) return "text-red-400";
  if (rating >= 2100) return "text-orange-400";
  if (rating >= 1900) return "text-purple-400";
  if (rating >= 1600) return "text-blue-400";
  if (rating >= 1400) return "text-cyan-400";
  if (rating >= 1200) return "text-green-400";
  return "text-gray-400";
}

function getMotivation(total: number): string {
  if (total >= 500) return "Exceptional coder!";
  if (total >= 300) return "Strong profile!";
  if (total >= 100) return "Good progress!";
  return "Keep grinding!";
}

function hasError(s: unknown): s is { error: string } {
  return typeof s === "object" && s !== null && "error" in s && typeof (s as Record<string, unknown>).error === "string";
}

// ── Star display ───────────────────────────────────────────────────────────────

function StarDisplay({ stars, total = 7 }: { stars: number; total?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`text-base ${i < stars ? "text-yellow-400" : "text-gray-700"}`}>★</span>
      ))}
    </div>
  );
}

// ── LeetCode Donut Chart ───────────────────────────────────────────────────────

function LeetCodeDonut({ easy, medium, hard }: { easy: number; medium: number; hard: number }) {
  const total = easy + medium + hard;
  if (total === 0) return <div className="w-[140px] h-[140px] flex items-center justify-center text-gray-600 text-xs">No data</div>;
  const data = [
    { name: "Easy", value: easy, color: "#22c55e" },
    { name: "Medium", value: medium, color: "#eab308" },
    { name: "Hard", value: hard, color: "#ef4444" },
  ].filter(d => d.value > 0);
  return (
    <div className="relative">
      <PieChart width={140} height={140}>
        <Pie data={data} cx={65} cy={65} innerRadius={42} outerRadius={65} dataKey="value" stroke="none">
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
        />
      </PieChart>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white font-bold text-lg">{total}</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProgressTracker() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [data, setData] = useState<ProgressData>({ skills: [], streak: { lastDate: "", count: 0 } });
  const [input, setInput] = useState("");
  const [skillGap, setSkillGap] = useState<SkillGapResult | null>(null);

  // Coding profiles state
  const [profiles, setProfiles] = useState<CodingProfiles>({ leetcode: "", codechef: "", codeforces: "" });
  const [editProfiles, setEditProfiles] = useState<CodingProfiles>({ leetcode: "", codechef: "", codeforces: "" });
  const [savedFlags, setSavedFlags] = useState({ leetcode: false, codechef: false, codeforces: false });
  const [codingStats, setCodingStats] = useState<CodingStatsResult | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    setData(loadData());
    try {
      const raw = localStorage.getItem("placeiq_skillgap");
      if (raw) setSkillGap(JSON.parse(raw));
    } catch {}
    const saved = loadProfiles();
    setProfiles(saved);
    setEditProfiles(saved);
    setSavedFlags({
      leetcode: !!saved.leetcode,
      codechef: !!saved.codechef,
      codeforces: !!saved.codeforces,
    });
    if (saved.leetcode || saved.codechef || saved.codeforces) {
      fetchCodingStats(saved);
    }
  }, []);

  async function fetchCodingStats(p: CodingProfiles) {
    if (!p.leetcode && !p.codechef && !p.codeforces) return;
    setLoadingStats(true);
    setStatsError("");
    try {
      const params = new URLSearchParams();
      if (p.leetcode) params.set("leetcode", p.leetcode);
      if (p.codechef) params.set("codechef", p.codechef);
      if (p.codeforces) params.set("codeforces", p.codeforces);
      const res = await fetch(`${config.apiUrl}/api/coding/stats?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      setCodingStats(await res.json());
    } catch (e: unknown) {
      setStatsError(e instanceof Error ? e.message : "Failed to fetch stats");
    } finally {
      setLoadingStats(false);
    }
  }

  function connectPlatform(platform: keyof CodingProfiles) {
    const username = editProfiles[platform].trim();
    if (!username) return;
    const updated = { ...profiles, [platform]: username };
    setProfiles(updated);
    setSavedFlags(f => ({ ...f, [platform]: true }));
    localStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
    fetchCodingStats(updated);
  }

  function persist(updated: ProgressData) {
    setData(updated);
    saveData(updated);
  }

  function addSkill(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (data.skills.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) return;
    persist({
      ...data,
      skills: [
        ...data.skills,
        { id: crypto.randomUUID(), name: trimmed, addedAt: new Date().toISOString(), completed: false },
      ],
    });
    setInput("");
  }

  function toggleComplete(id: string) {
    const skill = data.skills.find(s => s.id === id);
    if (!skill) return;
    const wasCompleted = skill.completed;
    let updated: ProgressData = {
      ...data,
      skills: data.skills.map(s =>
        s.id === id
          ? { ...s, completed: !s.completed, completedAt: !s.completed ? new Date().toISOString() : undefined }
          : s
      ),
    };
    if (!wasCompleted) updated = updateStreak(updated);
    persist(updated);
  }

  function deleteSkill(id: string) {
    persist({ ...data, skills: data.skills.filter(s => s.id !== id) });
  }

  const active = data.skills.filter(s => !s.completed);
  const completed = data.skills.filter(s => s.completed);
  const total = data.skills.length;
  const completedCount = completed.length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  const suggestedGap: string[] = [];
  if (skillGap) {
    const allGap = [
      ...(skillGap.must_have_missing || []).map(s => s.skill),
      ...(skillGap.good_to_have_missing || []).map(s => s.skill),
    ];
    const existing = new Set(data.skills.map(s => s.name.toLowerCase()));
    for (const sk of allGap) {
      if (!existing.has(sk.toLowerCase())) suggestedGap.push(sk);
      if (suggestedGap.length >= 5) break;
    }
  }

  // Derived coding stats
  const lcStats = codingStats?.leetcode && !hasError(codingStats.leetcode)
    ? (codingStats.leetcode as LeetCodeStats) : null;
  const ccStats = codingStats?.codechef && !hasError(codingStats.codechef)
    ? (codingStats.codechef as CodeChefStats) : null;
  const cfStats = codingStats?.codeforces && !hasError(codingStats.codeforces)
    ? (codingStats.codeforces as CodeforcesStats) : null;

  const totalSolved = (lcStats?.total_solved ?? 0) + (ccStats?.problems_solved ?? 0);
  const hasAnyStats = lcStats || ccStats || cfStats;
  const anyProfileConnected = profiles.leetcode || profiles.codechef || profiles.codeforces;

  if (status === "loading") return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-1">Progress Tracker</h2>
        <p className="text-gray-400 mb-8">Track your learning and coding platform achievements.</p>

        {/* ── Connect Coding Profiles ─────────────────────────────────────── */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 mb-8">
          <h3 className="font-semibold mb-1">Connect Coding Profiles</h3>
          <p className="text-gray-500 text-sm mb-5">Link your profiles to see combined stats and progress.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* LeetCode */}
            <div>
              <label className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-widest mb-2">
                <span className="text-yellow-400">⬡</span> LeetCode
                {savedFlags.leetcode && <span className="text-green-400 ml-auto">✓</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="username"
                  value={editProfiles.leetcode}
                  onChange={e => setEditProfiles(p => ({ ...p, leetcode: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && connectPlatform("leetcode")}
                  className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-yellow-500/50 transition"
                />
                <button
                  onClick={() => connectPlatform("leetcode")}
                  className="px-3 py-2 bg-yellow-600/20 border border-yellow-600/30 text-yellow-400 rounded-lg text-xs font-medium hover:bg-yellow-600/30 transition shrink-0"
                >
                  Connect
                </button>
              </div>
            </div>

            {/* CodeChef */}
            <div>
              <label className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-widest mb-2">
                <span className="text-orange-400">♨</span> CodeChef
                {savedFlags.codechef && <span className="text-green-400 ml-auto">✓</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="username"
                  value={editProfiles.codechef}
                  onChange={e => setEditProfiles(p => ({ ...p, codechef: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && connectPlatform("codechef")}
                  className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-orange-500/50 transition"
                />
                <button
                  onClick={() => connectPlatform("codechef")}
                  className="px-3 py-2 bg-orange-600/20 border border-orange-600/30 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-600/30 transition shrink-0"
                >
                  Connect
                </button>
              </div>
            </div>

            {/* Codeforces */}
            <div>
              <label className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-widest mb-2">
                <span className="text-blue-400">◈</span> Codeforces
                {savedFlags.codeforces && <span className="text-green-400 ml-auto">✓</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="handle"
                  value={editProfiles.codeforces}
                  onChange={e => setEditProfiles(p => ({ ...p, codeforces: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && connectPlatform("codeforces")}
                  className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500/50 transition"
                />
                <button
                  onClick={() => connectPlatform("codeforces")}
                  className="px-3 py-2 bg-blue-600/20 border border-blue-600/30 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-600/30 transition shrink-0"
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Coding Stats ────────────────────────────────────────────────── */}
        {anyProfileConnected && (
          <>
            {loadingStats && (
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-8 text-center mb-8">
                <p className="text-gray-400 text-sm">Fetching your stats...</p>
              </div>
            )}
            {statsError && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 mb-8">
                <p className="text-red-400 text-sm">{statsError}</p>
              </div>
            )}

            {hasAnyStats && !loadingStats && (
              <>
                {/* Summary bar */}
                <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-6">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Total Problems Solved</p>
                      <p className="text-3xl font-bold text-white">{totalSolved.toLocaleString()}</p>
                      <p className="text-xs text-gray-600 mt-0.5">LeetCode + CodeChef</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-semibold ${
                        totalSolved >= 500 ? "text-purple-400" :
                        totalSolved >= 300 ? "text-blue-400" :
                        totalSolved >= 100 ? "text-green-400" :
                        "text-yellow-400"
                      }`}>
                        {getMotivation(totalSolved)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Platform cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                  {/* LeetCode card */}
                  {lcStats && (
                    <div className="bg-[#111] border border-yellow-500/20 rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-yellow-400 text-lg">⬡</span>
                        <span className="font-semibold text-yellow-400">LeetCode</span>
                      </div>
                      <div className="flex items-center gap-4 mb-4">
                        <LeetCodeDonut
                          easy={lcStats.easy_solved}
                          medium={lcStats.medium_solved}
                          hard={lcStats.hard_solved}
                        />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-green-400">Easy</span>
                            <span className="text-xs text-white font-medium">{lcStats.easy_solved}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-yellow-400">Medium</span>
                            <span className="text-xs text-white font-medium">{lcStats.medium_solved}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-red-400">Hard</span>
                            <span className="text-xs text-white font-medium">{lcStats.hard_solved}</span>
                          </div>
                        </div>
                      </div>
                      {lcStats.ranking > 0 && (
                        <div className="border-t border-gray-800 pt-3">
                          <p className="text-xs text-gray-500 mb-0.5">Global Ranking</p>
                          <p className="text-white font-semibold">#{lcStats.ranking.toLocaleString()}</p>
                        </div>
                      )}
                      <a
                        href={lcStats.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 block text-center text-xs text-yellow-400 hover:text-yellow-300 transition"
                      >
                        View Profile ↗
                      </a>
                    </div>
                  )}

                  {/* CodeChef card */}
                  {ccStats && (
                    <div className="bg-[#111] border border-orange-500/20 rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-orange-400 text-lg">♨</span>
                        <span className="font-semibold text-orange-400">CodeChef</span>
                      </div>
                      <div className="mb-4">
                        <p className="text-3xl font-bold text-white">{ccStats.rating || "—"}</p>
                        <p className="text-xs text-gray-500 mt-0.5 mb-2">Current Rating</p>
                        <StarDisplay stars={ccStats.stars} />
                      </div>
                      <div className="space-y-2 border-t border-gray-800 pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">Highest Rating</span>
                          <span className="text-xs text-white font-medium">{ccStats.highest_rating || "—"}</span>
                        </div>
                        {ccStats.problems_solved > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">Problems Solved</span>
                            <span className="text-xs text-white font-medium">{ccStats.problems_solved}</span>
                          </div>
                        )}
                        {ccStats.global_rank > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">Global Rank</span>
                            <span className="text-xs text-white font-medium">#{ccStats.global_rank.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                      <a
                        href={ccStats.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 block text-center text-xs text-orange-400 hover:text-orange-300 transition"
                      >
                        View Profile ↗
                      </a>
                    </div>
                  )}

                  {/* Codeforces card */}
                  {cfStats && (
                    <div className="bg-[#111] border border-blue-500/20 rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-blue-400 text-lg">◈</span>
                        <span className="font-semibold text-blue-400">Codeforces</span>
                      </div>
                      <div className="mb-4">
                        <p className={`text-3xl font-bold ${getCfRatingColor(cfStats.rating)}`}>
                          {cfStats.rating || "Unrated"}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 mb-1">Current Rating</p>
                        {cfStats.rank && (
                          <p className={`text-sm font-medium capitalize ${getCfRankColor(cfStats.rank)}`}>
                            {cfStats.rank}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2 border-t border-gray-800 pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">Max Rating</span>
                          <span className={`text-xs font-medium ${getCfRatingColor(cfStats.max_rating)}`}>
                            {cfStats.max_rating || "—"}
                          </span>
                        </div>
                        {cfStats.max_rank && cfStats.max_rank !== cfStats.rank && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">Best Rank</span>
                            <span className={`text-xs font-medium capitalize ${getCfRankColor(cfStats.max_rank)}`}>
                              {cfStats.max_rank}
                            </span>
                          </div>
                        )}
                        {cfStats.contribution !== 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">Contribution</span>
                            <span className={`text-xs font-medium ${cfStats.contribution > 0 ? "text-green-400" : "text-red-400"}`}>
                              {cfStats.contribution > 0 ? "+" : ""}{cfStats.contribution}
                            </span>
                          </div>
                        )}
                      </div>
                      <a
                        href={cfStats.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 block text-center text-xs text-blue-400 hover:text-blue-300 transition"
                      >
                        View Profile ↗
                      </a>
                    </div>
                  )}

                  {/* Error states */}
                  {codingStats?.leetcode && hasError(codingStats.leetcode) && profiles.leetcode && (
                    <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                      <p className="text-yellow-400 text-sm font-medium mb-1">⬡ LeetCode</p>
                      <p className="text-red-400 text-xs">{codingStats.leetcode.error}</p>
                    </div>
                  )}
                  {codingStats?.codechef && hasError(codingStats.codechef) && profiles.codechef && (
                    <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                      <p className="text-orange-400 text-sm font-medium mb-1">♨ CodeChef</p>
                      <p className="text-red-400 text-xs">{codingStats.codechef.error}</p>
                    </div>
                  )}
                  {codingStats?.codeforces && hasError(codingStats.codeforces) && profiles.codeforces && (
                    <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                      <p className="text-blue-400 text-sm font-medium mb-1">◈ Codeforces</p>
                      <p className="text-red-400 text-xs">{codingStats.codeforces.error}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Skill Tracker ──────────────────────────────────────────────── */}
        <h3 className="text-xl font-bold mb-4">Skill Tracker</h3>

        {/* Add skill input */}
        <div className="flex gap-3 mb-8">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addSkill(input)}
            placeholder="Type a skill to learn, e.g. React, SQL, System Design..."
            className="flex-1 bg-[#111] border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
          />
          <button
            onClick={() => addSkill(input)}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition"
          >
            Add
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="md:col-span-2 bg-[#111] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">Progress</p>
            <p className="text-2xl font-bold mb-4">
              {completedCount}{" "}
              <span className="text-gray-500 text-base font-normal">of {total} skills completed</span>
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{pct}% complete</p>
          </div>
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">Daily Streak</p>
            <p className="text-4xl font-bold text-orange-400">{data.streak.count}</p>
            <p className="text-xs text-gray-500 mt-1">days in a row</p>
          </div>
        </div>

        {/* Suggested Skills from skill gap */}
        {suggestedGap.length > 0 && (
          <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl p-5 mb-8">
            <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-1">
              Suggested Skills to Learn
            </p>
            <p className="text-xs text-gray-500 mb-3">
              From your skill gap analysis — click to add instantly
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedGap.map(sk => (
                <button
                  key={sk}
                  onClick={() => addSkill(sk)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition"
                >
                  + {sk}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active skills */}
        {active.length > 0 && (
          <section className="mb-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              In Progress ({active.length})
            </h3>
            <div className="space-y-3">
              {active.map(skill => (
                <div
                  key={skill.id}
                  className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4"
                >
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleComplete(skill.id)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 cursor-pointer accent-blue-500 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium">{skill.name}</p>
                    <p className="text-xs text-gray-600 mt-0.5">Added {formatDate(skill.addedAt)}</p>
                  </div>
                  <button
                    onClick={() => deleteSkill(skill.id)}
                    className="text-gray-700 hover:text-red-400 text-xs transition shrink-0"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Completed skills */}
        {completed.length > 0 && (
          <section className="mb-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Completed ({completedCount})
            </h3>
            <div className="space-y-3">
              {completed.map(skill => (
                <div
                  key={skill.id}
                  className="bg-[#111] border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4 opacity-60"
                >
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => toggleComplete(skill.id)}
                    className="w-4 h-4 rounded border-gray-600 cursor-pointer accent-blue-500 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-400 font-medium line-through">{skill.name}</p>
                    {skill.completedAt && (
                      <p className="text-xs text-gray-600 mt-0.5">Completed {formatDate(skill.completedAt)}</p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteSkill(skill.id)}
                    className="text-gray-700 hover:text-red-400 text-xs transition shrink-0"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {data.skills.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg mb-2">No skills yet.</p>
            <p className="text-sm">Type a skill above and press Add to start tracking.</p>
          </div>
        )}
      </div>
    </main>
  );
}
