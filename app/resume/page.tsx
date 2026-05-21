"use client";
import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

type ResumeAnalysis = {
  resume_score: number;
  strengths: string[];
  gaps: string[];
  missing_skills: string[];
  ats_issues: string[];
  one_line_verdict: string;
};

function ScoreCircle({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    const t = setTimeout(() => setOffset(circumference - (score / 100) * circumference), 80);
    return () => clearTimeout(t);
  }, [score, circumference]);

  return (
    <div className="relative flex items-center justify-center">
      <svg width="148" height="148" className="-rotate-90">
        <circle cx="74" cy="74" r={radius} fill="none" stroke="#1f2937" strokeWidth="12" />
        <circle
          cx="74" cy="74" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-4xl font-bold" style={{ color }}>{score}</p>
        <p className="text-xs text-gray-500 mt-0.5">/ 100</p>
      </div>
    </div>
  );
}

export default function ResumeAnalyser() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [result, setResult] = useState<ResumeAnalysis | null>(null);
  const [error, setError] = useState("");

  const statusMessages = [
    "Extracting resume content...",
    "Identifying your skills and experience...",
    `Comparing against ${targetRole || "your target role"} requirements...`,
    "Checking ATS compatibility...",
    "Generating your score...",
  ];

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (!loading) { setStatusIdx(0); return; }
    const id = setInterval(() => {
      setStatusIdx(i => Math.min(i + 1, statusMessages.length - 1));
    }, 1500);
    return () => clearInterval(id);
  }, [loading]); // statusMessages.length is constant — safe to omit

  useEffect(() => {
    try {
      const stored = localStorage.getItem("placeiq_profile");
      if (stored) {
        const p = JSON.parse(stored);
        if (p.targetRole) setTargetRole(p.targetRole);
      }
    } catch {}
  }, []);

  const handleFile = (f: File) => {
    if (f.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    setFile(f);
    setError("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const submit = async () => {
    if (!file || !targetRole.trim()) return;
    setLoading(true);
    setStatusIdx(0);
    setResult(null);
    setError("");

    // Read saved skills from profile
    let skills: string[] = [];
    try {
      const stored = localStorage.getItem("placeiq_profile");
      if (stored) skills = JSON.parse(stored).skills ?? [];
    } catch {}

    const formData = new FormData();
    formData.append("file", file);
    formData.append("target_role", targetRole.trim());
    formData.append("user_skills", JSON.stringify(skills));
    // DO NOT set Content-Type — browser sets it with the multipart boundary automatically

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch("http://localhost:8000/api/resume/analyse", {
        method: "POST",
        body: formData,
        signal: controller.signal,
        // No Content-Type header
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Analysis failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      // Strip markdown code fences Groq sometimes wraps around JSON
      let jsonText = fullText.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.split("```")[1] ?? "";
        if (jsonText.startsWith("json")) jsonText = jsonText.slice(4);
        jsonText = jsonText.trim();
      }
      const parsed = JSON.parse(jsonText);
      if (parsed.error) throw new Error(parsed.error);
      parsed.resume_score = Math.max(0, Math.min(100, Number(parsed.resume_score)));
      setResult(parsed);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Analysis is taking longer than usual. Please try again.");
      } else {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Analysis failed. Make sure the backend is running."
        );
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

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
          <h1 className="text-xl font-bold cursor-pointer" onClick={() => router.push("/dashboard")}>
            Place<span className="text-blue-500">IQ</span>
          </h1>
          <div className="flex gap-6">
            <button onClick={() => router.push("/dashboard")} className="text-sm text-gray-400 hover:text-white transition">
              Dashboard
            </button>
            <button onClick={() => router.push("/skills")} className="text-sm text-gray-400 hover:text-white transition">
              Skill Gap
            </button>
            <button onClick={() => router.push("/companies")} className="text-sm text-gray-400 hover:text-white transition">
              Companies
            </button>
            <button onClick={() => router.push("/roadmap")} className="text-sm text-gray-400 hover:text-white transition">
              Roadmap
            </button>
            <button onClick={() => router.push("/market")} className="text-sm text-gray-400 hover:text-white transition">
              Market
            </button>
            <button className="text-sm text-white border-b border-blue-500 pb-0.5">
              Resume Analyser
            </button>
            <button onClick={() => router.push("/tracker")} className="text-sm text-gray-400 hover:text-white transition">
              Tracker
            </button>
            <button onClick={() => router.push("/company-directory")} className="text-sm text-gray-400 hover:text-white transition">
              Directory
            </button>
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

        {/* Upload form — always visible above results */}
        {!result && (
          <>
            <h2 className="text-3xl font-bold mb-2">Resume Analyser</h2>
            <p className="text-gray-400 mb-10">Upload your resume and get brutally honest AI feedback tailored to your target role.</p>

            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition mb-6 ${
                dragging
                  ? "border-blue-500 bg-blue-600/5"
                  : file
                  ? "border-green-500/50 bg-green-600/5"
                  : "border-gray-700 hover:border-gray-500 bg-[#111]"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {file ? (
                <>
                  <p className="text-green-400 text-lg font-medium mb-1">{file.name}</p>
                  <p className="text-gray-500 text-sm">{(file.size / 1024).toFixed(0)} KB — click to replace</p>
                </>
              ) : (
                <>
                  <p className="text-gray-300 text-lg mb-2">Drop your resume here</p>
                  <p className="text-gray-500 text-sm">or click to browse — PDF only</p>
                </>
              )}
            </div>

            {/* Target role */}
            <div className="mb-6">
              <label className="text-sm text-gray-400 mb-2 block">Target Role</label>
              <input
                className="w-full bg-[#111] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                placeholder="e.g. Software Engineer"
                value={targetRole}
                onChange={e => setTargetRole(e.target.value)}
              />
            </div>

            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            <button
              onClick={submit}
              disabled={!file || !targetRole.trim() || loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition"
            >
              {loading ? "Analysing your resume with AI..." : "Analyse Resume"}
            </button>
          </>
        )}

        {/* Loading — sequential status messages */}
        {loading && (
          <div className="mt-20 flex flex-col items-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-10" />
            <div className="space-y-4 w-full max-w-xs">
              {statusMessages.map((msg, i) => (
                i <= statusIdx && (
                  <div
                    key={i}
                    className={`flex items-center gap-3 text-sm transition-opacity duration-500 ${
                      i === statusIdx ? "text-white opacity-100" : "text-gray-500 opacity-50"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      i === statusIdx ? "bg-blue-500 animate-pulse" : "bg-gray-600"
                    }`} />
                    {msg}
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div>
            {/* Header row: verdict + re-analyse */}
            <div className="flex items-start justify-between mb-8 gap-4">
              <div>
                <h2 className="text-3xl font-bold mb-3">Resume Analysis</h2>
                <p className="text-gray-300 text-base font-medium leading-relaxed border-l-4 border-blue-500 pl-4 italic">
                  "{result.one_line_verdict}"
                </p>
              </div>
              <button
                onClick={() => { setResult(null); setFile(null); setError(""); }}
                className="shrink-0 border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white px-4 py-2 rounded-lg text-sm transition"
              >
                Analyse another
              </button>
            </div>

            {/* Score circle */}
            <div className="flex justify-center mb-8">
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-8 text-center">
                <ScoreCircle score={result.resume_score} />
                <p className="text-gray-400 text-sm mt-3">Resume Score</p>
              </div>
            </div>

            {/* Strengths + Gaps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-green-950/40 border border-green-500/25 rounded-2xl p-6">
                <h3 className="font-semibold text-green-400 mb-4">Strengths</h3>
                <ul className="space-y-2">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-green-500 mt-0.5 shrink-0">+</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-red-950/40 border border-red-500/25 rounded-2xl p-6">
                <h3 className="font-semibold text-red-400 mb-4">Gaps</h3>
                <ul className="space-y-2">
                  {result.gaps.map((g, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-red-500 mt-0.5 shrink-0">-</span>
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Missing skills */}
            {result.missing_skills.length > 0 && (
              <div className="bg-yellow-950/30 border border-yellow-500/25 rounded-2xl p-6 mb-4">
                <h3 className="font-semibold text-yellow-400 mb-4">Missing Skills for {targetRole}</h3>
                <div className="flex flex-wrap gap-2">
                  {result.missing_skills.map((skill, i) => (
                    <span key={i} className="bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-xs px-3 py-1.5 rounded-full">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ATS issues */}
            {result.ats_issues.length > 0 && (
              <div className="bg-orange-950/30 border border-orange-500/25 rounded-2xl p-6">
                <h3 className="font-semibold text-orange-400 mb-4">ATS Issues</h3>
                <ul className="space-y-2">
                  {result.ats_issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-orange-500 mt-0.5 shrink-0">!</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
