"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_LINKS = [
  { label: "Dashboard",  path: "/dashboard" },
  { label: "Skill Gap",  path: "/skills" },
  { label: "Companies",  path: "/companies" },
  { label: "Roadmap",    path: "/roadmap" },
  { label: "Market",     path: "/market" },
  { label: "Resume",     path: "/resume" },
  { label: "Tracker",    path: "/tracker" },
  { label: "On Campus",  path: "/oncampus" },
  { label: "Off Campus", path: "/offcampus" },
  { label: "Resources",  path: "/resources" },
  { label: "Cold Email", path: "/coldemail" },
  { label: "LinkedIn",   path: "/linkedin" },
  { label: "Directory",  path: "/company-directory" },
  { label: "PYQ",        path: "/pyq", active: true },
  { label: "Internships", path: "/internships" },
];

const COMPANIES = [
  "TCS", "Infosys", "Wipro", "Accenture", "Cognizant", "HCL", "Capgemini",
  "IBM", "Deloitte", "Zoho", "Freshworks", "Razorpay", "CRED", "Swiggy",
  "Zepto", "PhonePe", "Groww", "Flipkart", "Amazon", "Microsoft", "Google",
  "Dream11", "Paytm", "Uber", "Goldman Sachs", "JP Morgan", "Morgan Stanley",
  "DE Shaw", "Sprinklr", "Atlassian", "Salesforce", "Adobe", "Intel",
  "Qualcomm", "Samsung", "Bosch", "MathWorks",
];

const ROUNDS = ["Aptitude", "Coding", "Technical", "HR"];

type Question = {
  question: string;
  type: "MCQ" | "Coding" | "Subjective";
  difficulty: "Easy" | "Medium" | "Hard";
  answer: string;
  explanation: string;
  frequency: string;
  topic: string;
};

type ExamPattern = {
  total_questions: number;
  time_limit: string;
  sections: string[];
  negative_marking: boolean;
  difficulty_level: string;
};

type Resource = {
  name: string;
  url: string;
  what_to_practice: string;
};

type PYQResult = {
  company: string;
  round: string;
  questions: Question[];
  exam_pattern: ExamPattern;
  pro_tips: string[];
  resources: Resource[];
};

function difficultyBadge(d: string) {
  if (d === "Easy") return "bg-green-500/15 text-green-400 border-green-500/30";
  if (d === "Hard") return "bg-red-500/15 text-red-400 border-red-500/30";
  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
}

function typeBadge(t: string) {
  if (t === "Coding") return "bg-purple-500/15 text-purple-400 border-purple-500/30";
  if (t === "Subjective") return "bg-gray-500/15 text-gray-400 border-gray-500/30";
  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
}

function frequencyBadge(f: string) {
  if (f === "Asked frequently") return "bg-blue-600/15 text-blue-400 border-blue-500/30";
  if (f === "Sometimes asked") return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  return "bg-gray-700/30 text-gray-500 border-gray-600/30";
}

function QuestionCard({ q, idx }: { q: Question; idx: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#111] border border-gray-800 rounded-xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-gray-500 text-sm font-mono shrink-0 pt-0.5">Q{idx + 1}</span>
        <div className="flex-1">
          <div className="flex flex-wrap gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${difficultyBadge(q.difficulty)}`}>
              {q.difficulty}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${typeBadge(q.type)}`}>
              {q.type}
            </span>
            {q.frequency !== "Rarely asked" && (
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${frequencyBadge(q.frequency)}`}>
                {q.frequency}
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
              {q.topic}
            </span>
          </div>
          <p className="text-white font-medium leading-relaxed">{q.question}</p>
        </div>
      </div>
      <button
        onClick={() => setOpen(v => !v)}
        className="ml-8 text-sm text-blue-400 hover:text-blue-300 transition"
      >
        {open ? "Hide Answer" : "Show Answer"}
      </button>
      {open && (
        <div className="ml-8 mt-3 space-y-2">
          <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
            <p className="text-xs text-green-400 uppercase tracking-widest mb-1">Answer</p>
            <p className="text-gray-200 text-sm leading-relaxed">{q.answer}</p>
          </div>
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
            <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">Explanation</p>
            <p className="text-gray-300 text-sm leading-relaxed">{q.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PYQPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [company, setCompany] = useState("TCS");
  const [companySearch, setCompanySearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [round, setRound] = useState("Aptitude");
  const [targetRole, setTargetRole] = useState("Software Engineer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PYQResult | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const prof = localStorage.getItem("placeiq_profile");
      if (prof) {
        const p = JSON.parse(prof);
        if (p.targetRole) setTargetRole(p.targetRole);
      }
    } catch {}
  }, []);

  const cacheKey = `placeiq_pyq_${company}_${round}`;

  useEffect(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) setResult(JSON.parse(cached));
      else setResult(null);
    } catch {}
  }, [company, round]);

  useEffect(() => {
    if (!showDropdown) return;
    const close = () => setShowDropdown(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showDropdown]);

  const filteredCompanies = COMPANIES.filter(c =>
    c.toLowerCase().includes(companySearch.toLowerCase())
  );

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("http://localhost:8000/api/pyq/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, round_type: round, target_role: targetRole }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: PYQResult = await res.json();
      setResult(data);
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold">Place<span className="text-blue-500">IQ</span></h1>
          <div className="flex gap-4 flex-wrap">
            {NAV_LINKS.map(link => (
              <button
                key={link.path}
                onClick={() => router.push(link.path)}
                className={`text-sm transition ${
                  link.active
                    ? "text-white border-b border-blue-500 pb-0.5"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <img src={session?.user?.image || ""} className="w-8 h-8 rounded-full" />
          <span className="text-gray-400 text-sm">{session?.user?.name}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-gray-500 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-1">Previous Year Questions</h2>
        <p className="text-gray-400 mb-8">Company-specific interview questions from real placement drives.</p>

        {/* Controls */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            {/* Company searchable dropdown */}
            <div className="relative">
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Company</label>
              <div
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm cursor-pointer flex items-center justify-between"
                onClick={() => setShowDropdown(v => !v)}
              >
                <span className="text-white">{company}</span>
                <span className="text-gray-500 text-xs">▾</span>
              </div>
              {showDropdown && (
                <div className="absolute z-20 top-full mt-1 w-full bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="p-2 border-b border-gray-800">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search..."
                      value={companySearch}
                      onChange={e => setCompanySearch(e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 outline-none"
                    />
                  </div>
                  <ul className="max-h-52 overflow-y-auto">
                    {filteredCompanies.map(c => (
                      <li
                        key={c}
                        onClick={() => { setCompany(c); setCompanySearch(""); setShowDropdown(false); }}
                        className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-800 transition ${c === company ? "text-blue-400" : "text-gray-300"}`}
                      >
                        {c}
                      </li>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <li className="px-4 py-2 text-sm text-gray-600">No results</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* Round */}
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Round</label>
              <select
                value={round}
                onChange={e => setRound(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white outline-none"
              >
                {ROUNDS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Target Role */}
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Target Role</label>
              <input
                type="text"
                value={targetRole}
                onChange={e => setTargetRole(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none"
                placeholder="e.g. Software Engineer"
              />
            </div>
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium transition"
          >
            {loading ? `Fetching questions for ${company} ${round} round...` : "Generate Questions"}
          </button>

          {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
        </div>

        {result && (
          <div className="space-y-6">
            {/* Exam Pattern */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <h3 className="font-semibold mb-4 text-blue-400 uppercase tracking-widest text-xs">Exam Pattern</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-gray-500 text-xs mb-1">Total Questions</p>
                  <p className="text-white font-bold text-lg">{result.exam_pattern.total_questions}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Time Limit</p>
                  <p className="text-white font-bold text-lg">{result.exam_pattern.time_limit}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Difficulty</p>
                  <p className={`font-bold text-lg ${
                    result.exam_pattern.difficulty_level === "Easy" ? "text-green-400"
                    : result.exam_pattern.difficulty_level === "Hard" ? "text-red-400"
                    : "text-yellow-400"
                  }`}>{result.exam_pattern.difficulty_level}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Negative Marking</p>
                  <p className={`font-bold text-lg ${result.exam_pattern.negative_marking ? "text-red-400" : "text-green-400"}`}>
                    {result.exam_pattern.negative_marking ? "Yes" : "No"}
                  </p>
                </div>
              </div>
              {result.exam_pattern.sections.length > 0 && (
                <div className="mt-4">
                  <p className="text-gray-500 text-xs mb-2">Sections</p>
                  <div className="flex flex-wrap gap-2">
                    {result.exam_pattern.sections.map((s, i) => (
                      <span key={i} className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full border border-gray-700">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Questions */}
            <div>
              <h3 className="font-semibold mb-4">
                {result.company} · {result.round} Round
                <span className="text-gray-500 font-normal ml-2 text-sm">({result.questions.length} questions)</span>
              </h3>
              <div className="space-y-4">
                {result.questions.map((q, i) => (
                  <QuestionCard key={i} q={q} idx={i} />
                ))}
              </div>
            </div>

            {/* Pro Tips */}
            {result.pro_tips.length > 0 && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-6">
                <h3 className="font-semibold mb-3 text-yellow-400">Pro Tips for {result.company} {result.round} Round</h3>
                <ul className="space-y-2">
                  {result.pro_tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-yellow-500 shrink-0 mt-0.5">→</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Resources */}
            {result.resources.length > 0 && (
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold mb-4">Recommended Resources</h3>
                <div className="space-y-3">
                  {result.resources.map((r, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-blue-500 shrink-0 mt-0.5">↗</span>
                      <div>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-sm font-medium transition"
                        >
                          {r.name}
                        </a>
                        <p className="text-gray-500 text-xs mt-0.5">{r.what_to_practice}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
