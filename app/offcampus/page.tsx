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
  known?: boolean;
  international?: boolean;
  quality_score?: number;
};

function stripHtml(html: string): string {
  if (!html) return "";
  let text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<\/li>/gi, " ")
    .replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, " ").trim();
}

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

function sourceBadgeStyle(source: string) {
  if (source === "Remotive")   return "bg-green-500/10 text-green-400 border-green-500/20";
  if (source === "Arbeitnow")  return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  if (source === "The Muse")   return "bg-pink-500/10 text-pink-400 border-pink-500/20";
  if (source === "Jobicy")     return "bg-teal-500/10 text-teal-400 border-teal-500/20";
  return "bg-blue-500/10 text-blue-400 border-blue-500/20"; // Adzuna
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

function computeRelevanceScore(job: Job, profile: Profile, minSalaryVal: number): number {
  let score = 0;
  const title = (job.title || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const role = (profile.targetRole || "").toLowerCase();

  if (role && title.includes(role)) score += 3;

  const topSkills = (profile.skills || []).slice(0, 5);
  for (const skill of topSkills) {
    if (desc.includes(skill.toLowerCase()) || title.includes(skill.toLowerCase())) score += 1;
  }

  if (job.known) score += 2;

  if (minSalaryVal > 0) {
    const match = job.salary.match(/[\d.]+/);
    if (match && parseFloat(match[0]) >= minSalaryVal) score += 1;
  } else if (job.salary) {
    score += 1;
  }

  return score;
}

export default function OffCampus() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [minSalary, setMinSalary] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [bySource, setBySource] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set());
  const [showUnverified, setShowUnverified] = useState(false);

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

  function toggleDesc(id: string) {
    setExpandedDescs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function search() {
    if (!role.trim()) return;
    setLoading(true);
    setError("");
    setSearched(true);
    setExpandedDescs(new Set());
    setShowUnverified(false);
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
      setVerifiedCount(data.verified_count || 0);
      setBySource(data.by_source || {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") return <LoadingScreen />;

  const minSalaryVal = minSalary ? parseFloat(minSalary) : 0;
  const scoredJobs = profile
    ? jobs.map(j => ({ ...j, relevanceScore: computeRelevanceScore(j, profile, minSalaryVal) }))
    : jobs.map(j => ({ ...j, relevanceScore: j.match_score > 0 ? 1 : 0 }));

  const filtered = verifiedOnly ? scoredJobs.filter(j => j.known) : scoredJobs;
  const highScore = filtered.filter(j => (j.quality_score ?? 0) >= 3);
  const lowScore = filtered.filter(j => (j.quality_score ?? 0) < 3);

  function renderJobCard(job: typeof scoredJobs[0]) {
    const cleanDesc = stripHtml(job.description || "");
    const isExpanded = expandedDescs.has(job.id);
    const showDescToggle = cleanDesc.length > 180;

    return (
      <div key={job.id} className={`bg-[#111] border rounded-2xl p-6 hover:border-gray-700 transition ${job.known ? "border-blue-800/50" : "border-gray-800"}`}>
        <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-white">{job.title}</h3>
              {job.known && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30 font-medium">✓ Verified</span>
              )}
              {job.international && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 font-medium">International</span>
              )}
              {job.source && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${sourceBadgeStyle(job.source)}`}>{job.source}</span>
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

        <div className="mb-4">
          {!cleanDesc || cleanDesc.length < 20 ? (
            <p className="text-xs text-gray-600 italic">No description available</p>
          ) : (
            <>
              <p className={`text-xs text-gray-500 leading-relaxed ${!isExpanded ? "line-clamp-3" : ""}`}>{cleanDesc}</p>
              {showDescToggle && (
                <button onClick={() => toggleDesc(job.id)} className="text-xs text-blue-500 hover:text-blue-400 mt-1 transition">
                  {isExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            {(profile?.skills || []).slice(0, 5).map(skill => (
              <span
                key={skill}
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  (job.description || "").toLowerCase().includes(skill.toLowerCase())
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
    );
  }

  const sourceNames = Object.keys(bySource);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-5xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">Off Campus Jobs</h2>
        <p className="text-gray-400 mb-8">
          Live jobs from Adzuna · Remotive · Arbeitnow · The Muse · Jobicy — sorted by company quality & relevance
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
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setRemoteOnly(r => !r)}
                  className={`w-9 h-5 rounded-full relative transition-colors ${remoteOnly ? "bg-blue-600" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${remoteOnly ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm text-gray-400">Remote only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setVerifiedOnly(v => !v)}
                  className={`w-9 h-5 rounded-full relative transition-colors ${verifiedOnly ? "bg-green-600" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${verifiedOnly ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm text-gray-400">Verified companies only</span>
              </label>
            </div>
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
            <p className="text-gray-600 text-sm">Try a different role or location.</p>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <>
            {/* Stats bar */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <p className="text-sm text-gray-400">
                <span className="text-white font-semibold">{filtered.length}</span> jobs found
                {verifiedCount > 0 && (
                  <> · <span className="text-green-400 font-medium">{verifiedCount} from verified companies</span></>
                )}
              </p>
              {sourceNames.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {sourceNames.map(src => (
                    <span key={src} className={`text-[10px] px-2 py-0.5 rounded border font-medium ${sourceBadgeStyle(src)}`}>
                      {src}: {bySource[src]}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {highScore.map(job => renderJobCard(job))}
            </div>

            {lowScore.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setShowUnverified(v => !v)}
                  className="w-full text-sm text-gray-600 hover:text-gray-400 border border-gray-800 hover:border-gray-700 py-3 rounded-xl transition"
                >
                  {showUnverified ? "Hide" : `${lowScore.length} more listings (unverified / low-score) — click to expand`}
                </button>
                {showUnverified && (
                  <div className="space-y-4 mt-4">
                    {lowScore.map(job => renderJobCard(job))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!searched && !loading && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-12 text-center">
            <p className="text-2xl mb-3">🔍</p>
            <p className="text-gray-400 mb-2">Search for off-campus jobs</p>
            <p className="text-gray-600 text-sm">Results from Adzuna, Remotive, Arbeitnow, The Muse & Jobicy — sorted by company quality and relevance to your profile.</p>
          </div>
        )}
      </div>
    </main>
  );
}
