"use client";
import { useState, useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

type SkillItem = {
  skill: string;
  why_important: string;
  time_to_learn: string;
  free_resource_link: string;
};

type ImproveItem = {
  skill: string;
  what_to_focus_on: string;
  free_resource_link: string;
};

type SkillGapResult = {
  must_have_missing: SkillItem[];
  good_to_have_missing: SkillItem[];
  skills_to_improve: ImproveItem[];
  service_company_ready: boolean;
  product_company_ready: boolean;
  verdict: string;
};

type StoredProfile = {
  targetRole: string;
  skills: string[];
  collegeTier: string;
  branch: string;
  cgpa: number;
};

function ResourceLink({ href, label = "Learn free" }: { href: string; label?: string }) {
  const isValidUrl = href && (href.startsWith("http://") || href.startsWith("https://"));
  if (!isValidUrl) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 text-xs px-3 py-1.5 rounded-lg border transition"
      style={{ whiteSpace: "nowrap" }}
    >
      {label} &rarr;
    </a>
  );
}

export default function SkillGap() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasFetched = useRef(false);

  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [result, setResult] = useState<SkillGapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
          branch: p.branch || "",
          cgpa: Number(p.cgpa) || 0,
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (profile && !hasFetched.current) {
      hasFetched.current = true;
      analyse(profile);
    }
  }, [profile]);

  const analyse = async (p: StoredProfile) => {
    // Serve from cache unless this is an explicit re-analyse
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
      const res = await fetch("http://localhost:8000/api/skills/gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_role: p.targetRole,
          skills: p.skills,
          college_tier: p.collegeTier,
          branch: p.branch,
          cgpa: p.cgpa,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Analysis failed");
      }

      const parsed = await res.json();

      if (!parsed) {
        setError("No response from server. Please try again.");
        return;
      }
      if (parsed.error) {
        setError(parsed.error);
        return;
      }

      const newResult = {
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
      setError(err instanceof Error ? err.message : "Analysis failed. Make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const reAnalyse = () => {
    if (!profile) return;
    if (
      !window.confirm(
        "Are you sure? This will replace your current skill gap analysis and cannot be undone."
      )
    )
      return;
    localStorage.removeItem("placeiq_skillgap");
    hasFetched.current = false;
    analyse(profile);
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
          <h1
            className="text-xl font-bold cursor-pointer"
            onClick={() => router.push("/dashboard")}
          >
            Place<span className="text-blue-500">IQ</span>
          </h1>
          <div className="flex gap-6">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-sm text-gray-400 hover:text-white transition"
            >
              Dashboard
            </button>
            <button className="text-sm text-white border-b border-blue-500 pb-0.5">
              Skill Gap
            </button>
            <button
              onClick={() => router.push("/companies")}
              className="text-sm text-gray-400 hover:text-white transition"
            >
              Companies
            </button>
            <button
              onClick={() => router.push("/roadmap")}
              className="text-sm text-gray-400 hover:text-white transition"
            >
              Roadmap
            </button>
            <button
              onClick={() => router.push("/market")}
              className="text-sm text-gray-400 hover:text-white transition"
            >
              Market
            </button>
            <button
              onClick={() => router.push("/resume")}
              className="text-sm text-gray-400 hover:text-white transition"
            >
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

      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-3xl font-bold">Skill Gap Engine</h2>
            <p className="text-gray-400 mt-2">
              AI analysis of what you need to land a job in the Indian market in 2025.
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

        {/* No profile */}
        {!profile && !loading && (
          <div className="mt-10 bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <p className="text-gray-300 mb-4">
              Complete your profile first to get personalised skill gap analysis.
            </p>
            <button
              onClick={() => router.push("/onboarding")}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              Complete Profile
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-24 flex flex-col items-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-6" />
            <p className="text-gray-400 text-sm">Analysing Indian job market requirements...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mt-6 bg-red-950/40 border border-red-500/25 rounded-xl p-5">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={reAnalyse}
              className="mt-3 text-xs text-red-300 hover:text-white underline transition"
            >
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="mt-8 space-y-8">

            {/* Readiness badges */}
            <div className="flex flex-wrap gap-3">
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
            </div>

            {/* Must Have */}
            {result.must_have_missing.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-red-400 mb-1">
                  Must Have &mdash; Get These First
                </h3>
                <p className="text-gray-500 text-sm mb-4">
                  Non-negotiable skills missing from your profile for this role.
                </p>
                <div className="space-y-3">
                  {result.must_have_missing.map((item, i) => (
                    <div
                      key={i}
                      className="bg-red-950/25 border border-red-500/20 rounded-xl p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white mb-1">{item.skill}</p>
                          <p className="text-gray-400 text-sm mb-2 leading-relaxed">
                            {item.why_important}
                          </p>
                          <p className="text-red-400 text-xs">
                            Time to learn: {item.time_to_learn}
                          </p>
                        </div>
                        <a
                          href={item.free_resource_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 text-xs px-3 py-1.5 rounded-lg transition"
                        >
                          Learn free &rarr;
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Good to Have */}
            {result.good_to_have_missing.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-yellow-400 mb-1">
                  Good to Have &mdash; Get an Edge
                </h3>
                <p className="text-gray-500 text-sm mb-4">
                  Not mandatory but will significantly improve your chances.
                </p>
                <div className="space-y-3">
                  {result.good_to_have_missing.map((item, i) => (
                    <div
                      key={i}
                      className="bg-yellow-950/20 border border-yellow-500/20 rounded-xl p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white mb-1">{item.skill}</p>
                          <p className="text-gray-400 text-sm mb-2 leading-relaxed">
                            {item.why_important}
                          </p>
                          <p className="text-yellow-500 text-xs">
                            Time to learn: {item.time_to_learn}
                          </p>
                        </div>
                        <a
                          href={item.free_resource_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 bg-yellow-600/20 hover:bg-yellow-600/40 border border-yellow-500/30 text-yellow-300 text-xs px-3 py-1.5 rounded-lg transition"
                        >
                          Learn free &rarr;
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Skills to Strengthen */}
            {result.skills_to_improve.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-blue-400 mb-1">
                  Skills to Strengthen
                </h3>
                <p className="text-gray-500 text-sm mb-4">
                  You have these listed but likely need to deepen them — common for freshers.
                </p>
                <div className="space-y-3">
                  {result.skills_to_improve.map((item, i) => (
                    <div
                      key={i}
                      className="bg-blue-950/20 border border-blue-500/20 rounded-xl p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white mb-1">{item.skill}</p>
                          <p className="text-gray-400 text-sm leading-relaxed">
                            {item.what_to_focus_on}
                          </p>
                        </div>
                        <a
                          href={item.free_resource_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-300 text-xs px-3 py-1.5 rounded-lg transition"
                        >
                          Learn free &rarr;
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* All gaps filled */}
            {result.must_have_missing.length === 0 &&
              result.good_to_have_missing.length === 0 && (
              <div className="bg-green-950/30 border border-green-500/25 rounded-2xl p-6 text-center">
                <p className="text-green-400 font-semibold text-lg mb-1">
                  Strong profile for this role
                </p>
                <p className="text-gray-400 text-sm">
                  No critical skill gaps detected. Focus on deepening what you already have.
                </p>
              </div>
            )}

            {/* Verdict */}
            <div className="bg-[#111] border border-gray-700 rounded-2xl p-6">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">
                Market Verdict
              </p>
              <p className="text-gray-200 leading-relaxed font-medium">{result.verdict}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
