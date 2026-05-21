"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Profile = {
  placementScore: number;
  scoreReasoning: string;
  collegeTier: string;
  skills: string[];
  targetRole: string;
  college: string;
  branch: string;
  cgpa: number;
  projectsCount: string;
  hasInternship: string;
  internshipMonths: string;
  leetcodeCount: string;
  hackathons: string;
  githubActive: string;
};

type SkillItem = {
  skill: string;
  why_important: string;
  time_to_learn: string;
  free_resource_link: string;
};

const TIER_STYLES: Record<string, string> = {
  "Tier 1": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "Tier 2": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "Tier 3": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [skillGaps, setSkillGaps] = useState<SkillItem[] | null>(null);
  const [skillGapLoading, setSkillGapLoading] = useState(false);
  const [companyMatches, setCompanyMatches] = useState<Array<{ name: string; type: string }> | null>(null);
  const [companyCount, setCompanyCount] = useState(0);
  const [companyMatchLoading, setCompanyMatchLoading] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.email) return;

    const email = encodeURIComponent(session.user.email);
    fetch(`http://localhost:8000/api/user/profile/${email}`)
      .then(res => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [status, session?.user?.email]);

  useEffect(() => {
    if (!profile) return;
    setSkillGapLoading(true);
    (async () => {
      try {
        const res = await fetch("http://localhost:8000/api/skills/gap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_role: profile.targetRole,
            skills: profile.skills,
            college_tier: profile.collegeTier,
            branch: profile.branch,
            cgpa: profile.cgpa,
          }),
        });
        if (!res.ok) return;
        const parsed = await res.json();
        if (parsed && !parsed.error && Array.isArray(parsed.must_have_missing)) {
          setSkillGaps(parsed.must_have_missing.slice(0, 3));
        }
      } catch {
        // silently fail — dashboard preview is best-effort
      } finally {
        setSkillGapLoading(false);
      }
    })();
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    setCompanyMatchLoading(true);
    (async () => {
      try {
        const res = await fetch("http://localhost:8000/api/companies/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            college: profile.college,
            college_tier: profile.collegeTier,
            branch: profile.branch,
            cgpa: profile.cgpa,
            skills: profile.skills,
            target_role: profile.targetRole,
            projects_count: profile.projectsCount || "0",
            has_internship: profile.hasInternship || "no",
            internship_months: profile.internshipMonths || "",
            leetcode_count: profile.leetcodeCount || "0",
            hackathons: profile.hackathons || "0",
            github_active: profile.githubActive || "no",
          }),
        });
        if (!res.ok) return;
        const parsed = await res.json();
        if (parsed && !parsed.error && Array.isArray(parsed.companies)) {
          setCompanyCount(parsed.companies.length);
          setCompanyMatches(
            parsed.companies
              .sort((a: { match_score: number }, b: { match_score: number }) => b.match_score - a.match_score)
              .slice(0, 3)
              .map((c: { name: string; type: string }) => ({ name: c.name, type: c.type }))
          );
        }
      } catch {
        // silently fail — dashboard preview is best-effort
      } finally {
        setCompanyMatchLoading(false);
      }
    })();
  }, [profile]);

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
            <button className="text-sm text-white border-b border-blue-500 pb-0.5">
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
            <button onClick={() => router.push("/resume")} className="text-sm text-gray-400 hover:text-white transition">
              Resume
            </button>
            <button onClick={() => router.push("/tracker")} className="text-sm text-gray-400 hover:text-white transition">
              Tracker
            </button>
            <button onClick={() => router.push("/oncampus")} className="text-sm text-gray-400 hover:text-white transition">
              On Campus
            </button>
            <button onClick={() => router.push("/offcampus")} className="text-sm text-gray-400 hover:text-white transition">
              Off Campus
            </button>
            <button onClick={() => router.push("/resources")} className="text-sm text-gray-400 hover:text-white transition">
              Resources
            </button>
            <button onClick={() => router.push("/coldemail")} className="text-sm text-gray-400 hover:text-white transition">
              Cold Email
            </button>
            <button onClick={() => router.push("/company-directory")} className="text-sm text-gray-400 hover:text-white transition">
              Directory
            </button>
            <button onClick={() => router.push("/linkedin")} className="text-sm text-gray-400 hover:text-white transition">
              LinkedIn
            </button>
            <button onClick={() => router.push("/pyq")} className="text-sm text-gray-400 hover:text-white transition">
              PYQ
            </button>
            <button onClick={() => router.push("/internships")} className="text-sm text-gray-400 hover:text-white transition">
              Internships
            </button>
            <button onClick={() => router.push("/referral")} className="text-sm text-gray-400 hover:text-white transition">
              Referral Radar
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

      {/* Content */}
      <div className="max-w-6xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">Welcome, {session?.user?.name?.split(" ")[0]}</h2>
        <p className="text-gray-400 mb-10">
          {profile ? `Targeting ${profile.targetRole} · ${profile.college}` : "Complete your profile to get your placement score."}
        </p>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-400 text-sm">Placement Score</p>
              {profile?.collegeTier && (
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TIER_STYLES[profile.collegeTier] ?? "bg-gray-700/50 text-gray-400 border-gray-600"}`}>
                  {profile.collegeTier}
                </span>
              )}
            </div>
            {profileLoading ? (
              <div className="h-10 w-16 bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-4xl font-bold text-blue-500">
                {profile ? profile.placementScore : "--"}
              </p>
            )}
            <p className="text-gray-600 text-xs mt-2">
              {profile ? "out of 100" : "Complete profile to unlock"}
            </p>
          </div>

          {/* AI reasoning — spans full width, below the 3-card row */}
          {!profileLoading && profile?.scoreReasoning && (
            <div className="md:col-span-3 bg-blue-600/5 border border-blue-500/20 rounded-2xl px-6 py-4">
              <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">AI Analysis</p>
              <p className="text-gray-300 text-sm leading-relaxed">{profile.scoreReasoning}</p>
            </div>
          )}

          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-400 text-sm">Top Skill Gaps</p>
              {profile && (
                <button
                  onClick={() => router.push("/skills")}
                  className="text-xs text-blue-400 hover:text-blue-300 transition"
                >
                  View all &rarr;
                </button>
              )}
            </div>
            {profileLoading || skillGapLoading ? (
              <div className="space-y-2.5 mt-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-3.5 bg-gray-800 rounded animate-pulse" style={{ width: `${75 - i * 10}%` }} />
                ))}
              </div>
            ) : !profile ? (
              <>
                <p className="text-4xl font-bold text-gray-700">--</p>
                <p className="text-gray-600 text-xs mt-2">Complete profile to unlock</p>
              </>
            ) : skillGaps && skillGaps.length > 0 ? (
              <ul className="space-y-2 mt-1">
                {skillGaps.map((gap, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-red-500 shrink-0">!</span>
                    <span className="text-gray-300 truncate">{gap.skill}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-green-400 text-sm font-medium mt-1">No critical gaps found</p>
            )}
          </div>

          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-2">Skills Listed</p>
            {profileLoading ? (
              <div className="h-10 w-16 bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-4xl font-bold text-yellow-500">
                {profile ? profile.skills.length : "--"}
              </p>
            )}
            <p className="text-gray-600 text-xs mt-2">
              {profile ? "skills on your profile" : "Complete profile to unlock"}
            </p>
          </div>

          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-400 text-sm">Company Matches</p>
              {profile && (
                <button
                  onClick={() => router.push("/companies")}
                  className="text-xs text-blue-400 hover:text-blue-300 transition"
                >
                  View all &rarr;
                </button>
              )}
            </div>
            {profileLoading || companyMatchLoading ? (
              <div className="space-y-2.5 mt-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-3.5 bg-gray-800 rounded animate-pulse" style={{ width: `${80 - i * 12}%` }} />
                ))}
              </div>
            ) : !profile ? (
              <>
                <p className="text-4xl font-bold text-gray-700">--</p>
                <p className="text-gray-600 text-xs mt-2">Complete profile to unlock</p>
              </>
            ) : companyMatches && companyMatches.length > 0 ? (
              <>
                <p className="text-4xl font-bold text-green-500 mb-2">{companyCount}</p>
                <ul className="space-y-1.5">
                  {companyMatches.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
                        c.type === "Product"
                          ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                          : c.type === "Startup"
                          ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
                          : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                      }`}>
                        {c.type?.[0]}
                      </span>
                      <span className="text-gray-300 truncate">{c.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-gray-500 text-sm mt-1">No matches found</p>
            )}
          </div>
        </div>

        {/* CTA — only shown when no profile */}
        {!profileLoading && !profile && (
          <div className="bg-blue-600/10 border border-blue-500/30 rounded-2xl p-8 text-center">
            <h3 className="text-xl font-bold mb-2">Complete your profile</h3>
            <p className="text-gray-400 mb-6">Tell us about your college, skills, and goals to get personalised insights.</p>
            <button
              onClick={() => router.push("/onboarding")}
              className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-medium transition"
            >
              Get Started →
            </button>
          </div>
        )}

        {/* Skills summary — shown when profile exists */}
        {!profileLoading && profile && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Your Skills</h3>
              <button
                onClick={() => router.push("/onboarding")}
                className="text-sm text-blue-400 hover:text-blue-300 transition"
              >
                Update profile →
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.skills.map(skill => (
                <span key={skill} className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* View Full Roadmap CTA */}
        {!profileLoading && profile && (
          <div className="mt-6 bg-[#111] border border-gray-800 rounded-2xl p-6 flex items-center justify-between">
            <div>
              <h3 className="font-semibold mb-1">Your 90-Day Prep Roadmap</h3>
              <p className="text-gray-400 text-sm">
                Personalised daily plan to get placed at your target companies.
              </p>
            </div>
            <button
              onClick={() => router.push("/roadmap")}
              className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              View Roadmap →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
