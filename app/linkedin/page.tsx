"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const CACHE_KEY = "placeiq_linkedin";

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
  { label: "LinkedIn",   path: "/linkedin", active: true },
  { label: "Directory", path: "/company-directory" },
];

type HeadlineAnalysis = {
  current: string;
  verdict: "good" | "bad" | "missing";
  suggested: string;
};
type AboutSection = {
  verdict: "good" | "bad" | "missing";
  issues: string[];
  suggested_opening: string;
};
type SkillsSection = {
  missing_key_skills: string[];
  skills_to_remove: string[];
};
type ProjectsSection = {
  verdict: "good" | "bad" | "missing";
  improvements: string[];
};
type LinkedInResult = {
  profile_score: number;
  headline_analysis: HeadlineAnalysis;
  about_section: AboutSection;
  experience_gaps: string[];
  skills_section: SkillsSection;
  projects_section: ProjectsSection;
  quick_wins: string[];
  ats_keywords: string[];
  overall_verdict: string;
};

function scoreColor(s: number) {
  if (s >= 70) return { text: "text-green-400", ring: "stroke-green-500", bg: "bg-green-500/10 border-green-500/30" };
  if (s >= 40) return { text: "text-yellow-400", ring: "stroke-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/30" };
  return { text: "text-red-400", ring: "stroke-red-500", bg: "bg-red-500/10 border-red-500/30" };
}

function verdictBadge(v: "good" | "bad" | "missing") {
  if (v === "good")    return "bg-green-500/10 text-green-400 border-green-500/20";
  if (v === "missing") return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  return "bg-red-500/10 text-red-400 border-red-500/20";
}

function ScoreCircle({ score }: { score: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const c = scoreColor(score);
  return (
    <div className="flex flex-col items-center">
      <svg width="136" height="136" className="-rotate-90">
        <circle cx="68" cy="68" r={r} fill="none" stroke="#1f2937" strokeWidth="10" />
        <circle
          cx="68" cy="68" r={r} fill="none" strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${c.ring} transition-all duration-700`}
        />
      </svg>
      <div className="-mt-[100px] mb-[32px] flex flex-col items-center">
        <span className={`text-4xl font-bold ${c.text}`}>{score}</span>
        <span className="text-gray-500 text-xs mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

export default function LinkedInAnalyser() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profileText, setProfileText] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LinkedInResult | null>(null);
  const [copiedKw, setCopiedKw] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const prof = localStorage.getItem("placeiq_profile");
      if (prof) {
        const p = JSON.parse(prof);
        setTargetRole(p.targetRole || "");
      }
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setResult(JSON.parse(cached));
    } catch {}
  }, []);

  async function analyse() {
    if (!profileText.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("http://localhost:8000/api/linkedin/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_text: profileText.trim(),
          target_role: targetRole.trim() || "Software Engineer",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: LinkedInResult = await res.json();
      setResult(data);
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function copyKeywords() {
    if (!result) return;
    await navigator.clipboard.writeText(result.ats_keywords.join(", "));
    setCopiedKw(true);
    setTimeout(() => setCopiedKw(false), 2000);
  }

  if (status === "loading") return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </main>
  );

  const c = result ? scoreColor(result.profile_score) : null;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold cursor-pointer" onClick={() => router.push("/dashboard")}>
            Place<span className="text-blue-500">IQ</span>
          </h1>
          <div className="flex gap-4 flex-wrap">
            {NAV_LINKS.map(n => (
              <button
                key={n.path}
                onClick={() => !n.active && router.push(n.path)}
                className={`text-sm transition pb-0.5 ${n.active ? "text-white border-b border-blue-500" : "text-gray-400 hover:text-white"}`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <img src={session?.user?.image || ""} className="w-8 h-8 rounded-full" alt="" />
          <span className="text-gray-400 text-sm">{session?.user?.name}</span>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-sm text-gray-500 hover:text-white transition">Sign out</button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">LinkedIn Profile Analyser</h2>
        <p className="text-gray-400 mb-8">Get an AI-powered audit of your LinkedIn profile for Indian tech placements</p>

        {/* How-to instructions */}
        <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl p-5 mb-6">
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">How to copy your LinkedIn profile text</p>
          <ol className="space-y-1.5 text-sm text-gray-400">
            <li className="flex gap-2"><span className="text-blue-500 font-bold shrink-0">1.</span>Open your LinkedIn profile in a browser and scroll to the top.</li>
            <li className="flex gap-2"><span className="text-blue-500 font-bold shrink-0">2.</span>Press <kbd className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded text-xs font-mono">Ctrl+A</kbd> (Windows) or <kbd className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded text-xs font-mono">Cmd+A</kbd> (Mac) to select all, then <kbd className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded text-xs font-mono">Ctrl+C</kbd> to copy.</li>
            <li className="flex gap-2"><span className="text-blue-500 font-bold shrink-0">3.</span>Or manually copy your <strong className="text-gray-300">Headline</strong>, <strong className="text-gray-300">About</strong>, <strong className="text-gray-300">Experience</strong>, <strong className="text-gray-300">Projects</strong>, and <strong className="text-gray-300">Skills</strong> sections.</li>
            <li className="flex gap-2"><span className="text-blue-500 font-bold shrink-0">4.</span>Paste everything in the box below. The more you paste, the better the analysis.</li>
          </ol>
        </div>

        {/* Input form */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 mb-8">
          <div className="mb-4">
            <label className="text-xs text-gray-400 mb-1.5 block">Target Role</label>
            <input
              value={targetRole}
              onChange={e => setTargetRole(e.target.value)}
              placeholder="e.g. Software Engineer, Data Scientist, Frontend Developer"
              className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
          <div className="mb-5">
            <label className="text-xs text-gray-400 mb-1.5 block">
              LinkedIn Profile Text *
              <span className="ml-2 text-gray-600 font-normal">({profileText.length} characters)</span>
            </label>
            <textarea
              value={profileText}
              onChange={e => setProfileText(e.target.value)}
              placeholder={`Paste your LinkedIn profile text here...\n\nExample:\nJohn Doe\nFinal Year B.Tech Computer Science | VIT Vellore | CGPA 8.2\n\nAbout\nPassionate software engineering student...\n\nExperience\nSoftware Engineer Intern | Infosys | Jun 2024 – Aug 2024\n...\n\nSkills\nPython, Java, React, SQL...`}
              rows={12}
              className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300 placeholder-gray-700 focus:outline-none focus:border-blue-500 transition resize-y font-mono leading-relaxed"
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            {result && (
              <button
                onClick={() => { setResult(null); localStorage.removeItem(CACHE_KEY); setProfileText(""); }}
                className="text-sm text-gray-500 hover:text-gray-300 transition"
              >
                Clear & re-analyse
              </button>
            )}
            <button
              onClick={analyse}
              disabled={loading || !profileText.trim()}
              className="ml-auto bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-8 py-3 rounded-xl font-medium text-sm transition"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analysing your LinkedIn profile...
                </span>
              ) : "Analyse Profile →"}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">{error}</div>
        )}

        {/* ── Results ── */}
        {result && (
          <div ref={resultRef} className="space-y-5">

            {/* Row 1: Score + Overall Verdict */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Score circle */}
              <div className={`bg-[#111] border rounded-2xl p-6 flex flex-col items-center justify-center ${c!.bg}`}>
                <ScoreCircle score={result.profile_score} />
                <p className={`text-sm font-semibold mt-1 ${c!.text}`}>
                  {result.profile_score >= 70 ? "Strong Profile" : result.profile_score >= 40 ? "Needs Work" : "Weak Profile"}
                </p>
                <p className="text-xs text-gray-500 mt-1">LinkedIn Profile Score</p>
              </div>

              {/* Overall verdict */}
              <div className="md:col-span-2 bg-[#111] border border-gray-800 rounded-2xl p-6 flex flex-col justify-center">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Overall Verdict</p>
                <p className="text-gray-200 text-base leading-relaxed font-medium">{result.overall_verdict}</p>
              </div>
            </div>

            {/* Quick Wins — most prominent */}
            <div className="bg-[#111] border border-blue-500/30 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">⚡</span>
                <h3 className="font-semibold text-white">Quick Wins</h3>
                <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full ml-1">Fix today in &lt;10 min</span>
              </div>
              <ol className="space-y-2.5">
                {result.quick_wins.map((win, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                    <span className="text-sm text-gray-300 leading-relaxed">{win}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Headline */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">Headline</h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full border capitalize font-medium ${verdictBadge(result.headline_analysis.verdict)}`}>
                  {result.headline_analysis.verdict}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#0a0a0a] rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Current</p>
                  <p className="text-sm text-gray-400 leading-relaxed italic">
                    {result.headline_analysis.current || "Not detected"}
                  </p>
                </div>
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                  <p className="text-xs text-green-500 mb-2 uppercase tracking-wider">Suggested</p>
                  <p className="text-sm text-green-300 leading-relaxed font-medium">
                    {result.headline_analysis.suggested}
                  </p>
                </div>
              </div>
            </div>

            {/* ATS Keywords */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white">ATS Keywords</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Include these in your headline, about, and experience sections</p>
                </div>
                <button
                  onClick={copyKeywords}
                  className={`text-xs px-3 py-1.5 rounded-lg transition font-medium ${copiedKw ? "bg-green-600/20 text-green-400 border border-green-500/30" : "bg-gray-800 hover:bg-gray-700 text-gray-300"}`}
                >
                  {copiedKw ? "Copied!" : "Copy All"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.ats_keywords.map(kw => (
                  <span key={kw} className="bg-blue-600/10 border border-blue-500/20 text-blue-300 text-sm px-3 py-1 rounded-full font-mono">
                    {kw}
                  </span>
                ))}
              </div>
            </div>

            {/* Skills to add / remove */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold text-white mb-1">Skills to Add</h3>
                <p className="text-xs text-gray-500 mb-4">Missing from your profile for {targetRole || "your target role"}</p>
                {result.skills_section.missing_key_skills.length > 0 ? (
                  <ul className="space-y-2">
                    {result.skills_section.missing_key_skills.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-green-500 text-base leading-none">+</span>
                        <span className="text-gray-300">{s}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-green-400 text-sm">Your skills section looks complete ✓</p>
                )}
              </div>
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold text-white mb-1">Skills to Remove</h3>
                <p className="text-xs text-gray-500 mb-4">Cluttering your profile and diluting your brand</p>
                {result.skills_section.skills_to_remove.length > 0 ? (
                  <ul className="space-y-2">
                    {result.skills_section.skills_to_remove.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-red-500 text-base leading-none">−</span>
                        <span className="text-gray-300">{s}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-green-400 text-sm">No obvious skills to remove ✓</p>
                )}
              </div>
            </div>

            {/* About section */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">About Section</h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full border capitalize font-medium ${verdictBadge(result.about_section.verdict)}`}>
                  {result.about_section.verdict}
                </span>
              </div>
              {result.about_section.issues.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Issues Found</p>
                  <ul className="space-y-1.5">
                    {result.about_section.issues.map((iss, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                        <span className="text-red-500 shrink-0 mt-0.5">!</span>
                        {iss}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.about_section.suggested_opening && (
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                  <p className="text-xs text-green-500 mb-2 uppercase tracking-wider">Suggested Opening</p>
                  <p className="text-sm text-green-300 leading-relaxed italic">"{result.about_section.suggested_opening}"</p>
                </div>
              )}
            </div>

            {/* Experience gaps + Projects — side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold text-white mb-4">Experience Gaps</h3>
                {result.experience_gaps.length > 0 ? (
                  <ul className="space-y-2.5">
                    {result.experience_gaps.map((g, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                        <span className="text-yellow-500 shrink-0 mt-0.5">→</span>
                        {g}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-green-400 text-sm">Experience section looks solid ✓</p>
                )}
              </div>
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-white">Projects Section</h3>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full border capitalize font-medium ${verdictBadge(result.projects_section.verdict)}`}>
                    {result.projects_section.verdict}
                  </span>
                </div>
                {result.projects_section.improvements.length > 0 ? (
                  <ul className="space-y-2.5">
                    {result.projects_section.improvements.map((imp, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                        <span className="text-blue-400 shrink-0 mt-0.5">→</span>
                        {imp}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-green-400 text-sm">Projects section is well-presented ✓</p>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
