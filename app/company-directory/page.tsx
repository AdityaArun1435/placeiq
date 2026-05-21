"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

type Company = {
  name: string;
  industry: string;
  size: string;
  headquarters: string;
  rating: number | null;
  description: string;
  linkedin: string;
  careers_url: string | null;
  careers_verified: boolean;
  source?: string;
};

type DirectoryResponse = {
  companies: Company[];
  total_count: number;
  page: number;
  has_more: boolean;
  building: boolean;
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
  { label: "Directory", path: "/company-directory", active: true },
];

const INDUSTRIES = ["All", "IT Services", "IT Consulting", "SaaS/Product", "FinTech", "E-Commerce", "Food Tech", "Software/Cloud", "Technology", "Banking/Tech", "Product Engineering"];
const CITIES = ["All", "Bangalore", "Mumbai", "Hyderabad", "Chennai", "Pune", "Noida", "Gurugram"];
const RATINGS = [
  { label: "Any rating", value: 0 },
  { label: "4+ stars", value: 4 },
  { label: "3+ stars", value: 3 },
];

function ambitionboxSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function RatingDisplay({ rating, companyName }: { rating: number | null; companyName: string }) {
  if (!rating || rating < 1 || rating > 5) return <span className="text-gray-600 text-xs">No rating yet</span>;

  const full = Math.floor(rating);
  const stars = "★".repeat(full) + "☆".repeat(5 - full);
  const color = rating >= 4.0 ? "text-green-400" : rating >= 3.0 ? "text-yellow-400" : "text-red-400";
  const slug = ambitionboxSlug(companyName);
  const url = `https://www.ambitionbox.com/overview/${slug}-overview`;

  return (
    <div className="relative group inline-flex items-center">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-xs font-medium flex items-center gap-1 ${color} hover:underline`}
        onClick={e => e.stopPropagation()}
      >
        <span>{stars}</span>
        <span>{rating.toFixed(1)}</span>
        <span className="text-gray-600 mx-0.5">·</span>
        <span className="text-gray-400">Employee Rating</span>
      </a>
      <div className="absolute bottom-full left-0 mb-2 z-20 w-64 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-xs shadow-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="font-semibold text-white mb-1">Employee Rating (Ambitionbox)</p>
        <p className="text-gray-400 leading-relaxed">Based on employee reviews on Ambitionbox — rates work culture, salary, and work-life balance</p>
      </div>
    </div>
  );
}

function IndustryBadge({ industry }: { industry: string }) {
  const color =
    industry.includes("FinTech") ? "bg-green-900/40 text-green-400 border-green-700/40" :
    industry.includes("SaaS") || industry.includes("Product") ? "bg-purple-900/40 text-purple-400 border-purple-700/40" :
    industry.includes("E-Commerce") || industry.includes("Retail") ? "bg-orange-900/40 text-orange-400 border-orange-700/40" :
    industry.includes("Food") ? "bg-red-900/40 text-red-400 border-red-700/40" :
    industry.includes("Cloud") || industry.includes("Software") || industry.includes("Tech") ? "bg-blue-900/40 text-blue-400 border-blue-700/40" :
    "bg-gray-800 text-gray-400 border-gray-700";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>{industry}</span>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="h-5 w-36 bg-gray-800 rounded" />
        <div className="h-4 w-20 bg-gray-800 rounded" />
      </div>
      <div className="h-3 w-24 bg-gray-800 rounded mb-3" />
      <div className="h-3 w-full bg-gray-800 rounded mb-1.5" />
      <div className="h-3 w-4/5 bg-gray-800 rounded mb-4" />
      <div className="flex gap-2">
        <div className="h-7 w-24 bg-gray-800 rounded-lg" />
        <div className="h-7 w-24 bg-gray-800 rounded-lg" />
      </div>
    </div>
  );
}

export default function CompanyDirectoryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("All");
  const [city, setCity] = useState("All");
  const [rating, setRating] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  const fetchPage = useCallback(async (pg: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(pg),
        ...(industry !== "All" && { industry }),
        ...(city !== "All" && { city }),
        ...(rating > 0 && { rating: String(rating) }),
        ...(search.trim() && { search: search.trim() }),
      });
      const res = await fetch(`http://localhost:8000/api/directory/companies?${params}`);
      if (!res.ok) throw new Error("Failed to fetch company directory");
      const data: DirectoryResponse = await res.json();
      if (append) {
        setCompanies(prev => [...prev, ...data.companies]);
      } else {
        setCompanies(data.companies);
      }
      setTotalCount(data.total_count);
      setPage(data.page);
      setHasMore(data.has_more);
      setBuilding(data.building);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load companies");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [industry, city, rating, search]);

  useEffect(() => {
    if (status === "authenticated") {
      setPage(1);
      fetchPage(1, false);
    }
  }, [status, industry, city, rating]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchPage(1, false);
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

      <div className="max-w-7xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Company Directory</h2>
          <p className="text-gray-400 text-sm">
            {totalCount > 0 ? (
              <>{totalCount} Indian tech companies — sourced from Adzuna live data and curated profiles</>
            ) : "Loading company data..."}
          </p>
          {building && (
            <p className="text-blue-400 text-xs mt-1 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              Building full directory in background — refresh in ~30 seconds for more companies
            </p>
          )}
        </div>

        {/* Filters */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-8">
          <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-gray-400 mb-1.5 block">Search companies</label>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="e.g. Razorpay, FinTech..."
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Industry</label>
              <select
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                className="bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
              >
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">City</label>
              <select
                value={city}
                onChange={e => setCity(e.target.value)}
                className="bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
              >
                {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Rating</label>
              <select
                value={rating}
                onChange={e => setRating(Number(e.target.value))}
                className="bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
              >
                {RATINGS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              Search
            </button>
          </form>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">
            {error} — make sure the backend is running.
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Company grid */}
        {!loading && companies.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {companies.map(co => (
                <div key={co.name} className="bg-[#111] border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition flex flex-col">
                  {/* Top: name + industry */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-white leading-snug">{co.name}</h3>
                    <IndustryBadge industry={co.industry} />
                  </div>

                  {/* Meta row */}
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <RatingDisplay rating={co.rating} companyName={co.name} />
                    {co.headquarters !== "India" && (
                      <span className="text-gray-600 text-xs">{co.headquarters}</span>
                    )}
                    {co.size !== "N/A" && (
                      <span className="text-gray-700 text-xs">{co.size} employees</span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-500 leading-relaxed mb-4 flex-1 line-clamp-3">
                    {co.description || "Indian tech company actively hiring engineers."}
                  </p>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap mt-auto">
                    <a
                      href={`https://www.linkedin.com/company/${co.linkedin}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-900/30 border border-blue-700/40 text-blue-400 hover:bg-blue-900/50 rounded-lg transition"
                    >
                      LinkedIn →
                    </a>
                    {co.careers_url ? (
                      <a
                        href={co.careers_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-900/30 border border-green-700/40 text-green-400 hover:bg-green-900/50 rounded-lg transition"
                      >
                        Careers ✅
                      </a>
                    ) : (
                      <span className="text-xs px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-600 rounded-lg">
                        Careers (unverified)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="mt-8 text-center">
                <button
                  onClick={() => fetchPage(page + 1, true)}
                  disabled={loadingMore}
                  className="border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white px-8 py-3 rounded-xl text-sm transition disabled:opacity-40"
                >
                  {loadingMore ? "Loading..." : `Load More (${totalCount - companies.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}

        {!loading && companies.length === 0 && !error && (
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-12 text-center">
            <p className="text-gray-400 mb-2">No companies match your filters</p>
            <button
              onClick={() => { setSearch(""); setIndustry("All"); setCity("All"); setRating(0); }}
              className="text-blue-400 hover:text-blue-300 text-sm transition"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
