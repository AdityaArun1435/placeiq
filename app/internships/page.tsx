"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Check, Star } from "lucide-react";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

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

const KNOWN_COMPANIES = new Set([
  "google", "amazon", "microsoft", "meta", "apple", "uber", "airbnb", "stripe",
  "atlassian", "salesforce", "adobe", "oracle", "intel", "qualcomm", "nvidia",
  "flipkart", "swiggy", "zomato", "phonepe", "razorpay", "cred", "meesho", "zepto",
  "ola", "paytm", "groww", "zerodha", "dream11", "freshworks", "zoho", "postman",
  "tcs", "infosys", "wipro", "hcl", "cognizant", "capgemini", "accenture", "ibm", "deloitte",
  "samsung", "sony", "lg", "bosch", "siemens", "honeywell", "jp morgan", "goldman sachs",
  "morgan stanley", "barclays", "hsbc", "citi", "paypal", "shopify", "twilio",
  "ltimindtree", "tech mahindra", "persistent", "mphasis", "hexaware", "kyndryl",
  "dxc", "genpact", "isro", "drdo", "ongc", "iocl", "ntpc", "bhel", "hal",
  "ather energy", "ola electric", "cars24", "delhivery", "browserstack",
]);

const CS_KEYWORDS = [
  'software','developer','engineer','frontend','backend','fullstack','full stack',
  'react','node','python','java','javascript','typescript','data science','data analyst',
  'machine learning','ml','ai ','artificial intelligence','deep learning','nlp',
  'devops','cloud','aws','azure','gcp','android','ios','mobile','web','api','database',
  'cyber','security','embedded','computer science','information technology','coding',
  'programming','blockchain','gen ai','generative','llm','ux','ui/ux','qa','testing',
  'automation','robotics','iot',
];

function isTechInternship(title: string, description: string): boolean {
  const text = (title + ' ' + (description || '')).toLowerCase();
  return CS_KEYWORDS.some(kw => text.includes(kw));
}

function computeInternshipScore(job: { title: string; description: string; company: string; salary: string; location: string }, profile: { targetRole: string; branch: string; skills: string[] }): number {
  let score = 0;
  const title = (job.title || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const role = (profile.targetRole || "").toLowerCase();
  const branch = (profile.branch || "").toLowerCase().split(" ")[0];

  if (role && title.includes(role)) score += 3;
  else if (branch && title.includes(branch)) score += 3;

  const topSkills = (profile.skills || []).slice(0, 5);
  for (const skill of topSkills) {
    if (desc.includes(skill.toLowerCase()) || title.includes(skill.toLowerCase())) score += 1;
  }

  if (KNOWN_COMPANIES.has((job.company || "").toLowerCase().trim())) score += 2;

  if (job.salary && job.salary.length > 0) score += 1;

  const loc = (job.location || "").toLowerCase();
  if (loc.includes("remote") || loc.includes("hybrid")) score += 1;

  return score;
}

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
  source: "Adzuna" | "Remotive" | "Arbeitnow" | "AI Generated";
  tags?: string[];
  known?: boolean;
  paid?: boolean;
  quality_score?: number;
};

type SourceCounts = { Adzuna?: number; Remotive?: number; Arbeitnow?: number; "AI Generated"?: number; [key: string]: number | undefined };

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

type Startup = {
  name: string;
  industry: string;
  stage: string;
  why_good_fit: string;
  linkedin_url: string;
  careers_url: string | null;
  city: string;
  hiring_likelihood: "High" | "Medium" | "Low";
  how_to_apply: string;
};

type StartupsResult = {
  startups: Startup[];
  pro_tip: string;
};

type BrowseListing = {
  id?: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  redirect_url: string;
  days_ago: number | null;
  hiring_status: string | null;
  source: string;
};

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

function validateUrl(url: string | null | undefined, companyName: string): string {
  if (url && url.startsWith("https://")) return url;
  return `https://www.google.com/search?q=${encodeURIComponent(companyName)}+careers`;
}

function sourceBadge(source: string) {
  if (source === "Remotive")      return "bg-green-500/10 text-green-400 border-green-500/20";
  if (source === "Arbeitnow")     return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  if (source === "AI Generated")  return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  return "bg-blue-500/10 text-blue-400 border-blue-500/20";
}

function hiringBadge(status: string | null) {
  if (!status) return null;
  const styles: Record<string, string> = {
    "Actively Hiring": "bg-green-500/15 text-green-400 border-green-500/30",
    "Recently Posted": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "May Be Closed": "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[status] ?? "bg-gray-700/50 text-muted border-gray-600"}`}>
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
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${styles[key] ?? "bg-gray-700/50 text-muted border-gray-600"}`}>
      {difficulty}
    </span>
  );
}

export default function Internships() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<"listings" | "startups" | "strategy" | "programs">("listings");
  const [startupsTab, setStartupsTab] = useState<"ai_matched" | "browse">("ai_matched");

  // Listings state
  const [internships, setInternships] = useState<Internship[]>([]);
  const [sourceCounts, setSourceCounts] = useState<SourceCounts>({});
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError, setListingsError] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterStipend, setFilterStipend] = useState<"Any" | "Paid" | "Unpaid">("Any");
  const [filterPosted, setFilterPosted] = useState<"Any" | "7" | "30">("Any");
  const [filterVerifiedOnly, setFilterVerifiedOnly] = useState(false);
  const [filterRemoteOnly, setFilterRemoteOnly] = useState(false);

  // AI strategy state
  const [strategy, setStrategy] = useState<AIStrategy | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyError, setStrategyError] = useState("");

  // Startups — AI matched
  const [aiStartups, setAiStartups] = useState<StartupsResult | null>(null);
  const [aiStartupsLoading, setAiStartupsLoading] = useState(false);
  const [aiStartupsError, setAiStartupsError] = useState("");

  // Startups — Browse All
  const [browseListings, setBrowseListings] = useState<BrowseListing[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");
  const [browseSearch, setBrowseSearch] = useState("");
  const [browseIndustry, setBrowseIndustry] = useState("");
  const [browseCity, setBrowseCity] = useState("");

  // College placement sources for tier-based prioritisation
  const [collegeSources, setCollegeSources] = useState<{
    combined_placement_rate: number | null;
    sources_count: number;
    college_tier?: string;
  } | null>(null);

  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set());

  function toggleDesc(id: string) {
    setExpandedDescs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("placeiq_profile");
      if (raw) setProfile(JSON.parse(raw));
    } catch {}
    // Restore cached listings immediately so they show while re-fetching
    try {
      const cached = localStorage.getItem("placeiq_internships_cache");
      if (cached) {
        const { jobs, by_source } = JSON.parse(cached);
        if (jobs?.length) { setInternships(jobs); setSourceCounts(by_source || {}); }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!profile) return;
    fetchListings();
    fetchStrategy();
    if (profile.college) {
      fetch(`${config.apiUrl}/api/placement/sources?college=${encodeURIComponent(profile.college)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d) setCollegeSources({
            combined_placement_rate: d.combined_placement_rate,
            sources_count: d.num_sources,
            college_tier: d.nirf_stats?.college_tier,
          });
        })
        .catch(() => {});
    }
  }, [profile]);

  async function fetchListings() {
    setListingsLoading(true);
    setListingsError("");
    try {
      const skillsParam = (profile?.skills || []).join(",");
      const res = await fetch(`${config.apiUrl}/api/internships/list?skills=${encodeURIComponent(skillsParam)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const jobs = data.jobs || [];
      const by_source = data.by_source || {};
      setInternships(jobs);
      setSourceCounts(by_source);
      try { localStorage.setItem("placeiq_internships_cache", JSON.stringify({ jobs, by_source })); } catch {}
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
      const res = await fetch(`${config.apiUrl}/api/internships/ai-match`, {
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

  useEffect(() => {
    if (tab === "startups" && profile && !aiStartups && !aiStartupsLoading && !aiStartupsError) {
      fetchAiStartups();
    }
  }, [tab, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchAiStartups() {
    const cached = localStorage.getItem("placeiq_startups");
    if (cached) {
      try { setAiStartups(JSON.parse(cached)); return; } catch {}
    }
    if (!profile) return;
    setAiStartupsLoading(true);
    setAiStartupsError("");
    try {
      const res = await fetch(`${config.apiUrl}/api/startups/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: profile.skills || [],
          branch: profile.branch,
          target_role: profile.targetRole,
          college_tier: profile.collegeTier || "Tier 2",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: StartupsResult = await res.json();
      setAiStartups(data);
      localStorage.setItem("placeiq_startups", JSON.stringify(data));
    } catch (e: unknown) {
      setAiStartupsError(e instanceof Error ? e.message : "Failed to load AI matched startups");
    } finally {
      setAiStartupsLoading(false);
    }
  }

  async function fetchBrowseStartups(page = 1) {
    setBrowseLoading(true);
    setBrowseError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (browseSearch) params.set("search", browseSearch);
      if (browseIndustry) params.set("industry", browseIndustry);
      if (browseCity) params.set("city", browseCity);
      const res = await fetch(`${config.apiUrl}/api/startups/list?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (page === 1) {
        setBrowseListings(data.startups || []);
      } else {
        setBrowseListings(prev => [...prev, ...(data.startups || [])]);
      }
      setBrowseTotal(data.total_count || 0);
      setBrowsePage(page);
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : "Failed to load startup listings");
    } finally {
      setBrowseLoading(false);
    }
  }

  const filteredInternships = useMemo(() => {
    const filtered = internships.filter(j => {
      if (!isTechInternship(j.title, j.description || '')) return false;
      if (filterRole && !j.title.toLowerCase().includes(filterRole.toLowerCase())) return false;
      if (filterSearch) {
        const q = filterSearch.toLowerCase();
        if (!j.title.toLowerCase().includes(q) && !j.company.toLowerCase().includes(q)) return false;
      }
      if (filterLocation && !j.location.toLowerCase().includes(filterLocation.toLowerCase())) return false;
      if (filterRemoteOnly && !j.location.toLowerCase().includes("remote")) return false;
      if (filterStipend === "Paid" && !j.salary) return false;
      if (filterStipend === "Unpaid" && j.salary) return false;
      if (filterPosted === "7" && (j.days_ago === null || j.days_ago > 7)) return false;
      if (filterPosted === "30" && (j.days_ago === null || j.days_ago > 30)) return false;
      if (filterVerifiedOnly && !j.known && !KNOWN_COMPANIES.has((j.company || "").toLowerCase().trim())) return false;
      return true;
    });

    if (profile) {
      const scored = filtered.map(j => ({
        ...j,
        relevanceScore: computeInternshipScore(j, { targetRole: profile.targetRole, branch: profile.branch, skills: profile.skills }),
      }));
      scored.sort((a, b) => b.relevanceScore - a.relevanceScore || (a.days_ago ?? 999) - (b.days_ago ?? 999));
      return scored;
    }

    return filtered.map(j => ({ ...j, relevanceScore: 0 })).sort((a, b) => (a.days_ago ?? 999) - (b.days_ago ?? 999));
  }, [internships, filterRole, filterLocation, filterStipend, filterPosted, profile]);

  if (status === "loading") return <LoadingScreen />;

  return (
    <main className="min-h-screen bg-primary-bg text-main">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-1">Internships</h2>
        <p className="text-muted mb-8">
          Live listings · AI strategy · Major programs — all in one place
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-theme pb-0">
          {(["listings", "startups", "strategy", "programs"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition border-b-2 -mb-px ${
                tab === t
                  ? "border-blue-500 text-main"
                  : "border-transparent text-muted hover:text-main"
              }`}
            >
              {t === "listings" ? "Live Listings" : t === "startups" ? "Startups" : t === "strategy" ? "AI Strategy" : "Programs"}
            </button>
          ))}
        </div>

        {/* ── Live Listings Tab ─────────────────────────────────────────────── */}
        {tab === "listings" && (
          <div>
            {/* College tier insight banner */}
            {profile && (
              <div className="bg-surface border border-theme rounded-2xl px-5 py-3.5 mb-5 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm text-muted">
                    Showing listings prioritised for{" "}
                    <span className="text-blue-400 font-medium">{profile.collegeTier}</span>{" "}
                    colleges{profile.college ? ` · ${profile.college}` : ""}
                  </p>
                  {collegeSources && collegeSources.combined_placement_rate != null ? (
                    <p className="text-[11px] text-faint mt-0.5">
                      College placement rate: {collegeSources.combined_placement_rate}% across {collegeSources.sources_count} source{collegeSources.sources_count !== 1 ? "s" : ""} · 2024 · Companies known to hire from your tier are ranked higher
                    </p>
                  ) : (
                    <p className="text-[11px] text-faint mt-0.5">Companies known to hire from your tier are ranked higher</p>
                  )}
                </div>
                {collegeSources && collegeSources.combined_placement_rate != null && (
                  <span className="text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full shrink-0">
                    {collegeSources.combined_placement_rate}% placement rate
                  </span>
                )}
              </div>
            )}
            {/* Filter bar */}
            <div className="bg-surface border border-theme rounded-2xl p-5 mb-6">
              {/* Search bar */}
              <div className="mb-4">
                <label className="text-xs text-muted mb-1.5 block">Search by company or role</label>
                <input
                  value={filterSearch}
                  onChange={e => setFilterSearch(e.target.value)}
                  placeholder="e.g. Google, Software Engineer, React..."
                  className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              {/* Quick toggles */}
              <div className="flex flex-wrap gap-2 mb-4">
                {([
                  { label: "All", active: !filterVerifiedOnly && !filterRemoteOnly && filterStipend === "Any", onClick: () => { setFilterVerifiedOnly(false); setFilterRemoteOnly(false); setFilterStipend("Any"); } },
                  { label: "Verified Only", active: filterVerifiedOnly, onClick: () => setFilterVerifiedOnly(v => !v) },
                  { label: "Paid Only", active: filterStipend === "Paid", onClick: () => setFilterStipend(v => v === "Paid" ? "Any" : "Paid") },
                  { label: "Remote Only", active: filterRemoteOnly, onClick: () => setFilterRemoteOnly(v => !v) },
                ] as const).map(btn => (
                  <button
                    key={btn.label}
                    onClick={btn.onClick}
                    className={`px-3 py-1.5 text-xs rounded-full border font-medium transition ${
                      btn.active
                        ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                        : "bg-primary-bg border-theme text-muted hover:border-gray-500 hover:text-main"
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Role</label>
                  <input
                    value={filterRole}
                    onChange={e => setFilterRole(e.target.value)}
                    placeholder="e.g. Software, Data"
                    className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Location</label>
                  <input
                    value={filterLocation}
                    onChange={e => setFilterLocation(e.target.value)}
                    placeholder="e.g. Bangalore, Remote"
                    className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Stipend</label>
                  <select
                    value={filterStipend}
                    onChange={e => setFilterStipend(e.target.value as "Any" | "Paid" | "Unpaid")}
                    className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main focus:outline-none focus:border-blue-500 transition"
                  >
                    <option value="Any">Any</option>
                    <option value="Paid">Paid only</option>
                    <option value="Unpaid">Unpaid only</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Posted</label>
                  <select
                    value={filterPosted}
                    onChange={e => setFilterPosted(e.target.value as "Any" | "7" | "30")}
                    className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main focus:outline-none focus:border-blue-500 transition"
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
                <p className="text-muted text-sm">Fetching live internship listings from Adzuna, Remotive, and Arbeitnow...</p>
              </div>
            )}

            {listingsError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-6">
                {listingsError}
              </div>
            )}

            {!listingsLoading && !listingsError && (
              <>
                {internships.length > 0 && internships.length < 20 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-2.5 mb-4 text-xs text-yellow-400">
                    Showing {internships.length} live listings — check back tomorrow for more
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 mb-1">
                  <p className="text-muted text-sm">
                    {filteredInternships.length} internship{filteredInternships.length !== 1 ? "s" : ""} found
                    {internships.length !== filteredInternships.length ? ` (filtered from ${internships.length})` : ""}
                    {(sourceCounts.Remotive ?? 0) > 0 && ` — ${sourceCounts.Remotive} from Remotive`}
                    {(sourceCounts.Adzuna ?? 0) > 0 && ` — ${sourceCounts.Adzuna} from Adzuna`}
                    {(sourceCounts.Arbeitnow ?? 0) > 0 && ` — ${sourceCounts.Arbeitnow} from Arbeitnow`}
                  </p>
                  {filteredInternships.filter(j => j.known || KNOWN_COMPANIES.has((j.company || "").toLowerCase().trim())).length > 0 && (
                    <span className="text-[11px] text-green-400">
                      <Check size={11} className="inline mr-0.5" />{filteredInternships.filter(j => j.known || KNOWN_COMPANIES.has((j.company || "").toLowerCase().trim())).length} from verified companies
                    </span>
                  )}
                </div>
                {(sourceCounts["AI Generated"] ?? 0) > 0 && (
                  <p className="text-faint text-xs mb-4">
                    Some listings are AI-generated examples. Verify on the company&apos;s careers page.
                  </p>
                )}
                {filteredInternships.length === 0 && !listingsLoading ? (
                  <div className="text-center py-16 text-faint">
                    No internships match your filters. Try broadening your search.
                  </div>
                ) : (() => {
                  const topMatches = filteredInternships.slice(0, 10).filter(j => j.relevanceScore > 0 || (j.known || KNOWN_COMPANIES.has((j.company || "").toLowerCase().trim())));
                  const rest = filteredInternships.slice(topMatches.length);

                  const isKnown = (job: typeof filteredInternships[0]) =>
                    job.known || KNOWN_COMPANIES.has((job.company || "").toLowerCase().trim());
                  const isPaid = (job: typeof filteredInternships[0]) =>
                    job.paid || !!(job.salary && job.salary.trim());

                  const renderCard = (job: typeof filteredInternships[0], isRecommended = false) => {
                    const id = job.id || job.redirect_url;
                    const isExpanded = expandedDescs.has(id);
                    const cleanDesc = stripHtml(job.description || "");
                    const showToggle = cleanDesc.length > 180;
                    const verified = isKnown(job);
                    const paid = isPaid(job);
                    return (
                      <div key={id} className={`bg-surface border rounded-2xl p-5 hover:border-theme transition ${isRecommended ? "border-blue-700/40 border-l-4 border-l-blue-500" : verified ? "border-green-800/30" : "border-theme"}`}>
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                              {isRecommended && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium shrink-0 flex items-center gap-0.5"><Star size={9} className="inline fill-current" /> Top Pick</span>
                              )}
                              <h3 className="font-semibold text-main truncate">{job.title}</h3>
                              {verified && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30 font-medium shrink-0 flex items-center gap-0.5"><Check size={9} className="inline" /> Verified</span>
                              )}
                              {paid && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium shrink-0">Paid</span>
                              )}
                              {job.source && (
                                <span className={`text-xs px-2 py-0.5 rounded border font-medium shrink-0 ${sourceBadge(job.source)}`}>
                                  {job.source}
                                </span>
                              )}
                            </div>
                            <p className="text-muted text-sm mt-0.5">{job.company} · {job.location}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {hiringBadge(job.hiring_status)}
                            {job.days_ago !== null && (
                              <span className="text-xs text-faint">
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

                        <div className="mb-3">
                          {!cleanDesc || cleanDesc.length < 20 ? (
                            <p className="text-xs text-faint italic">No description available</p>
                          ) : (
                            <>
                              <p className={`text-faint text-xs leading-relaxed ${!isExpanded ? "line-clamp-3" : ""}`}>{cleanDesc}</p>
                              {showToggle && (
                                <button onClick={() => toggleDesc(id)} className="text-xs text-blue-500 hover:text-blue-400 mt-1 transition">
                                  {isExpanded ? "Show less" : "Show more"}
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {job.redirect_url && (
                          <div className="flex justify-end">
                            <a
                              href={job.redirect_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-400 hover:text-blue-300 font-medium transition"
                            >
                              Apply →
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  };

                  return (
                    <>
                      {topMatches.length > 0 && (
                        <div className="mb-6">
                          <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-3">Best matches for you</p>
                          <div className="grid gap-4">
                            {topMatches.map(job => renderCard(job, true))}
                          </div>
                        </div>
                      )}
                      {rest.length > 0 && (
                        <div>
                          {topMatches.length > 0 && <p className="text-xs text-faint uppercase tracking-wider mb-3">All internships</p>}
                          <div className="grid gap-4">
                            {rest.map(job => renderCard(job, false))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── Startups Tab ─────────────────────────────────────────────────── */}
        {tab === "startups" && (
          <div>
            {/* Sub-tabs */}
            <div className="flex gap-2 mb-6">
              {(["ai_matched", "browse"] as const).map(st => (
                <button
                  key={st}
                  onClick={() => {
                    setStartupsTab(st);
                    if (st === "browse" && browseListings.length === 0 && !browseLoading) {
                      fetchBrowseStartups(1);
                    }
                  }}
                  className={`px-4 py-2 text-sm rounded-lg transition font-medium border ${
                    startupsTab === st
                      ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                      : "text-muted hover:text-main border-theme"
                  }`}
                >
                  {st === "ai_matched" ? "AI Matched" : "Browse All"}
                </button>
              ))}
            </div>

            {/* AI Matched */}
            {startupsTab === "ai_matched" && (
              <div>
                {aiStartupsLoading && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted text-sm">Finding startups most likely to hire you...</p>
                  </div>
                )}
                {aiStartupsError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-6 flex items-center justify-between">
                    <span>{aiStartupsError}</span>
                    <button onClick={fetchAiStartups} className="text-blue-400 hover:text-blue-300 text-sm ml-4">Retry</button>
                  </div>
                )}
                {!aiStartupsLoading && aiStartups && (
                  <div>
                    <div className="grid md:grid-cols-2 gap-4 mb-6">
                      {aiStartups.startups?.map((startup, i) => (
                        <div key={i} className="bg-surface border border-theme rounded-2xl p-5 hover:border-theme transition">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-main">{startup.name}</h4>
                              <p className="text-faint text-xs mt-0.5">{startup.city}</p>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ml-3 ${
                              startup.hiring_likelihood === "High" ? "bg-green-500/15 text-green-400 border-green-500/30" :
                              startup.hiring_likelihood === "Medium" ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" :
                              "bg-gray-700/50 text-muted border-gray-600"
                            }`}>
                              {startup.hiring_likelihood} chance
                            </span>
                          </div>
                          <div className="flex gap-2 mb-3 flex-wrap">
                            <span className="text-xs px-2 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">{startup.industry}</span>
                            <span className="text-xs px-2 py-0.5 rounded border bg-purple-500/10 text-purple-400 border-purple-500/20">{startup.stage}</span>
                          </div>
                          <p className="text-sm text-emerald-400 mb-2">{startup.why_good_fit}</p>
                          <p className="text-xs text-faint border-t border-theme pt-2 mt-2">
                            <span className="text-blue-400 font-medium">How to apply: </span>{startup.how_to_apply}
                          </p>
                          <div className="flex gap-2 mt-3">
                            {startup.linkedin_url && (
                              <a href={validateUrl(startup.linkedin_url, startup.name)} target="_blank" rel="noopener noreferrer"
                                className="text-xs px-3 py-1.5 rounded-lg border border-theme text-muted hover:text-main hover:border-gray-500 transition">
                                LinkedIn →
                              </a>
                            )}
                            <a href={validateUrl(startup.careers_url, startup.name)} target="_blank" rel="noopener noreferrer"
                              className="text-xs px-3 py-1.5 rounded-lg border border-blue-500/30 text-blue-400 hover:border-blue-400 transition">
                              Apply →
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                    {aiStartups.pro_tip && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 mb-4">
                        <p className="text-xs text-yellow-500 font-semibold uppercase tracking-wider mb-1">Pro Tip</p>
                        <p className="text-muted text-sm">{aiStartups.pro_tip}</p>
                      </div>
                    )}
                    <button
                      onClick={() => { localStorage.removeItem("placeiq_startups"); setAiStartups(null); fetchAiStartups(); }}
                      className="text-xs text-faint hover:text-muted transition"
                    >
                      Regenerate
                    </button>
                  </div>
                )}
                {!aiStartupsLoading && !aiStartups && !aiStartupsError && (
                  <div className="text-center py-20">
                    <p className="text-faint mb-4">Complete your profile to get AI-matched startup recommendations.</p>
                    <button onClick={() => router.push("/onboarding")} className="text-sm text-blue-400 hover:text-blue-300 transition">
                      Set up profile →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Browse All */}
            {startupsTab === "browse" && (
              <div>
                <div className="bg-surface border border-theme rounded-2xl p-5 mb-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-muted mb-1.5 block">Search</label>
                      <input
                        value={browseSearch}
                        onChange={e => setBrowseSearch(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && fetchBrowseStartups(1)}
                        placeholder="Company or title..."
                        className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted mb-1.5 block">Industry / Role</label>
                      <input
                        value={browseIndustry}
                        onChange={e => setBrowseIndustry(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && fetchBrowseStartups(1)}
                        placeholder="e.g. Software, ML, Design"
                        className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted mb-1.5 block">City</label>
                      <input
                        value={browseCity}
                        onChange={e => setBrowseCity(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && fetchBrowseStartups(1)}
                        placeholder="e.g. Bangalore, Remote"
                        className="w-full bg-primary-bg border border-theme rounded-lg px-3 py-2 text-sm text-main placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => fetchBrowseStartups(1)}
                    className="mt-4 text-sm bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-4 py-2 rounded-lg transition"
                  >
                    Search
                  </button>
                </div>

                {browseLoading && browsePage === 1 && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted text-sm">Fetching startup listings...</p>
                  </div>
                )}
                {browseError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-6">{browseError}</div>
                )}
                {!browseLoading && browseListings.length > 0 && (
                  <>
                    <p className="text-faint text-sm mb-4">{browseTotal} listings found</p>
                    <div className="grid gap-4">
                      {browseListings.map((job, idx) => (
                        <div key={job.id || String(idx)} className="bg-surface border border-theme rounded-2xl p-5 hover:border-theme transition">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <h3 className="font-semibold text-main">{job.title}</h3>
                                {job.source && (
                                  <span className={`text-xs px-2 py-0.5 rounded border font-medium shrink-0 ${sourceBadge(job.source)}`}>{job.source}</span>
                                )}
                              </div>
                              <p className="text-muted text-sm mt-0.5">{job.company} · {job.location}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              {hiringBadge(job.hiring_status)}
                              {job.days_ago !== null && (
                                <span className="text-xs text-faint">{job.days_ago === 0 ? "Today" : `${job.days_ago}d ago`}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-blue-400">{job.salary || "Stipend not mentioned"}</span>
                            {job.redirect_url && (
                              <a href={job.redirect_url} target="_blank" rel="noopener noreferrer"
                                className="text-sm text-blue-400 hover:text-blue-300 font-medium transition shrink-0">
                                Apply →
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {browseListings.length < browseTotal && (
                      <div className="mt-6 text-center">
                        <button
                          onClick={() => fetchBrowseStartups(browsePage + 1)}
                          disabled={browseLoading}
                          className="text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 px-6 py-2 rounded-lg transition disabled:opacity-50"
                        >
                          {browseLoading ? "Loading..." : "Load More"}
                        </button>
                      </div>
                    )}
                  </>
                )}
                {!browseLoading && !browseError && browseListings.length === 0 && (
                  <div className="text-center py-20 text-faint">
                    <p>Use the filters above and click Search to browse startup listings.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── AI Strategy Tab ───────────────────────────────────────────────── */}
        {tab === "strategy" && (
          <div>
            {strategyLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-muted text-sm">Building your internship strategy...</p>
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
                      <div key={i} className="bg-surface border border-theme rounded-2xl p-5">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-blue-400">{p.platform}</h4>
                          {p.url && (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-faint hover:text-muted transition"
                            >
                              Visit →
                            </a>
                          )}
                        </div>
                        <p className="text-muted text-sm mb-2">{p.why}</p>
                        <p className="text-faint text-xs border-t border-theme pt-2 mt-2">
                          <span className="text-muted font-medium">Tip: </span>{p.how_to_use}
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
                      <div key={i} className="bg-surface border border-theme rounded-2xl p-5">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-main">{t.type}</h4>
                          {difficultyBadge(t.difficulty)}
                        </div>
                        <p className="text-muted text-xs mb-2">
                          <span className="text-muted">Timeline: </span>{t.timeline}
                        </p>
                        <p className="text-muted text-sm">{t.why_good_for_them}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Plan */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">60-Day Action Plan</h3>
                  <div className="bg-surface border border-theme rounded-2xl p-5">
                    <ol className="space-y-3">
                      {strategy.action_plan?.map((step, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-muted">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Verdict */}
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5">
                  <h3 className="text-sm font-semibold text-yellow-400 mb-2">Honest Verdict</h3>
                  <p className="text-muted text-sm leading-relaxed">{strategy.verdict}</p>
                </div>

                <button
                  onClick={() => {
                    localStorage.removeItem("placeiq_internship_strategy");
                    setStrategy(null);
                    fetchStrategy();
                  }}
                  className="text-xs text-faint hover:text-muted transition"
                >
                  Regenerate strategy
                </button>
              </div>
            )}

            {!strategyLoading && !strategy && !strategyError && (
              <div className="text-center py-20">
                <p className="text-faint mb-4">Complete your profile to get a personalized internship strategy.</p>
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
            <p className="text-muted text-sm mb-6">
              Major virtual internship programs and structured initiatives for Indian engineering students.
            </p>
            {["Big Tech", "Finance", "Indian Tech", "Hardware", "Government / Research"].map(category => {
              const programs = STATIC_PROGRAMS.filter(p => p.category === category);
              return (
                <div key={category} className="mb-8">
                  <h3 className="text-sm font-semibold text-faint uppercase tracking-wider mb-4">{category}</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {programs.map(prog => (
                      <div key={prog.name} className="bg-surface border border-theme rounded-2xl p-5 hover:border-theme transition">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-semibold text-main">{prog.name}</h4>
                            <p className="text-faint text-xs mt-0.5">{prog.company}</p>
                          </div>
                          {difficultyBadge(prog.difficulty)}
                        </div>
                        <div className="space-y-1.5 mb-4">
                          <p className="text-xs text-muted">
                            <span className="text-faint">Eligibility: </span>{prog.eligibility}
                          </p>
                          <p className="text-xs text-muted">
                            <span className="text-faint">Deadline: </span>{prog.deadline}
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
