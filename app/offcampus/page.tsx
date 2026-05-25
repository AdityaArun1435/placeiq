"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

type Profile = {
  targetRole: string;
  skills: string[];
  college: string;
};

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salary: string;
  match_score: number;
  apply_link: string;
  created: string;
  hiring_status: string | null;
  days_ago: number | null;
  source?: string;
};

const TIER1_NAMES = new Set([
  "google", "amazon", "microsoft", "meta", "apple", "netflix", "uber", "airbnb",
  "stripe", "atlassian", "salesforce", "adobe", "oracle", "sap", "intel", "qualcomm", "nvidia",
  "flipkart", "swiggy", "zomato", "phonepe", "razorpay", "cred", "meesho", "zepto", "ola",
  "paytm", "groww", "zerodha", "dream11", "freshworks", "zoho", "postman",
  "tcs", "infosys", "wipro", "hcl", "tech mahindra", "cognizant", "capgemini", "accenture", "ibm", "deloitte",
]);

function isTier1(company: string) { return TIER1_NAMES.has(company.toLowerCase().trim()); }

function matchColor(score: number) {
  if (score >= 60) return "bg-green-500";
  if (score >= 30) return "bg-yellow-500";
  return "bg-red-500";
}

function matchLabel(score: number) {
  if (score >= 60) return "Strong Match";
  if (score >= 30) return "Partial Match";
  return "Low Match";
}

function matchTextColor(score: number) {
  if (score >= 60) return "text-green-400";
  if (score >= 30) return "text-yellow-400";
  return "text-red-400";
}

function timeAgo(created: string): string {
  if (!created) return "";
  try {
    const d = new Date(created);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  } catch { return ""; }
}

export default function OffCampus() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [minSalary, setMinSalary] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

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

  async function search() {
    if (!role.trim()) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const res = await fetch(`${config.apiUrl}/api/offcampus/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_role: role.trim(),
          skills: profile?.skills || [],
          location: remoteOnly ? "remote" : location.trim() || "",
          remote_only: remoteOnly,
          page: 1,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      let list: Job[] = data.jobs || [];
      if (minSalary) {
        const min = parseFloat(minSalary);
        list = list.filter(j => {
          const m = j.salary.match(/[\d.]+/);
          return m ? parseFloat(m[0]) >= min : true;
        });
      }
      setJobs(list);
      setTotal(data.total || list.length);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-5xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">Off Campus Jobs</h2>
        <p className="text-gray-400 mb-8">
          Live jobs from Adzuna · Arbeitnow · Remotive · Tier 1 companies sorted first · match score based on your skill profile
          {profile?.skills?.length ? ` (${profile.skills.length} skills)` : ""}
        </p>

        {/* Search form */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Job Title / Role</label>
              <input
                value={role}
                onChange={e => setRole(e.target.value)}
                onKeyDown={e => e.key === "Enter" && search()}
                placeholder="e.g. Software Engineer, Data Scientist"
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Location</label>
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                onKeyDown={e => e.key === "Enter" && search()}
                placeholder="e.g. Bangalore, Mumbai, Hyderabad"
                disabled={remoteOnly}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition disabled:opacity-40"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Min Salary (LPA)</label>
              <input
                type="number"
                value={minSalary}
                onChange={e => setMinSalary(e.target.value)}
                placeholder="e.g. 5"
                min="0"
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setRemoteOnly(r => !r)}
                className={`w-9 h-5 rounded-full relative transition-colors ${remoteOnly ? "bg-blue-600" : "bg-gray-700"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${remoteOnly ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-gray-400">Remote only</span>
            </label>
            <button
              onClick={search}
              disabled={loading || !role.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-8 py-2.5 rounded-lg text-sm font-medium transition"
            >
              {loading ? "Searching..." : "Search Jobs →"}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">{error}</div>
        )}

        {loading && (
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-[#111] border border-gray-800 rounded-2xl p-6 animate-pulse">
                <div className="flex justify-between mb-3">
                  <div className="h-5 w-48 bg-gray-800 rounded" />
                  <div className="h-5 w-20 bg-gray-800 rounded" />
                </div>
                <div className="h-3 w-32 bg-gray-800 rounded mb-4" />
                <div className="h-2 w-full bg-gray-800 rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && searched && jobs.length === 0 && !error && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-12 text-center">
            <p className="text-gray-400 text-lg font-medium mb-2">No jobs found</p>
            <p className="text-gray-600 text-sm">Try a different role or location — Adzuna may have limited listings for this query.</p>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Showing <span className="text-white">{jobs.length}</span> results · Tier 1 companies first, then by recency
            </p>
            <div className="space-y-4">
              {jobs.map(job => (
                <div key={job.id} className={`bg-[#111] border rounded-2xl p-6 hover:border-gray-700 transition ${isTier1(job.company) ? "border-blue-800/50" : "border-gray-800"}`}>
                  <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white">{job.title}</h3>
                        {isTier1(job.company) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 font-medium">Tier 1</span>
                        )}
                        {job.source && job.source !== "Adzuna" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">{job.source}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-400 flex-wrap">
                        <span>{job.company}</span>
                        <span className="text-gray-700">·</span>
                        <span>{job.location}</span>
                        {job.salary && (
                          <>
                            <span className="text-gray-700">·</span>
                            <span className="text-green-400">{job.salary}</span>
                          </>
                        )}
                        {job.created && (
                          <>
                            <span className="text-gray-700">·</span>
                            <span className="text-gray-600">{timeAgo(job.created)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-2">
                      {job.hiring_status && (
                        <div>
                          <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                            job.hiring_status === "Actively Hiring"
                              ? "bg-green-900/30 text-green-400 border-green-700/40"
                              : job.hiring_status === "Recently Posted"
                              ? "bg-yellow-900/30 text-yellow-400 border-yellow-700/40"
                              : "bg-gray-800 text-gray-500 border-gray-700"
                          }`}>
                            {job.hiring_status}
                          </span>
                        </div>
                      )}
                      <p className={`text-xs font-medium ${matchTextColor(job.match_score)}`}>{matchLabel(job.match_score)}</p>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${matchColor(job.match_score)}`} style={{ width: `${job.match_score}%` }} />
                        </div>
                        <span className="text-sm font-bold text-white">{job.match_score}%</span>
                      </div>
                    </div>
                  </div>

                  {job.description && (
                    <p className="text-xs text-gray-500 leading-relaxed mb-4 line-clamp-3">{job.description}</p>
                  )}

                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex gap-2 flex-wrap">
                      {(profile?.skills || []).slice(0, 5).map(skill => (
                        <span
                          key={skill}
                          className={`text-xs px-2 py-0.5 rounded-full border ${
                            job.description?.toLowerCase().includes(skill.toLowerCase())
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : "bg-gray-800 text-gray-600 border-gray-700"
                          }`}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                    {job.apply_link && (
                      <a
                        href={job.apply_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-2 rounded-lg transition font-medium"
                      >
                        Apply Now →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!searched && !loading && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-12 text-center">
            <p className="text-2xl mb-3">🔍</p>
            <p className="text-gray-400 mb-2">Search for off-campus jobs</p>
            <p className="text-gray-600 text-sm">Your skill match score is calculated from the {profile?.skills?.length || 0} skills in your profile.</p>
          </div>
        )}
      </div>
    </main>
  );
}
