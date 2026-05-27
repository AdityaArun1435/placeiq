"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

type Profile = {
  college: string;
  skills: string[];
  targetRole: string;
  projectsCount: string;
  hasInternship: string;
  internshipMonths: string;
  collegeTier: string;
};

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
      const res = await fetch(`${config.apiUrl}/api/coldemail/generate`, {
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

  if (status === "loading") return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-primary-bg text-main">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">Cold Email Generator</h2>
        <p className="text-muted mb-8">Generate a personalised cold email to reach recruiters at any company</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left — inputs */}
          <div className="space-y-6">
            <div className="bg-surface border border-theme rounded-2xl p-6">
              <h3 className="font-semibold mb-4 text-sm text-muted uppercase tracking-wider">Target</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Company Name *</label>
                  <input
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="e.g. Razorpay, Zepto, Microsoft"
                    className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2.5 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Role / Position *</label>
                  <input
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    placeholder="e.g. SDE-1, Data Analyst, Product Manager"
                    className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2.5 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
              </div>
            </div>

            {/* Profile preview */}
            <div className="bg-surface border border-theme rounded-2xl p-6">
              <h3 className="font-semibold mb-4 text-sm text-muted uppercase tracking-wider">Using Your Profile</h3>
              {profile ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between">
                    <span className="text-faint">Name</span>
                    <span className="text-muted">{session?.user?.name || "—"}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-faint">College</span>
                    <span className="text-muted text-right max-w-[60%] truncate">{profile.college}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-faint">Projects</span>
                    <span className="text-muted">{profile.projectsCount}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-faint">Internship</span>
                    <span className="text-muted">
                      {profile.hasInternship === "yes" ? `Yes (${profile.internshipMonths} mo)` : "No"}
                    </span>
                  </div>
                  <div>
                    <p className="text-faint mb-2">Top Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(Array.isArray(profile.skills) ? profile.skills : []).slice(0, 6).map(s => (
                        <span key={s} className="bg-blue-600/10 border border-blue-500/20 text-blue-400 text-xs px-2 py-0.5 rounded-full">{s}</span>
                      ))}
                      {(profile?.skills?.length ?? 0) > 6 && (
                        <span className="text-faint text-xs px-2 py-0.5">+{(profile.skills?.length ?? 0) - 6} more</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-faint text-sm mb-3">No profile found — the email will be generic.</p>
                  <button onClick={() => router.push("/onboarding")} className="text-blue-400 hover:text-blue-300 text-sm transition">
                    Complete profile for better emails →
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={generate}
              disabled={loading || !company.trim() || !role.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-main py-3 rounded-xl font-medium transition text-sm"
            >
              {loading ? "Generating..." : "Generate Cold Email →"}
            </button>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>
            )}
          </div>

          {/* Right — generated email */}
          <div>
            <div className="bg-surface border border-theme rounded-2xl overflow-hidden h-full flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-theme">
                <h3 className="font-semibold text-sm">Generated Email</h3>
                {email && (
                  <button
                    onClick={copy}
                    className={`text-xs px-3 py-1.5 rounded-lg transition font-medium ${
                      copied
                        ? "bg-green-600/20 text-green-400 border border-green-500/30"
                        : "bg-gray-800 hover:bg-gray-700 text-muted"
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
                    <p className="text-faint text-sm">Crafting your email...</p>
                  </div>
                </div>
              ) : email ? (
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full h-full min-h-96 bg-transparent px-5 py-4 text-sm text-muted leading-relaxed focus:outline-none resize-none font-mono"
                    spellCheck={false}
                  />
                  <p className="absolute bottom-3 right-4 text-xs text-faint">editable</p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center">
                    <Mail size={36} className="mx-auto mb-4 text-faint" />
                    <p className="text-faint text-sm">Your personalised email will appear here</p>
                    <p className="text-faint text-xs mt-2">Enter a company and role, then click Generate</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-8 bg-surface border border-theme rounded-2xl p-6">
          <h3 className="font-semibold text-sm mb-4 text-muted">Tips for effective cold emails</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-faint">
            <div><span className="text-muted font-medium block mb-1">Find the right person</span>Search LinkedIn for the hiring manager or engineering lead at {company || "your target company"} — not just HR.</div>
            <div><span className="text-muted font-medium block mb-1">Personalise the subject</span>Use their name and a specific project or blog post from the company to stand out from generic applications.</div>
            <div><span className="text-muted font-medium block mb-1">Follow up once</span>Wait 5-7 days with no response, then send one polite follow-up. More than that hurts your chances.</div>
          </div>
        </div>
      </div>
    </main>
  );
}
