"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

type SkillStatus = "not_started" | "in_progress" | "learned";

type SkillItem = {
  skill: string;
  why_important: string;
  time_to_learn: string;
  free_resource_link: string;
};

type SkillGapResult = {
  must_have_missing: SkillItem[];
  good_to_have_missing: SkillItem[];
};

type StoredProfile = {
  placementScore: number;
  skills: string[];
  targetRole: string;
};

type ProgressData = {
  skills: Record<string, SkillStatus>;
  streak: { lastUpdated: string; count: number };
  history: Array<{ date: string; skillLearned: string }>;
};

const PROGRESS_KEY = "placeiq_progress";

function loadProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { skills: {}, streak: { lastUpdated: "", count: 0 }, history: [] };
}

function saveProgress(data: ProgressData) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch {}
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartStr() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

const CONFETTI_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];

const STATUS_CONFIG: Record<SkillStatus, { label: string; className: string }> = {
  not_started: { label: "Not Started", className: "bg-gray-800 text-gray-400 border border-gray-700" },
  in_progress: { label: "In Progress", className: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30" },
  learned: { label: "✓ Learned", className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" },
};

function ResourceLink({ href }: { href: string }) {
  const valid = href?.startsWith("http://") || href?.startsWith("https://");
  if (!valid) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition whitespace-nowrap"
    >
      Learn free →
    </a>
  );
}

function SkillCard({
  item,
  status,
  onToggle,
  accentColor,
}: {
  item: SkillItem;
  status: SkillStatus;
  onToggle: () => void;
  accentColor: "red" | "yellow";
}) {
  const isLearned = status === "learned";
  const borderColor =
    isLearned
      ? "border-emerald-500/30"
      : accentColor === "red"
      ? "border-red-500/20"
      : "border-yellow-500/20";

  return (
    <div
      className={`bg-[#111] border ${borderColor} rounded-xl px-5 py-4 flex items-center justify-between gap-4 transition-all ${isLearned ? "opacity-60" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm ${isLearned ? "line-through text-gray-500" : "text-white"}`}>
          {item.skill}
        </p>
        {item.time_to_learn && (
          <p className="text-xs text-gray-500 mt-0.5">⏱ {item.time_to_learn}</p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <ResourceLink href={item.free_resource_link} />
        <button
          onClick={onToggle}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${STATUS_CONFIG[status].className}`}
        >
          {STATUS_CONFIG[status].label}
        </button>
      </div>
    </div>
  );
}

export default function ProgressTracker() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [skillGap, setSkillGap] = useState<SkillGapResult | null>(null);
  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [progress, setProgress] = useState<ProgressData>({
    skills: {},
    streak: { lastUpdated: "", count: 0 },
    history: [],
  });
  const [toast, setToast] = useState<string | null>(null);
  const [confetti, setConfetti] = useState<Array<{ id: number; color: string; left: number; delay: number; dur: number }>>([]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const rawGap = localStorage.getItem("placeiq_skillgap");
      if (rawGap) setSkillGap(JSON.parse(rawGap));
      const rawProfile = localStorage.getItem("placeiq_profile");
      if (rawProfile) setProfile(JSON.parse(rawProfile));
    } catch {}
    setProgress(loadProgress());
  }, []);

  const updateStreak = useCallback((current: ProgressData): ProgressData => {
    const today = todayStr();
    if (current.streak.lastUpdated === today) return current;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    const newCount = current.streak.lastUpdated === yStr ? current.streak.count + 1 : 1;
    return { ...current, streak: { lastUpdated: today, count: newCount } };
  }, []);

  const cycleStatus = (skillName: string) => {
    const cur = progress.skills[skillName] || "not_started";
    const next: SkillStatus =
      cur === "not_started" ? "in_progress" : cur === "in_progress" ? "learned" : "not_started";

    let updated: ProgressData = {
      ...progress,
      skills: { ...progress.skills, [skillName]: next },
    };

    if (next === "learned") {
      updated = {
        ...updated,
        history: [...updated.history, { date: todayStr(), skillLearned: skillName }],
      };
      updated = updateStreak(updated);

      // Spawn confetti
      const particles = Array.from({ length: 50 }, (_, i) => ({
        id: Date.now() + i,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 1.4 + Math.random() * 1,
      }));
      setConfetti(particles);
      setTimeout(() => setConfetti([]), 3500);

      setToast(`Great job! You learned ${skillName}!`);
      setTimeout(() => setToast(null), 3000);
    }

    setProgress(updated);
    saveProgress(updated);
  };

  const mustHave = skillGap?.must_have_missing ?? [];
  const goodToHave = skillGap?.good_to_have_missing ?? [];
  const currentSkills = profile?.skills ?? [];
  const baseScore = profile?.placementScore ?? 0;

  const learnedMustHave = mustHave.filter(s => progress.skills[s.skill] === "learned").length;
  const learnedGoodToHave = goodToHave.filter(s => progress.skills[s.skill] === "learned").length;
  const scoreGain = learnedMustHave * 3 + learnedGoodToHave * 1.5;
  const estimatedScore = Math.min(100, Math.round(baseScore + scoreGain));

  const totalLearnable = mustHave.length + goodToHave.length;
  const totalLearned = Object.values(progress.skills).filter(s => s === "learned").length;
  const progressPct = totalLearnable > 0 ? Math.round((totalLearned / totalLearnable) * 100) : 0;

  const weekStart = weekStartStr();
  const learnedThisWeek = progress.history.filter(h => h.date >= weekStart).length;

  if (status === "loading") {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Confetti keyframes */}
      <style>{`
        @keyframes placeiq-confetti-fall {
          0%   { transform: translateY(-10px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes placeiq-toast-in {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Confetti particles */}
      {confetti.map(p => (
        <div
          key={p.id}
          style={{
            position: "fixed",
            top: 0,
            left: `${p.left}%`,
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: p.color,
            animation: `placeiq-confetti-fall ${p.dur}s ease-in ${p.delay}s forwards`,
            zIndex: 9999,
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Toast */}
      {toast && (
        <div
          style={{ animation: "placeiq-toast-in 0.25s ease-out forwards" }}
          className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium"
        >
          {toast}
        </div>
      )}

      {/* Navbar */}
      <nav className="border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1
            className="text-xl font-bold cursor-pointer"
            onClick={() => router.push("/dashboard")}
          >
            Place<span className="text-blue-500">IQ</span>
          </h1>
          <div className="flex gap-4 flex-wrap">
            {([
              ["Dashboard", "/dashboard"],
              ["Skill Gap", "/skills"],
              ["Companies", "/companies"],
              ["Roadmap", "/roadmap"],
              ["Progress", "/progress"],
              ["Market", "/market"],
              ["Resume", "/resume"],
              ["Tracker", "/tracker"],
              ["On Campus", "/oncampus"],
              ["Off Campus", "/offcampus"],
              ["Resources", "/resources"],
              ["Cold Email", "/coldemail"],
              ["Directory", "/company-directory"],
              ["LinkedIn", "/linkedin"],
              ["PYQ", "/pyq"],
              ["Internships", "/internships"],
              ["Referral Radar", "/referral"],
            ] as [string, string][]).map(([label, href]) => (
              <button
                key={href}
                onClick={() => router.push(href)}
                className={`text-sm transition ${
                  href === "/progress"
                    ? "text-white border-b border-blue-500 pb-0.5"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <img src={session?.user?.image || ""} className="w-8 h-8 rounded-full" alt="" />
          <span className="text-gray-400 text-sm">{session?.user?.name}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-gray-500 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-1">Progress Tracker</h2>
        <p className="text-gray-400 mb-8">
          Track your skill-building journey and watch your placement score climb.
        </p>

        {/* Summary stats row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
          {/* Progress bar */}
          <div className="md:col-span-2 bg-[#111] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">Overall Progress</p>
            <p className="text-2xl font-bold mb-4">
              {totalLearned}{" "}
              <span className="text-gray-500 text-base font-normal">of {totalLearnable} skills</span>
            </p>
            <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{progressPct}% complete</p>
          </div>

          {/* Estimated score */}
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">Estimated Score</p>
            <p className="text-3xl font-bold text-blue-500">{baseScore > 0 ? estimatedScore : "--"}</p>
            {scoreGain > 0 && (
              <p className="text-xs text-emerald-400 mt-1">+{scoreGain % 1 === 0 ? scoreGain : scoreGain.toFixed(1)} pts gained</p>
            )}
            <p className="text-xs text-gray-600 mt-1">out of 100</p>
          </div>

          {/* Streak */}
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">Daily Streak</p>
            <p className="text-3xl font-bold text-orange-400">{progress.streak.count}</p>
            <p className="text-xs text-gray-500 mt-1">days in a row</p>
            <div className="mt-3 border-t border-gray-800 pt-3 space-y-0.5">
              <p className="text-xs text-gray-500">{learnedThisWeek} learned this week</p>
              <p className="text-xs text-gray-500">{totalLearned} total learned</p>
            </div>
          </div>
        </div>

        {/* Must Have */}
        {mustHave.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
              <h3 className="text-base font-semibold">Must Have</h3>
              <span className="text-xs text-gray-500">— critical missing skills</span>
              <span className="ml-auto text-xs text-gray-500">
                {learnedMustHave}/{mustHave.length} learned
              </span>
            </div>
            <div className="space-y-3">
              {mustHave.map(item => (
                <SkillCard
                  key={item.skill}
                  item={item}
                  status={progress.skills[item.skill] || "not_started"}
                  onToggle={() => cycleStatus(item.skill)}
                  accentColor="red"
                />
              ))}
            </div>
          </section>
        )}

        {/* Good to Have */}
        {goodToHave.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 shrink-0" />
              <h3 className="text-base font-semibold">Good to Have</h3>
              <span className="text-xs text-gray-500">— nice to have skills</span>
              <span className="ml-auto text-xs text-gray-500">
                {learnedGoodToHave}/{goodToHave.length} learned
              </span>
            </div>
            <div className="space-y-3">
              {goodToHave.map(item => (
                <SkillCard
                  key={item.skill}
                  item={item}
                  status={progress.skills[item.skill] || "not_started"}
                  onToggle={() => cycleStatus(item.skill)}
                  accentColor="yellow"
                />
              ))}
            </div>
          </section>
        )}

        {/* Current Skills */}
        {currentSkills.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
              <h3 className="text-base font-semibold">Current Skills</h3>
              <span className="text-xs text-gray-500">— already in your arsenal</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {currentSkills.map(skill => (
                <span
                  key={skill}
                  className="text-sm px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                >
                  ✓ {skill}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {!skillGap && (
          <div className="text-center py-24 text-gray-500">
            <p className="text-lg mb-2">No skill gap data found.</p>
            <p className="text-sm">
              Run your{" "}
              <button
                onClick={() => router.push("/skills")}
                className="text-blue-400 hover:underline"
              >
                Skill Gap analysis
              </button>{" "}
              first to start tracking progress.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
