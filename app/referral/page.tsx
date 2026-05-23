"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import config from '@/lib/config'

type Profile = {
  college: string;
  branch: string;
  targetRole: string;
};

type AlumniRecord = {
  id: number;
  name: string;
  college: string;
  branch: string;
  graduation_year: string;
  company: string;
  role: string;
  linkedin_url: string;
  open_to_referrals: boolean;
  verified: boolean;
  submitted_at: string;
};

type MessagePopup = {
  alumni: AlumniRecord;
  message: string | null;
  loading: boolean;
  copied: boolean;
};

const COLLEGES = [
  "IIT Bombay", "IIT Delhi", "IIT Madras", "IIT Kanpur", "IIT Kharagpur",
  "IIT Roorkee", "IIT Hyderabad", "IIT Guwahati", "IIT BHU",
  "NIT Trichy", "NIT Warangal", "NIT Surathkal", "NIT Calicut",
  "BITS Pilani", "BITS Goa", "BITS Hyderabad",
  "VIT Vellore", "VIT Chennai", "VIT Bhopal", "VIT AP",
  "SRM KTR", "SRM Ramapuram", "SRM Vadapalani", "SRM Delhi-NCR", "SRM Sonepat",
  "SSN College of Engineering", "SNU Chennai", "Amrita Coimbatore",
  "Amrita Chennai", "Amrita Bengaluru",
  "PESU", "PESU Electronic City", "RV College of Engineering",
  "BMS College of Engineering", "MSRIT",
  "PSG College of Technology", "Coimbatore Institute of Technology",
  "Kongu Engineering College", "Sri Krishna College of Engineering",
  "Bannari Amman Institute of Technology",
  "CEG Anna University", "MIT Campus Anna University",
  "KCG College of Technology", "Rajalakshmi Engineering College",
  "Saveetha Engineering College", "Panimalar Engineering College",
  "Velammal Engineering College", "Hindustan Institute of Technology",
  "Sri Venkateswara College of Engineering",
  "Karpagam College of Engineering", "SNS College of Technology",
  "Manipal Institute of Technology", "Thapar University", "Chandigarh University",
  "IIIT Hyderabad", "IIIT Bangalore", "IIIT Allahabad",
  "DTU Delhi", "NSIT Delhi", "Jadavpur University",
  "VJTI Mumbai", "COEP Pune",
  "Other",
];

const BRANCHES = [
  "Computer Science", "Electronics & Communication", "Electrical Engineering",
  "Mechanical", "Civil", "Information Technology", "Chemical", "Biotechnology",
  "Aerospace", "Instrumentation", "Metallurgy", "Other",
];

const GRAD_YEARS = ["2020", "2021", "2022", "2023", "2024", "2025", "2026"];


export default function Referral() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<"find" | "submit">("find");

  // Find tab
  const [alumni, setAlumni] = useState<AlumniRecord[]>([]);
  const [stats, setStats] = useState({ total: 0, college_count: 0 });
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [collegeFilter, setCollegeFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  // Message popup
  const [popup, setPopup] = useState<MessagePopup | null>(null);

  // Submit tab
  const [submitForm, setSubmitForm] = useState({
    name: "",
    college: "",
    branch: "",
    graduation_year: "2024",
    company: "",
    role: "",
    linkedin_url: "",
    open_to_referrals: true,
  });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("placeiq_profile");
      if (raw) setProfile(JSON.parse(raw));
    } catch {}
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch(`${config.apiUrl}/api/referral/list`);
      if (!res.ok) return;
      const data = await res.json();
      setStats({ total: data.total, college_count: data.college_count });
    } catch {}
  }

  async function fetchAlumni() {
    setListLoading(true);
    setListError("");
    setHasSearched(true);
    try {
      const params = new URLSearchParams();
      if (collegeFilter) params.set("college", collegeFilter);
      if (companyFilter) params.set("company", companyFilter);
      if (branchFilter) params.set("branch", branchFilter);
      const res = await fetch(`${config.apiUrl}/api/referral/list?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAlumni(data.alumni || []);
      setStats({ total: data.total, college_count: data.college_count });
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "Failed to load alumni");
    } finally {
      setListLoading(false);
    }
  }

  async function generateMessage(a: AlumniRecord) {
    if (!profile) return;
    setPopup({ alumni: a, message: null, loading: true, copied: false });
    try {
      const res = await fetch(`${config.apiUrl}/api/referral/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_name: session?.user?.name || "Student",
          student_branch: profile.branch,
          student_college: profile.college,
          target_role: profile.targetRole,
          alumni_name: a.name,
          alumni_role: a.role,
          alumni_company: a.company,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPopup({ alumni: a, message: data.message || "", loading: false, copied: false });
    } catch {
      setPopup(prev => prev ? { ...prev, loading: false, message: "Generation failed. Please try again." } : null);
    }
  }

  async function copyMessage() {
    if (!popup?.message) return;
    try {
      await navigator.clipboard.writeText(popup.message);
      setPopup(prev => prev ? { ...prev, copied: true } : null);
      setTimeout(() => setPopup(prev => prev ? { ...prev, copied: false } : null), 2000);
    } catch {}
  }

  async function submitAlumni() {
    const { name, college, branch, company, role, linkedin_url } = submitForm;
    if (!name || !college || !branch || !company || !role || !linkedin_url) {
      setSubmitError("Please fill in all required fields.");
      return;
    }
    setSubmitLoading(true);
    setSubmitError("");
    try {
      const res = await fetch(`${config.apiUrl}/api/referral/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitForm),
      });
      if (!res.ok) throw new Error(await res.text());
      setSubmitSuccess(true);
      fetchStats();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitLoading(false);
    }
  }

  if (status === "loading") return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* Banner */}
        <div className="bg-blue-600/10 border border-blue-500/20 rounded-2xl px-6 py-4 mb-8 flex items-center gap-3">
          <span className="text-xl">🎓</span>
          <p className="text-sm text-blue-300">
            <span className="font-semibold">Alumni Network</span>{" — "}
            <span className="text-white font-medium">{stats.total}</span> professionals from{" "}
            <span className="text-white font-medium">{stats.college_count}</span> colleges have joined. Be part of it.
          </p>
        </div>

        <h2 className="text-3xl font-bold mb-2">Referral Radar</h2>
        <p className="text-gray-400 mb-8">Connect with alumni from your college working at top companies</p>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#111] border border-gray-800 rounded-xl p-1 w-fit mb-8">
          {(["find", "submit"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {t === "find" ? "Find Alumni" : "Submit Your Info"}
            </button>
          ))}
        </div>

        {/* ── Find Alumni Tab ── */}
        {tab === "find" && (
          <div>
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">College</label>
                  <select
                    value={collegeFilter}
                    onChange={e => setCollegeFilter(e.target.value)}
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                  >
                    <option value="">All Colleges</option>
                    {COLLEGES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Branch</label>
                  <select
                    value={branchFilter}
                    onChange={e => setBranchFilter(e.target.value)}
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                  >
                    <option value="">All Branches</option>
                    {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Company</label>
                  <input
                    value={companyFilter}
                    onChange={e => setCompanyFilter(e.target.value)}
                    placeholder="e.g. Google, Razorpay..."
                    onKeyDown={e => e.key === "Enter" && fetchAlumni()}
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={fetchAlumni}
                    disabled={listLoading}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white py-2.5 rounded-xl font-medium transition text-sm"
                  >
                    {listLoading ? "Searching..." : "Search Alumni"}
                  </button>
                </div>
              </div>
            </div>

            {listError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-6">{listError}</div>
            )}

            {hasSearched && !listLoading && (
              <p className="text-gray-500 text-sm mb-4">
                {alumni.length > 0 ? `${alumni.length} alumni found` : "No alumni found for these filters"}
              </p>
            )}

            {hasSearched && alumni.length === 0 && !listLoading && (
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-12 text-center">
                <p className="text-4xl mb-4">🎓</p>
                <p className="text-gray-400 text-sm mb-1">No alumni found for these filters</p>
                <p className="text-gray-600 text-xs mb-4">Be the first to submit from your college!</p>
                <button
                  onClick={() => setTab("submit")}
                  className="text-blue-400 hover:text-blue-300 text-sm transition"
                >
                  Submit your info →
                </button>
              </div>
            )}

            {!hasSearched && (
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-12 text-center">
                <p className="text-4xl mb-4">🔍</p>
                <p className="text-gray-400 text-sm">Use the filters above to find alumni from your college</p>
                <p className="text-gray-600 text-xs mt-2">Filter by college, branch, or company to narrow results</p>
              </div>
            )}

            {alumni.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {alumni.map(a => (
                  <div key={a.id} className="bg-[#111] border border-gray-800 rounded-2xl p-5 flex flex-col gap-3 hover:border-gray-700 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-white">{a.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{a.college} · {a.graduation_year}</p>
                      </div>
                      {a.open_to_referrals && (
                        <span className="bg-green-500/10 border border-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                          Open to Referrals
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="text-sm text-blue-400 font-medium">{a.role}</p>
                      <p className="text-sm text-gray-300">{a.company}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{a.branch}</p>
                    </div>

                    <div className="flex gap-2 mt-auto pt-1">
                      <a
                        href={a.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center text-xs px-3 py-2 bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600/20 rounded-lg transition"
                      >
                        Connect on LinkedIn →
                      </a>
                      <button
                        onClick={() => generateMessage(a)}
                        title={!profile ? "Complete your profile to generate a message" : ""}
                        disabled={!profile}
                        className="flex-1 text-xs px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 rounded-lg transition"
                      >
                        Generate Message
                      </button>
                    </div>
                    {!profile && (
                      <p className="text-xs text-gray-600 text-center -mt-1">
                        <button onClick={() => router.push("/onboarding")} className="text-blue-500 hover:text-blue-400 transition">
                          Complete profile
                        </button>{" "}to generate a personalised message
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Submit Tab ── */}
        {tab === "submit" && (
          <div className="max-w-2xl">
            {submitSuccess ? (
              <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-10 text-center">
                <div className="w-14 h-14 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="text-white font-semibold text-lg mb-3">You&apos;re in the network!</p>
                <p className="text-gray-400 text-sm leading-relaxed max-w-sm mx-auto">
                  Thanks! You&apos;ve been added to the PlaceIQ alumni network. Your profile helps future students from your college.
                </p>
                <button
                  onClick={() => { setSubmitSuccess(false); setTab("find"); }}
                  className="mt-6 text-blue-400 hover:text-blue-300 text-sm transition"
                >
                  Find other alumni →
                </button>
              </div>
            ) : (
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-8">
                <h3 className="font-semibold text-white mb-1">Add yourself to the network</h3>
                <p className="text-xs text-gray-500 mb-6">
                  Your LinkedIn profile will be visible to students from your college only.
                </p>

                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-400 mb-1.5 block">Full Name *</label>
                      <input
                        value={submitForm.name}
                        onChange={e => setSubmitForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Your name"
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1.5 block">Graduation Year *</label>
                      <select
                        value={submitForm.graduation_year}
                        onChange={e => setSubmitForm(f => ({ ...f, graduation_year: e.target.value }))}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                      >
                        {GRAD_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-400 mb-1.5 block">College *</label>
                      <select
                        value={submitForm.college}
                        onChange={e => setSubmitForm(f => ({ ...f, college: e.target.value }))}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                      >
                        <option value="">Select college</option>
                        {COLLEGES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1.5 block">Branch *</label>
                      <select
                        value={submitForm.branch}
                        onChange={e => setSubmitForm(f => ({ ...f, branch: e.target.value }))}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                      >
                        <option value="">Select branch</option>
                        {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-400 mb-1.5 block">Current Company *</label>
                      <input
                        value={submitForm.company}
                        onChange={e => setSubmitForm(f => ({ ...f, company: e.target.value }))}
                        placeholder="e.g. Google, Razorpay"
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1.5 block">Current Role *</label>
                      <input
                        value={submitForm.role}
                        onChange={e => setSubmitForm(f => ({ ...f, role: e.target.value }))}
                        placeholder="e.g. SDE-1, Data Engineer"
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-1.5 block">LinkedIn URL *</label>
                    <input
                      value={submitForm.linkedin_url}
                      onChange={e => setSubmitForm(f => ({ ...f, linkedin_url: e.target.value }))}
                      placeholder="https://linkedin.com/in/your-profile"
                      className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  <div className="flex items-center justify-between bg-[#0a0a0a] border border-gray-700 rounded-lg px-4 py-3">
                    <div>
                      <p className="text-sm text-white font-medium">Open to Referrals</p>
                      <p className="text-xs text-gray-500 mt-0.5">Students can reach out to you for referrals</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubmitForm(f => ({ ...f, open_to_referrals: !f.open_to_referrals }))}
                      className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${submitForm.open_to_referrals ? "bg-green-500" : "bg-gray-700"}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${submitForm.open_to_referrals ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </div>

                {submitError && (
                  <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">{submitError}</div>
                )}

                <button
                  onClick={submitAlumni}
                  disabled={submitLoading}
                  className="w-full mt-6 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white py-3 rounded-xl font-medium transition text-sm"
                >
                  {submitLoading ? "Submitting..." : "Join Alumni Network →"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Message Popup */}
      {popup && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setPopup(null)}
        >
          <div
            className="bg-[#111] border border-gray-700 rounded-2xl p-6 max-w-md w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">LinkedIn Connection Message</h3>
              <button
                onClick={() => setPopup(null)}
                className="text-gray-500 hover:text-white text-xl leading-none w-6 h-6 flex items-center justify-center"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              To connect with{" "}
              <span className="text-gray-300">{popup.alumni.name}</span> at{" "}
              <span className="text-gray-300">{popup.alumni.company}</span>
            </p>

            {popup.loading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-500 text-xs">Crafting your message...</p>
              </div>
            ) : (
              <>
                <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-4 mb-4 min-h-16">
                  <p className="text-sm text-gray-300 leading-relaxed">{popup.message}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={copyMessage}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition ${
                      popup.copied
                        ? "bg-green-600/20 text-green-400 border border-green-500/30"
                        : "bg-blue-600 hover:bg-blue-500 text-white"
                    }`}
                  >
                    {popup.copied ? "Copied!" : "Copy Message"}
                  </button>
                  <a
                    href={popup.alumni.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 text-center transition"
                  >
                    Open LinkedIn →
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
