"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  { label: "Resources", path: "/resources", active: true },
  { label: "Cold Email", path: "/coldemail" },
  { label: "Directory", path: "/company-directory" },
  { label: "Internships", path: "/internships" },
];

type Resource = { label: string; url: string; desc: string };
type Section = { title: string; icon: string; resources: Resource[] };

const SECTIONS: Section[] = [
  {
    title: "DSA & Competitive Programming",
    icon: "⚡",
    resources: [
      { label: "Striver's A2Z DSA Sheet", url: "https://takeuforward.org/strivers-a2z-dsa-course/", desc: "450+ problems, structured by topic — the gold standard for Indian placement prep" },
      { label: "NeetCode 150", url: "https://neetcode.io/", desc: "Curated 150 LeetCode problems with video explanations — ideal for product company prep" },
      { label: "LeetCode Company-wise Tags", url: "https://leetcode.com/problemset/", desc: "Filter by company to practice exactly what TCS, Infosys, Amazon, etc. actually ask" },
      { label: "GeeksForGeeks DSA", url: "https://www.geeksforgeeks.org/data-structures/", desc: "Comprehensive coverage of arrays, trees, graphs, DP with Indian company examples" },
      { label: "CSES Problem Set", url: "https://cses.fi/problemset/", desc: "Excellent competitive programming problems ordered by difficulty for systematic practice" },
    ],
  },
  {
    title: "YouTube Channels",
    icon: "▶",
    resources: [
      { label: "Striver (TakeUForward)", url: "https://www.youtube.com/@takeUforward", desc: "Best DSA + system design channel for Indian placements — follows A2Z sheet exactly" },
      { label: "Kunal Kushwaha", url: "https://www.youtube.com/@KunalKushwawa", desc: "Java DSA + open source bootcamp — excellent for beginners building a strong foundation" },
      { label: "Abdul Bari", url: "https://www.youtube.com/@abdul_bari", desc: "Classic algorithms explained with deep theory — essential for understanding time complexity" },
      { label: "Apna College", url: "https://www.youtube.com/@ApnaCollegeOfficial", desc: "Full DSA course in C++ and Java tailored for Indian college students" },
      { label: "Code with Harry", url: "https://www.youtube.com/@CodeWithHarry", desc: "Beginner-friendly Python, web dev, and CS tutorials in Hindi" },
      { label: "Neso Academy", url: "https://www.youtube.com/@nesoacademy", desc: "GATE-quality explanations of OS, DBMS, CN — must-watch for TCS NQT and Infosys" },
    ],
  },
  {
    title: "Free Courses",
    icon: "🎓",
    resources: [
      { label: "CS50 by Harvard", url: "https://cs50.harvard.edu/x/", desc: "The best free CS course on earth — covers C, Python, SQL, web dev from scratch" },
      { label: "NPTEL Programming Courses", url: "https://nptel.ac.in/course.html", desc: "IIT-taught courses with certification — respected by Indian companies for Data Science, AI" },
      { label: "freeCodeCamp", url: "https://www.freecodecamp.org/", desc: "Full web development path: HTML/CSS/JS → React → Node.js completely free with projects" },
      { label: "Coursera (Audit Free)", url: "https://www.coursera.org/", desc: "Audit Stanford, Google, IBM courses free — click 'Audit' when enrolling to skip payment" },
      { label: "MIT OpenCourseWare", url: "https://ocw.mit.edu/", desc: "MIT lecture notes, problem sets, exams for algorithms, systems, AI — completely free" },
      { label: "The Missing Semester (MIT)", url: "https://missing.csail.mit.edu/", desc: "Git, shell, Linux tools — critical missing skills that college never teaches" },
    ],
  },
  {
    title: "Aptitude Preparation",
    icon: "🧮",
    resources: [
      { label: "IndiaBix", url: "https://www.indiabix.com/", desc: "Largest Indian aptitude question bank — quant, logical reasoning, verbal, company-specific" },
      { label: "PrepInsta (Company-wise)", url: "https://prepinsta.com/", desc: "Company-specific test prep for TCS NQT, Infosys InfyTQ, Wipro, Accenture with PYQs" },
      { label: "GFG Aptitude Questions", url: "https://www.geeksforgeeks.org/aptitude-questions-and-answers/", desc: "Topic-wise aptitude with solutions for placement exams" },
      { label: "M4Maths", url: "https://www.m4maths.com/", desc: "Placement papers and aptitude problems from TCS, Infosys, Wipro, Cognizant previous years" },
    ],
  },
  {
    title: "Company Interview Prep",
    icon: "🏢",
    resources: [
      { label: "GFG Company Interview Experiences", url: "https://www.geeksforgeeks.org/company-preparation/", desc: "Real interview experiences from TCS, Infosys, Amazon, Google employees — must read before interviews" },
      { label: "Glassdoor Interview Reviews", url: "https://www.glassdoor.co.in/Interview/index.htm", desc: "Anonymous interview reviews with actual questions asked at each company in India" },
      { label: "LeetCode Discuss", url: "https://leetcode.com/discuss/interview-experience/", desc: "Fresh interview experiences from candidates who recently cleared product company interviews" },
      { label: "InterviewBit", url: "https://www.interviewbit.com/", desc: "Structured interview prep with company-specific tracks for product companies" },
      { label: "Glassdoor Salary", url: "https://www.glassdoor.co.in/Salaries/index.htm", desc: "Real salary data from Indian tech companies — know what to negotiate before your offer call" },
    ],
  },
  {
    title: "System Design",
    icon: "⚙",
    resources: [
      { label: "System Design Primer (GitHub)", url: "https://github.com/donnemartin/system-design-primer", desc: "The definitive free system design guide — essential for Razorpay, Swiggy, Flipkart interviews" },
      { label: "High Scalability", url: "http://highscalability.com/", desc: "Real architecture case studies from Twitter, Uber, Amazon — great for senior role prep" },
      { label: "Gaurav Sen (YouTube)", url: "https://www.youtube.com/@gkcs", desc: "Best system design YouTube channel for Indian product company interviews" },
    ],
  },
  {
    title: "Resume & LinkedIn",
    icon: "📄",
    resources: [
      { label: "Resume Worded", url: "https://resumeworded.com/", desc: "Free AI resume scorer that checks ATS keywords — use before applying to any company" },
      { label: "Overleaf Resume Templates", url: "https://www.overleaf.com/gallery/tagged/cv", desc: "Professional LaTeX resume templates used by IIT/NIT students — looks significantly better than Word" },
      { label: "Jake's Resume Template", url: "https://www.overleaf.com/latex/templates/jakes-resume/syzfjbzwjncs", desc: "The single most used ATS-friendly resume template for software engineering roles globally" },
      { label: "LinkedIn", url: "https://www.linkedin.com/", desc: "Essential for off-campus applications — optimize with keywords recruiters search for in India" },
    ],
  },
  {
    title: "Mock Interviews",
    icon: "🎤",
    resources: [
      { label: "Pramp", url: "https://www.pramp.com/", desc: "Free peer-to-peer mock interviews — practice coding interviews with real people from your peer level" },
      { label: "Interviewing.io", url: "https://interviewing.io/", desc: "Anonymous mock interviews with engineers from FAANG — paid but the best feedback available" },
      { label: "LeetCode Mock Interviews", url: "https://leetcode.com/interview/", desc: "Timed mock interview simulator with company-specific question sets — free with LeetCode account" },
    ],
  },
];

const CAREER_COMPANIES = [
  "TCS", "Infosys", "Wipro", "HCL Technologies", "Razorpay", "Freshworks",
  "Zepto", "Swiggy", "Zomato", "Flipkart", "Meesho", "PhonePe",
];

type VerifyStatus = "idle" | "loading" | "found" | "notfound";
type CareerResult = { url: string | null; status: VerifyStatus };

export default function Resources() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [careerResults, setCareerResults] = useState<Record<string, CareerResult>>(
    Object.fromEntries(CAREER_COMPANIES.map(c => [c, { url: null, status: "idle" as VerifyStatus }]))
  );

  async function verifyCareer(company: string) {
    setCareerResults(prev => ({ ...prev, [company]: { url: null, status: "loading" } }));
    try {
      const res = await fetch(`http://localhost:8000/api/resources/careers?company=${encodeURIComponent(company)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCareerResults(prev => ({
        ...prev,
        [company]: { url: data.url || null, status: data.url ? "found" : "notfound" },
      }));
    } catch {
      setCareerResults(prev => ({ ...prev, [company]: { url: null, status: "notfound" } }));
    }
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

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

      <div className="max-w-6xl mx-auto px-8 py-10">
        <h2 className="text-3xl font-bold mb-2">Placement Resources</h2>
        <p className="text-gray-400 mb-10">Curated free resources trusted by placed students across India</p>

        <div className="space-y-10">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xl">{section.icon}</span>
                <h3 className="text-lg font-semibold text-white">{section.title}</h3>
                <div className="flex-1 h-px bg-gray-800" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.resources.map(r => (
                  <a
                    key={r.url}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#111] border border-gray-800 rounded-xl p-4 hover:border-gray-700 hover:bg-[#151515] transition group block"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-medium text-sm text-white group-hover:text-blue-400 transition leading-snug">{r.label}</p>
                      <span className="text-gray-600 group-hover:text-gray-400 text-sm shrink-0 transition">↗</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{r.desc}</p>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Company Career Pages */}
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xl">🏢</span>
            <h3 className="text-lg font-semibold text-white">Company Career Pages</h3>
            <div className="flex-1 h-px bg-gray-800" />
          </div>
          <p className="text-xs text-gray-500 mb-4">Verify live career portals for top Indian tech companies — links checked in real time.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {CAREER_COMPANIES.map(company => {
              const result = careerResults[company];
              return (
                <div key={company} className="bg-[#111] border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-3">
                  <span className="text-sm text-white font-medium">{company}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {result.status === "found" && result.url && (
                      <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-xs text-green-400 hover:text-green-300 transition truncate max-w-28">
                        ✓ Open →
                      </a>
                    )}
                    {result.status === "notfound" && (
                      <span className="text-xs text-red-400">✗ Not found</span>
                    )}
                    {result.status !== "found" && (
                      <button
                        onClick={() => verifyCareer(company)}
                        disabled={result.status === "loading"}
                        className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg transition"
                      >
                        {result.status === "loading" ? "Checking..." : "Verify Link"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-12 bg-blue-600/5 border border-blue-500/20 rounded-2xl p-6 text-center">
          <p className="text-gray-400 text-sm">All resources are free. No affiliate links. Last verified 2026.</p>
        </div>
      </div>
    </main>
  );
}
