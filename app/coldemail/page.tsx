"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Profile = {
  college: string;
  skills: string[];
  targetRole: string;
  projectsCount: string;
  hasInternship: string;
  internshipMonths: string;
  collegeTier: string;
};

const NAV_LINKS = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Skill Gap", path: "/skills" },
  { label: "Companies", path: "/companies" },
  { label: "Roadmap", path: "/roadmap" },
  { label: "Market", path: "/market" },
  { label: "Resume", path: "/resume" },
  { label: "Tracker", path: "/tracker" },
  { label: "On Campus", path: "/oncampus" },
  { label: "Off Campus", path: "/offcampus" },
  { label: "Resources", path: "/resources" },
  { label: "Cold Email", path: "/coldemail", active: true },
  { label: "Directory", path: "/company-directory" },
];

export default function ColdEmail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("placeiq_profile");
      if (raw) {
        const p = JSON.parse(raw);
        setProfile(p);
        setRole(p.targetRole || "");
      }
    } catch {}
  }, []);

  async function generate() {
    if (!company.trim() || !role.trim()) return;
    setLoading(true);
    setError("");
    setEmail("");
    try {
      const res = await fetch("http://localhost:8000/api/coldemail/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: company.trim(),
          role: role.trim(),
          user_name: session?.user?.name || "",
          college: profile?.college || "",
          skills: profile?.skills || [],
          projects_count: profile?.projectsCount || "0",
          has_internship: profile?.hasInternship || "no",
          internship_months: profile?.internshipMonths || "",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setEmail(data.email || "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (textareaRef.current) {
        textareaRef.current.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }

  if (status === "loading") return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
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

      <div className="max-w-4xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">Cold Email Generator</h2>
        <p className="text-gray-400 mb-8">Generate a personalised cold email to reach recruiters at any company</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left — inputs */}
          <div className="space-y-6">
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <h3 className="font-semibold mb-4 text-sm text-gray-300 uppercase tracking-wider">Target</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Company Name *</label>
                  <input
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="e.g. Razorpay, Zepto, Microsoft"
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Role / Position *</label>
                  <input
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    placeholder="e.g. SDE-1, Data Analyst, Product Manager"
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
              </div>
            </div>

            {/* Profile preview */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <h3 className="font-semibold mb-4 text-sm text-gray-300 uppercase tracking-wider">Using Your Profile</h3>
              {profile ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between">
                    <span className="text-gray-500">Name</span>
                    <span className="text-gray-300">{session?.user?.name || "—"}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-gray-500">College</span>
                    <span className="text-gray-300 text-right max-w-[60%] truncate">{profile.college}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-gray-500">Projects</span>
                    <span className="text-gray-300">{profile.projectsCount}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-gray-500">Internship</span>
                    <span className="text-gray-300">
                      {profile.hasInternship === "yes" ? `Yes (${profile.internshipMonths} mo)` : "No"}
                    </span>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-2">Top Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.skills.slice(0, 6).map(s => (
                        <span key={s} className="bg-blue-600/10 border border-blue-500/20 text-blue-400 text-xs px-2 py-0.5 rounded-full">{s}</span>
                      ))}
                      {profile.skills.length > 6 && (
                        <span className="text-gray-600 text-xs px-2 py-0.5">+{profile.skills.length - 6} more</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-gray-500 text-sm mb-3">No profile found — the email will be generic.</p>
                  <button onClick={() => router.push("/onboarding")} className="text-blue-400 hover:text-blue-300 text-sm transition">
                    Complete profile for better emails →
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={generate}
              disabled={loading || !company.trim() || !role.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white py-3 rounded-xl font-medium transition text-sm"
            >
              {loading ? "Generating..." : "Generate Cold Email →"}
            </button>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>
            )}
          </div>

          {/* Right — generated email */}
          <div>
            <div className="bg-[#111] border border-gray-800 rounded-2xl overflow-hidden h-full flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <h3 className="font-semibold text-sm">Generated Email</h3>
                {email && (
                  <button
                    onClick={copy}
                    className={`text-xs px-3 py-1.5 rounded-lg transition font-medium ${
                      copied
                        ? "bg-green-600/20 text-green-400 border border-green-500/30"
                        : "bg-gray-800 hover:bg-gray-700 text-gray-300"
                    }`}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">Crafting your email...</p>
                  </div>
                </div>
              ) : email ? (
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full h-full min-h-96 bg-transparent px-5 py-4 text-sm text-gray-300 leading-relaxed focus:outline-none resize-none font-mono"
                    spellCheck={false}
                  />
                  <p className="absolute bottom-3 right-4 text-xs text-gray-700">editable</p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center">
                    <p className="text-4xl mb-4">✉</p>
                    <p className="text-gray-500 text-sm">Your personalised email will appear here</p>
                    <p className="text-gray-700 text-xs mt-2">Enter a company and role, then click Generate</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-8 bg-[#111] border border-gray-800 rounded-2xl p-6">
          <h3 className="font-semibold text-sm mb-4 text-gray-300">Tips for effective cold emails</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-500">
            <div><span className="text-gray-300 font-medium block mb-1">Find the right person</span>Search LinkedIn for the hiring manager or engineering lead at {company || "your target company"} — not just HR.</div>
            <div><span className="text-gray-300 font-medium block mb-1">Personalise the subject</span>Use their name and a specific project or blog post from the company to stand out from generic applications.</div>
            <div><span className="text-gray-300 font-medium block mb-1">Follow up once</span>Wait 5-7 days with no response, then send one polite follow-up. More than that hurts your chances.</div>
          </div>
        </div>
      </div>
    </main>
  );
}
