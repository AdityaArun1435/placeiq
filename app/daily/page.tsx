"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Flame, Check, ExternalLink, Calendar } from "lucide-react";
import LoadingScreen from "@/components/LoadingScreen";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://placeiq-backend-e7ik.onrender.com";

type DailyProblem = {
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  url: string;
  tag: string;
  why_relevant_for_role: string;
  date: string;
};

type TechArticle = {
  title: string;
  link: string;
  source_name: string;
  published_date: string | null;
};

type AptitudeQuestion = {
  question: string;
  options: string[];
  correct: string;
  explanation: string;
  topic: string;
  role: string;
};

const DIFFICULTY_STYLE: Record<string, string> = {
  Easy: "bg-green-500/15 text-green-400 border-green-500/30",
  Medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  Hard: "bg-red-500/15 text-red-400 border-red-500/30",
};

const SOURCE_BADGE: Record<string, string> = {
  OpenAI: "bg-green-500/10 text-green-400 border-green-500/20",
  NVIDIA: "bg-green-500/10 text-green-400 border-green-500/20",
  "Google AI": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  GitHub: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Anthropic: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  HuggingFace: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

function sourceBadgeClass(name: string): string {
  return SOURCE_BADGE[name] || "bg-orange-500/10 text-orange-400 border-orange-500/20";
}

function hoursAgo(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const diff = (Date.now() - new Date(isoDate).getTime()) / 3600000;
    if (diff < 1) return "just now";
    if (diff < 24) return `${Math.floor(diff)}h ago`;
    return `${Math.floor(diff / 24)}d ago`;
  } catch { return ""; }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getStreak(): number {
  try {
    const raw = localStorage.getItem("placeiq_daily_solved");
    if (!raw) return 0;
    const data: Record<string, string> = JSON.parse(raw);
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (data[key]) streak++;
      else break;
    }
    return streak;
  } catch { return 0; }
}

const ROLE_CHECKLISTS: Record<string, string[]> = {
  "Software Engineer": ["Solve 2 LeetCode problems", "Review one CS concept", "Read tech news (15 mins)", "Work on your project (30 mins)", "Apply to 1 company"],
  "Data Scientist": ["Practice one SQL problem", "Read one ML paper/article", "Work on your dataset project", "Review a statistics concept", "Update your portfolio"],
  "ML Engineer": ["Implement or study one ML concept", "Read a HuggingFace/fast.ai tutorial", "Push code to your ML project", "Review linear algebra or stats", "Apply to 1 ML role"],
  "Frontend Developer": ["Build or improve a UI component", "Solve one array/string LeetCode", "Study a CSS/JS concept", "Read frontend dev news", "Push to your portfolio project"],
  "Backend Developer": ["Solve one tree/graph LeetCode problem", "Work on your API project", "Review a system design concept", "Read about caching or queues", "Apply to 1 backend role"],
  "Full Stack Developer": ["Work on your full stack project", "Solve one LeetCode problem", "Learn one new framework concept", "Deploy or test a feature", "Apply to 1 full stack role"],
  "DevOps Engineer": ["Practice one Linux/shell scripting task", "Work on a Docker or K8s project", "Read a DevOps blog post", "Check a CI/CD pipeline concept", "Apply to 1 DevOps role"],
  "Cloud Engineer": ["Study one AWS/GCP/Azure service", "Work on a cloud deployment project", "Practice a networking concept", "Read cloud architecture blog", "Apply to 1 cloud role"],
  "Product Manager": ["Read one product case study", "Solve one SQL problem", "Write a product spec or teardown", "Track one product in your niche", "Apply to 1 PM role"],
  "Business Analyst": ["Solve one SQL problem", "Practice Excel or Power BI", "Read one business case study", "Work on your BA portfolio", "Apply to 1 BA role"],
  "Cybersecurity Analyst": ["Complete one TryHackMe room or module", "Review one networking concept", "Practice with Burp Suite or Wireshark", "Read latest security news", "Apply to 1 security role"],
  "Embedded Systems Engineer": ["Work on an Arduino/STM32 project", "Solve one bit manipulation problem", "Study a communication protocol", "Read embedded systems documentation", "Apply to 1 embedded role"],
  "QA Engineer": ["Write or run one automated test", "Solve one array/string LeetCode", "Practice API testing in Postman", "Review a testing concept", "Apply to 1 QA role"],
  "Research & Development": ["Read one research paper section", "Implement or experiment with a model", "Solve one math/DP problem", "Write research notes or a summary", "Apply to 1 research role or lab"],
};

export default function DailyPrepPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [targetRole, setTargetRole] = useState("Software Engineer");
  const [problem, setProblem] = useState<DailyProblem | null>(null);
  const [problemLoading, setProblemLoading] = useState(true);
  const [solvedToday, setSolvedToday] = useState(false);
  const [streak, setStreak] = useState(0);

  const [checklist, setChecklist] = useState<boolean[]>([false, false, false, false, false]);
  const [checklistItems, setChecklistItems] = useState<string[]>([]);

  const [news, setNews] = useState<TechArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsFailed, setNewsFailed] = useState(false);

  const [aptitude, setAptitude] = useState<AptitudeQuestion | null>(null);
  const [aptitudeLoading, setAptitudeLoading] = useState(true);
  const [aptitudeAnswer, setAptitudeAnswer] = useState<string | null>(null);
  const [aptitudeAnsweredToday, setAptitudeAnsweredToday] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("placeiq_profile");
      const role = raw ? (JSON.parse(raw).targetRole || "Software Engineer") : "Software Engineer";
      setTargetRole(role);
    } catch {}
  }, []);

  // Load streak and solved state
  useEffect(() => {
    setStreak(getStreak());
    try {
      const raw = localStorage.getItem("placeiq_daily_solved");
      if (raw) {
        const data = JSON.parse(raw);
        if (data[todayStr()]) setSolvedToday(true);
      }
    } catch {}
  }, []);

  // Load checklist from localStorage
  useEffect(() => {
    const items = ROLE_CHECKLISTS[targetRole] || ROLE_CHECKLISTS["Software Engineer"];
    setChecklistItems(items);
    try {
      const key = `placeiq_daily_checklist_${todayStr()}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        setChecklist(Array.isArray(saved) ? saved : items.map(() => false));
      } else {
        setChecklist(items.map(() => false));
      }
    } catch {
      setChecklist(items.map(() => false));
    }
  }, [targetRole]);

  // Fetch daily problem
  useEffect(() => {
    if (!targetRole) return;
    setProblemLoading(true);
    fetch(`${API_URL}/api/role/daily-problem/${encodeURIComponent(targetRole)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setProblem(data); })
      .catch(() => {})
      .finally(() => setProblemLoading(false));
  }, [targetRole]);

  // Fetch tech news
  useEffect(() => {
    setNewsLoading(true);
    fetch(`${API_URL}/api/market/tech-news`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.articles?.length) setNews(data.articles);
        else setNewsFailed(true);
      })
      .catch(() => setNewsFailed(true))
      .finally(() => setNewsLoading(false));
  }, []);

  // Fetch aptitude question
  useEffect(() => {
    if (!targetRole) return;
    // Check if already answered today
    const aptKey = `placeiq_aptitude_${todayStr()}`;
    try {
      const saved = localStorage.getItem(aptKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setAptitude(parsed.question);
        setAptitudeAnswer(parsed.answer);
        setAptitudeAnsweredToday(true);
        setAptitudeLoading(false);
        return;
      }
    } catch {}

    setAptitudeLoading(true);
    fetch(`${API_URL}/api/role/aptitude-question/${encodeURIComponent(targetRole)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAptitude(data); })
      .catch(() => {})
      .finally(() => setAptitudeLoading(false));
  }, [targetRole]);

  function markSolved() {
    try {
      const raw = localStorage.getItem("placeiq_daily_solved");
      const data = raw ? JSON.parse(raw) : {};
      data[todayStr()] = problem?.title || "Solved";
      localStorage.setItem("placeiq_daily_solved", JSON.stringify(data));
    } catch {}
    setSolvedToday(true);
    setStreak(getStreak() + 1);
  }

  function toggleCheck(idx: number) {
    const next = checklist.map((v, i) => i === idx ? !v : v);
    setChecklist(next);
    try {
      localStorage.setItem(`placeiq_daily_checklist_${todayStr()}`, JSON.stringify(next));
    } catch {}
  }

  function answerAptitude(letter: string) {
    if (aptitudeAnsweredToday) return;
    setAptitudeAnswer(letter);
    setAptitudeAnsweredToday(true);
    try {
      const aptKey = `placeiq_aptitude_${todayStr()}`;
      localStorage.setItem(aptKey, JSON.stringify({ question: aptitude, answer: letter }));
    } catch {}
  }

  const doneCount = checklist.filter(Boolean).length;

  if (status === "loading") return <LoadingScreen />;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Calendar size={24} style={{ color: "var(--accent-blue)" }} />
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Daily Prep</h1>
          {streak > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.3)", borderRadius: 9999, padding: "4px 12px" }}>
              <Flame size={14} style={{ color: "#f97316" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#f97316" }}>{streak} day streak</span>
            </div>
          )}
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 32 }}>
          Your daily hub for {targetRole} interview prep
        </p>

        {/* SECTION A — Daily Problem */}
        <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", marginBottom: 12 }}>Problem of the Day</p>

          {problemLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 18, height: 18, border: "2px solid var(--accent-blue)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>Loading problem...</span>
            </div>
          )}

          {problem && !problemLoading && (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{problem.title}</h3>
                <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 9999, fontWeight: 600, border: "1px solid", flexShrink: 0, ...(() => { const s = DIFFICULTY_STYLE[problem.difficulty] || ""; const parts = s.split(" "); return { background: "transparent", color: parts[1]?.replace("text-", "") ? "currentColor" : "var(--text-secondary)" }; })() }}
                  className={DIFFICULTY_STYLE[problem.difficulty] || ""}>
                  {problem.difficulty}
                </span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.6 }}>{problem.why_relevant_for_role}</p>

              <a href={problem.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--accent-blue)", color: "#fff", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, textDecoration: "none", marginBottom: 16 }}>
                Solve on LeetCode <ExternalLink size={14} />
              </a>

              {solvedToday ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-green)", fontSize: 13 }}>
                  <Check size={16} /> Great work! Keep your streak going.
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Solved today?</span>
                  <button onClick={markSolved}
                    style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "var(--accent-green)", borderRadius: 8, padding: "6px 16px", fontSize: 13, cursor: "pointer" }}>
                    Yes — mark solved
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* SECTION B — Today's Checklist */}
        <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", margin: 0 }}>Today&apos;s Checklist</p>
            <span style={{ fontSize: 12, color: doneCount === checklistItems.length ? "var(--accent-green)" : "var(--text-secondary)" }}>
              {doneCount}/{checklistItems.length} done today
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {checklistItems.map((item, i) => (
              <button key={i} onClick={() => toggleCheck(i)}
                style={{ display: "flex", alignItems: "center", gap: 12, background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${checklist[i] ? "var(--accent-blue)" : "var(--border-default)"}`, background: checklist[i] ? "var(--accent-blue)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                  {checklist[i] && <Check size={12} color="#fff" />}
                </div>
                <span style={{ fontSize: 13, color: checklist[i] ? "var(--text-tertiary)" : "var(--text-primary)", textDecoration: checklist[i] ? "line-through" : "none" }}>
                  {item}
                </span>
              </button>
            ))}
          </div>
          {doneCount === checklistItems.length && checklistItems.length > 0 && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(34,197,94,0.08)", borderRadius: 8, fontSize: 12, color: "var(--accent-green)" }}>
              All done for today! Great discipline.
            </div>
          )}
        </section>

        {/* SECTION C — Today in Tech */}
        <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", marginBottom: 12 }}>Today in Tech</p>

          {newsLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 18, height: 18, border: "2px solid var(--accent-blue)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>Loading news...</span>
            </div>
          )}

          {newsFailed && !newsLoading && (
            <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>News unavailable — check back soon.</p>
          )}

          {!newsLoading && !newsFailed && news.length === 0 && (
            <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>News unavailable — check back soon.</p>
          )}

          {news.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {news.slice(0, 8).map((article, i) => (
                <a key={i} href={article.link} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "10px 12px", background: "var(--bg-primary)", border: "1px solid var(--border-default)", borderRadius: 8, textDecoration: "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, margin: "0 0 4px", lineHeight: 1.4 }}>{article.title}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${sourceBadgeClass(article.source_name)}`}>
                        {article.source_name}
                      </span>
                      {article.published_date && (
                        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{hoursAgo(article.published_date)}</span>
                      )}
                    </div>
                  </div>
                  <ExternalLink size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
                </a>
              ))}
            </div>
          )}
        </section>

        {/* SECTION D — Aptitude Question */}
        <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", marginBottom: 12 }}>Aptitude Question of the Day</p>

          {aptitudeLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 18, height: 18, border: "2px solid var(--accent-blue)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>Loading question...</span>
            </div>
          )}

          {aptitude && !aptitudeLoading && (
            <>
              {aptitudeAnsweredToday && !aptitudeAnswer && (
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>Already answered today — come back tomorrow for a new question.</p>
              )}

              <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 12, lineHeight: 1.5 }}>{aptitude.question}</p>
              <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10 }}>Topic: {aptitude.topic}</p>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {aptitude.options.map((opt, i) => {
                  const letter = opt[0];
                  const isSelected = aptitudeAnswer === letter;
                  const isCorrect = letter === aptitude.correct;
                  let bg = "var(--bg-primary)";
                  let borderColor = "var(--border-default)";
                  if (aptitudeAnsweredToday && isSelected && isCorrect) { bg = "rgba(34,197,94,0.1)"; borderColor = "rgba(34,197,94,0.4)"; }
                  else if (aptitudeAnsweredToday && isSelected && !isCorrect) { bg = "rgba(239,68,68,0.1)"; borderColor = "rgba(239,68,68,0.4)"; }
                  else if (aptitudeAnsweredToday && isCorrect) { bg = "rgba(34,197,94,0.06)"; borderColor = "rgba(34,197,94,0.2)"; }

                  return (
                    <button key={i} onClick={() => answerAptitude(letter)}
                      disabled={aptitudeAnsweredToday}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: bg, border: `1px solid ${borderColor}`, borderRadius: 8, cursor: aptitudeAnsweredToday ? "default" : "pointer", textAlign: "left", transition: "all 0.15s" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", width: 16, flexShrink: 0 }}>{letter}</span>
                      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{opt.slice(3)}</span>
                    </button>
                  );
                })}
              </div>

              {aptitudeAnsweredToday && aptitude.explanation && (
                <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8, padding: "12px 14px" }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Explanation</p>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>{aptitude.explanation}</p>
                </div>
              )}
            </>
          )}
        </section>

      </div>
    </main>
  );
}
