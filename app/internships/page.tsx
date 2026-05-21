"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";

type Profile = {
  college: string;
  collegeTier: string;
  branch: string;
  year: string;
  cgpa: number;
  skills: string[];
  targetRole: string;
};

type Internship = {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salary: string;
  redirect_url: string;
  created: string;
  days_ago: number | null;
  hiring_status: string | null;
  match_score: number;
};

type Platform = {
  platform: string;
  url: string;
  why: string;
  how_to_use: string;
};

type InternshipType = {
  type: string;
  difficulty: string;
  timeline: string;
  why_good_for_them: string;
};

type VirtualProgram = {
  name: string;
  company: string;
  url: string;
  eligibility: string;
  deadline: string;
  stipend: string;
  difficulty: string;
};

type AIStrategy = {
  best_platforms: Platform[];
  recommended_internship_types: InternshipType[];
  virtual_internship_programs: VirtualProgram[];
  action_plan: string[];
  verdict: string;
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
  { label: "Cold Email", path: "/coldemail" },
  { label: "Directory", path: "/company-directory" },
  { label: "LinkedIn", path: "/linkedin" },
  { label: "PYQ", path: "/pyq" },
  { label: "Internships", path: "/internships", active: true },
  { label: "Referral Radar", path: "/referral" },
];

const STATIC_PROGRAMS: (VirtualProgram & { category: string })[] = [
  {
    name: "Google STEP",
    company: "Google",
    url: "https://buildyourfuture.withgoogle.com/programs/step",
    eligibility: "1st/2nd year undergrads",
    deadline: "October–December",
    stipend: "~₹80,000/month",
    difficulty: "Hard",
    category: "Big Tech",
  },
  {
    name: "Microsoft Engage",
    company: "Microsoft",
    url: "https://careers.microsoft.com/students/",
    eligibility: "2nd/3rd year undergrads",
    deadline: "January–March",
    stipend: "~₹75,000/month",
    difficulty: "Hard",
    category: "Big Tech",
  },
  {
    name: "Goldman Sachs Insight",
    company: "Goldman Sachs",
    url: "https://www.goldmansachs.com/careers/students/programs/india/",
    eligibility: "2nd/3rd year undergrads",
    deadline: "September–November",
    stipend: "~₹60,000/month",
    difficulty: "Hard",
    category: "Finance",
  },
  {
    name: "Morgan Stanley Early Insights",
    company: "Morgan Stanley",
    url: "https://www.morganstanley.com/people/early-careers/",
    eligibility: "1st/2nd year undergrads",
    deadline: "October–December",
    stipend: "~₹55,000/month",
    difficulty: "Medium",
    category: "Finance",
  },
  {
    name: "JP Morgan Code for Good",
    company: "JP Morgan",
    url: "https://careers.jpmorgan.com/global/en/students/programs/code-for-good",
    eligibility: "Final year students",
    deadline: "January–March",
    stipend: "₹50,000–60,000/month",
    difficulty: "Medium",
    category: "Finance",
  },
  {
    name: "Uber STARs",
    company: "Uber",
    url: "https://www.uber.com/in/en/about/careers/",
    eligibility: "2nd/3rd year undergrads",
    deadline: "September–November",
    stipend: "~₹70,000/month",
    difficulty: "Hard",
    category: "Big Tech",
  },
  {
    name: "Walmart CodeHers",
    company: "Walmart",
    url: "https://careers.walmart.com/results?q=intern&sort=rank&jobState=ALL&facility=ALL&department=ALL&jobType=ALL&offset=0",
    eligibility: "Women in 2nd/3rd year",
    deadline: "October–December",
    stipend: "~₹50,000/month",
    difficulty: "Medium",
    category: "Big Tech",
  },
  {
    name: "Flipkart Grid",
    company: "Flipkart",
    url: "https://dare2compete.com/o/Flipkart-GRiD-60-Software-Development-Track-Flipkart-183877",
    eligibility: "All years, team-based",
    deadline: "June–August",
    stipend: "Competition + internship offer",
    difficulty: "Medium",
    category: "Indian Tech",
  },
  {
    name: "Amazon ML Summer School",
    company: "Amazon",
    url: "https://www.amazon.science/ml-summer-school",
    eligibility: "2nd/3rd year with ML interest",
    deadline: "April–May",
    stipend: "Unpaid (learning program)",
    difficulty: "Medium",
    category: "Big Tech",
  },
  {
    name: "Cisco ThingQbator",
    company: "Cisco",
    url: "https://thingqbator.nasscomfoundation.org/",
    eligibility: "All undergrads with IoT projects",
    deadline: "Rolling",
    stipend: "Project funding + mentorship",
    difficulty: "Easy",
    category: "Indian Tech",
  },
  {
    name: "Myntra HackerRamp",
    company: "Myntra",
    url: "https://dare2compete.com/o/Myntra-HackerRamp-WE-FOR-SHE-2024-Myntra-187002",
    eligibility: "Women in tech, all years",
    deadline: "March–May",
    stipend: "Cash prizes + internship offer",
    difficulty: "Medium",
    category: "Indian Tech",
  },
  {
    name: "Samsung PRISM",
    company: "Samsung",
    url: "https://www.samsung.com/in/aboutsamsung/samsungdesign/internship/",
    eligibility: "3rd/4th year with research interest",
    deadline: "July–September",
    stipend: "~₹15,000/month",
    difficulty: "Easy",
    category: "Hardware",
  },
  {
    name: "Qualcomm Innovation Fellowship",
    company: "Qualcomm",
    url: "https://www.qualcomm.com/research/university-relations/innovation-fellowship/india",
    eligibility: "PhD/Masters students",
    deadline: "December–February",
    stipend: "$100,000 grant",
    difficulty: "Hard",
    category: "Hardware",
  },
  {
    name: "ISRO Internship",
    company: "ISRO",
    url: "https://www.isro.gov.in/Internship.html",
    eligibility: "3rd/4th year with CGPA ≥ 7.5",
    deadline: "Rolling (apply 2 months ahead)",
    stipend: "~₹5,000–8,000/month",
    difficulty: "Medium",
    category: "Government / Research",
  },
  {
    name: "DRDO Internship",
    company: "DRDO",
    url: "https://www.drdo.gov.in/drdo/Hindi/internship.jsp",
    eligibility: "3rd/4th year engineering students",
    deadline: "Rolling",
    stipend: "~₹5,000/month",
    difficulty: "Easy",
    category: "Government / Research",
  },
  {
    name: "IIT SURGE (Kanpur)",
    company: "IIT Kanpur",
    url: "https://surge.iitk.ac.in/",
    eligibility: "Non-IIT undergrads, CGPA ≥ 8.0",
    deadline: "December–February",
    stipend: "~₹10,000/month + accommodation",
    difficulty: "Hard",
    category: "Government / Research",
  },
  {
    name: "IIT SURA (Bombay)",
    company: "IIT Bombay",
    url: "https://www.iitb.ac.in/en/education/undergraduate-research",
    eligibility: "Non-IIT undergrads, CGPA ≥ 8.5",
    deadline: "January–March",
    stipend: "~₹10,000/month",
    difficulty: "Hard",
    category: "Government / Research",
  },
  {
    name: "IUAC Research Internship",
    company: "Inter University Accelerator Centre",
    url: "https://www.iuac.res.in/",
    eligibility: "Physics/Electronics students, 3rd year+",
    deadline: "March–May",
    stipend: "~₹5,000/month",
    difficulty: "Medium",
    category: "Government / Research",
  },
];

function matchColor(score: number) {
  if (score >= 60) return "bg-green-500";
  if (score >= 30) return "bg-yellow-500";
  return "bg-red-500";
}

function matchTextColor(score: number) {
  if (score >= 60) return "text-green-400";
  if (score >= 30) return "text-yellow-400";
  return "text-red-400";
}

function hiringBadge(status: string | null) {
  if (!status) return null;
  const styles: Record<string, string> = {
    "Actively Hiring": "bg-green-500/15 text-green-400 border-green-500/30",
    "Recently Posted": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "May Be Closed": "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[status] ?? "bg-gray-700/50 text-gray-400 border-gray-600"}`}>
      {status}
    </span>
  );
}

function difficultyBadge(difficulty: string) {
  const styles: Record<string, string> = {
    Easy: "bg-green-500/15 text-green-400 border-green-500/30",
    Medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    Hard: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const key = difficulty.replace(" to get", "");
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[key] ?? "bg-gray-700/50 text-gray-400 border-gray-600"}`}>
      {difficulty}
    </span>
  );
}

export default function Internships() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<"listings" | "strategy" | "programs">("listings");

  // Listings state
  const [internships, setInternships] = useState<Internship[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError, setListingsError] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterStipend, setFilterStipend] = useState<"Any" | "Paid" | "Unpaid">("Any");
  const [filterPosted, setFilterPosted] = useState<"Any" | "7" | "30">("Any");

  // AI strategy state
  const [strategy, setStrategy] = useState<AIStrategy | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyError, setStrategyError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("placeiq_profile");
      if (raw) setProfile(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    if (!profile) return;
    fetchListings();
    fetchStrategy();
  }, [profile]);

  async function fetchListings() {
    setListingsLoading(true);
    setListingsError("");
    try {
      const skillsParam = (profile?.skills || []).join(",");
      const res = await fetch(`http://localhost:8000/api/internships/list?skills=${encodeURIComponent(skillsParam)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInternships(data.internships || []);
    } catch (e: unknown) {
      setListingsError(e instanceof Error ? e.message : "Failed to load internships");
    } finally {
      setListingsLoading(false);
    }
  }

  async function fetchStrategy() {
    const cached = localStorage.getItem("placeiq_internship_strategy");
    if (cached) {
      try {
        setStrategy(JSON.parse(cached));
        return;
      } catch {}
    }
    if (!profile) return;
    setStrategyLoading(true);
    setStrategyError("");
    try {
      const res = await fetch("http://localhost:8000/api/internships/ai-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          college: profile.college,
          college_tier: profile.collegeTier || "Tier 2",
          branch: profile.branch,
          year: profile.year,
          cgpa: profile.cgpa,
          skills: profile.skills || [],
          target_role: profile.targetRole,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: AIStrategy = await res.json();
      setStrategy(data);
      localStorage.setItem("placeiq_internship_strategy", JSON.stringify(data));
    } catch (e: unknown) {
      setStrategyError(e instanceof Error ? e.message : "Failed to generate strategy");
    } finally {
      setStrategyLoading(false);
    }
  }

  const filteredInternships = useMemo(() => {
    return internships.filter(j => {
      if (filterRole && !j.title.toLowerCase().includes(filterRole.toLowerCase())) return false;
      if (filterLocation && !j.location.toLowerCase().includes(filterLocation.toLowerCase())) return false;
      if (filterStipend === "Paid" && !j.salary) return false;
      if (filterStipend === "Unpaid" && j.salary) return false;
      if (filterPosted === "7" && (j.days_ago === null || j.days_ago > 7)) return false;
      if (filterPosted === "30" && (j.days_ago === null || j.days_ago > 30)) return false;
      return true;
    });
  }, [internships, filterRole, filterLocation, filterStipend, filterPosted]);

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
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-sm text-gray-500 hover:text-white transition">
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-1">Internships</h2>
        <p className="text-gray-400 mb-8">
          Live listings · AI strategy · Major programs — all in one place
          {profile?.skills?.length ? ` · Matched against ${profile.skills.length} skills` : ""}
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-gray-800 pb-0">
          {(["listings", "strategy", "programs"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition border-b-2 -mb-px ${
                tab === t
                  ? "border-blue-500 text-white"
                  : "border-transparent text-gray-400 hover:text-white"
              }`}
            >
              {t === "listings" ? "Live Listings" : t === "strategy" ? "AI Strategy" : "Programs"}
            </button>
          ))}
        </div>

        {/* ── Live Listings Tab ─────────────────────────────────────────────── */}
        {tab === "listings" && (
          <div>
            {/* Filter bar */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Role</label>
                  <input
                    value={filterRole}
                    onChange={e => setFilterRole(e.target.value)}
                    placeholder="e.g. Software, Data"
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Location</label>
                  <input
                    value={filterLocation}
                    onChange={e => setFilterLocation(e.target.value)}
                    placeholder="e.g. Bangalore, Remote"
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Stipend</label>
                  <select
                    value={filterStipend}
                    onChange={e => setFilterStipend(e.target.value as "Any" | "Paid" | "Unpaid")}
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                  >
                    <option value="Any">Any</option>
                    <option value="Paid">Paid only</option>
                    <option value="Unpaid">Unpaid only</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Posted</label>
                  <select
                    value={filterPosted}
                    onChange={e => setFilterPosted(e.target.value as "Any" | "7" | "30")}
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                  >
                    <option value="Any">Any time</option>
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                  </select>
                </div>
              </div>
            </div>

            {listingsLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-400 text-sm">Fetching live internship listings from Adzuna India...</p>
              </div>
            )}

            {listingsError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-6">
                {listingsError}
              </div>
            )}

            {!listingsLoading && !listingsError && (
              <>
                <p className="text-gray-400 text-sm mb-4">
                  {filteredInternships.length} internship{filteredInternships.length !== 1 ? "s" : ""} found
                  {internships.length !== filteredInternships.length ? ` (filtered from ${internships.length})` : ""}
                </p>
                <div className="grid gap-4">
                  {filteredInternships.map(job => (
                    <div key={job.id || job.redirect_url} className="bg-[#111] border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-white truncate">{job.title}</h3>
                          <p className="text-gray-400 text-sm mt-0.5">{job.company} · {job.location}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {hiringBadge(job.hiring_status)}
                          {job.days_ago !== null && (
                            <span className="text-xs text-gray-500">
                              {job.days_ago === 0 ? "Today" : job.days_ago === 1 ? "Yesterday" : `${job.days_ago}d ago`}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mb-3">
                        <span className="text-sm text-blue-400 font-medium">
                          {job.salary || "Stipend not mentioned"}
                        </span>
                      </div>

                      {job.description && (
                        <p className="text-gray-500 text-xs mb-3 line-clamp-2">{job.description}</p>
                      )}

                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`text-xs font-medium ${matchTextColor(job.match_score)}`}>
                            {job.match_score}% match
                          </span>
                          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${matchColor(job.match_score)}`}
                              style={{ width: `${job.match_score}%` }}
                            />
                          </div>
                        </div>
                        {job.redirect_url && (
                          <a
                            href={job.redirect_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-400 hover:text-blue-300 font-medium transition shrink-0"
                          >
                            Apply →
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredInternships.length === 0 && !listingsLoading && (
                    <div className="text-center py-16 text-gray-500">
                      No internships match your filters. Try broadening your search.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── AI Strategy Tab ───────────────────────────────────────────────── */}
        {tab === "strategy" && (
          <div>
            {strategyLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-400 text-sm">Building your internship strategy...</p>
              </div>
            )}

            {strategyError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-6 flex items-center justify-between">
                <span>{strategyError}</span>
                <button
                  onClick={fetchStrategy}
                  className="text-blue-400 hover:text-blue-300 text-sm ml-4"
                >
                  Retry
                </button>
              </div>
            )}

            {!strategyLoading && strategy && (
              <div className="space-y-8">
                {/* Best Platforms */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Best Platforms for You</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {strategy.best_platforms?.map((p, i) => (
                      <div key={i} className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-blue-400">{p.platform}</h4>
                          {p.url && (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-gray-500 hover:text-gray-300 transition"
                            >
                              Visit →
                            </a>
                          )}
                        </div>
                        <p className="text-gray-300 text-sm mb-2">{p.why}</p>
                        <p className="text-gray-500 text-xs border-t border-gray-800 pt-2 mt-2">
                          <span className="text-gray-400 font-medium">Tip: </span>{p.how_to_use}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommended Internship Types */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Recommended Internship Types</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {strategy.recommended_internship_types?.map((t, i) => (
                      <div key={i} className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-white">{t.type}</h4>
                          {difficultyBadge(t.difficulty)}
                        </div>
                        <p className="text-gray-400 text-xs mb-2">
                          <span className="text-gray-300">Timeline: </span>{t.timeline}
                        </p>
                        <p className="text-gray-400 text-sm">{t.why_good_for_them}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Plan */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">60-Day Action Plan</h3>
                  <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
                    <ol className="space-y-3">
                      {strategy.action_plan?.map((step, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-gray-300">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Verdict */}
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5">
                  <h3 className="text-sm font-semibold text-yellow-400 mb-2">Honest Verdict</h3>
                  <p className="text-gray-300 text-sm leading-relaxed">{strategy.verdict}</p>
                </div>

                <button
                  onClick={() => {
                    localStorage.removeItem("placeiq_internship_strategy");
                    setStrategy(null);
                    fetchStrategy();
                  }}
                  className="text-xs text-gray-600 hover:text-gray-400 transition"
                >
                  Regenerate strategy
                </button>
              </div>
            )}

            {!strategyLoading && !strategy && !strategyError && (
              <div className="text-center py-20">
                <p className="text-gray-500 mb-4">Complete your profile to get a personalized internship strategy.</p>
                <button
                  onClick={() => router.push("/onboarding")}
                  className="text-sm text-blue-400 hover:text-blue-300 transition"
                >
                  Set up profile →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Programs Tab ──────────────────────────────────────────────────── */}
        {tab === "programs" && (
          <div>
            <p className="text-gray-400 text-sm mb-6">
              Major virtual internship programs and structured initiatives for Indian engineering students.
            </p>
            {["Big Tech", "Finance", "Indian Tech", "Hardware", "Government / Research"].map(category => {
              const programs = STATIC_PROGRAMS.filter(p => p.category === category);
              return (
                <div key={category} className="mb-8">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">{category}</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {programs.map(prog => (
                      <div key={prog.name} className="bg-[#111] border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-semibold text-white">{prog.name}</h4>
                            <p className="text-gray-500 text-xs mt-0.5">{prog.company}</p>
                          </div>
                          {difficultyBadge(prog.difficulty)}
                        </div>
                        <div className="space-y-1.5 mb-4">
                          <p className="text-xs text-gray-400">
                            <span className="text-gray-500">Eligibility: </span>{prog.eligibility}
                          </p>
                          <p className="text-xs text-gray-400">
                            <span className="text-gray-500">Deadline: </span>{prog.deadline}
                          </p>
                          <p className="text-xs text-blue-400 font-medium">
                            {prog.stipend}
                          </p>
                        </div>
                        <a
                          href={prog.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg px-3 py-1.5 transition font-medium"
                        >
                          Apply →
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
