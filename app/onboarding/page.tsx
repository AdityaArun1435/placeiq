"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import config, { fetchWithTimeout } from '@/lib/config'

const COLLEGES = [
  // IITs
  "IIT Bombay", "IIT Delhi", "IIT Madras", "IIT Kanpur", "IIT Kharagpur",
  "IIT Roorkee", "IIT Hyderabad", "IIT Guwahati", "IIT BHU",
  // NITs
  "NIT Trichy", "NIT Warangal", "NIT Surathkal", "NIT Calicut",
  // BITS
  "BITS Pilani", "BITS Goa", "BITS Hyderabad",
  // VIT campuses
  "VIT Vellore", "VIT Chennai", "VIT Bhopal", "VIT AP",
  // SRM campuses
  "SRM KTR", "SRM Ramapuram", "SRM Vadapalani", "SRM Delhi-NCR", "SRM Sonepat",
  // South India private — premium
  "SSN College of Engineering", "SNU Chennai", "Amrita Coimbatore",
  "Amrita Chennai", "Amrita Bengaluru",
  // Bangalore autonomous
  "PESU", "PESU Electronic City", "RV College of Engineering",
  "BMS College of Engineering", "MSRIT",
  // Coimbatore / Tamil Nadu
  "PSG College of Technology", "Coimbatore Institute of Technology",
  "Kongu Engineering College", "Sri Krishna College of Engineering",
  "Bannari Amman Institute of Technology",
  // Chennai private
  "CEG Anna University", "MIT Campus Anna University",
  "KCG College of Technology", "Rajalakshmi Engineering College",
  "Saveetha Engineering College", "Panimalar Engineering College",
  "Velammal Engineering College", "Hindustan Institute of Technology",
  "Sri Venkateswara College of Engineering",
  // Other Coimbatore
  "Karpagam College of Engineering", "SNS College of Technology",
  // Other well-known colleges
  "Manipal Institute of Technology", "Thapar University", "Chandigarh University",
  "IIIT Hyderabad", "IIIT Bangalore", "IIIT Allahabad",
  "DTU Delhi", "NSIT Delhi", "Jadavpur University",
  "VJTI Mumbai", "COEP Pune",
  "Other"
];

const SKILLS = [
  "Python", "Java", "C", "C++", "JavaScript", "TypeScript", "Go", "Rust",
  "React", "Next.js", "Angular", "Vue.js", "Node.js", "Express", "Django", "FastAPI", "Spring Boot",
  "SQL", "MySQL", "PostgreSQL", "MongoDB", "Redis", "Firebase",
  "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "TensorFlow", "PyTorch", "Scikit-learn",
  "Data Structures", "Algorithms", "System Design", "DBMS", "Operating Systems", "Computer Networks",
  "AWS", "GCP", "Azure", "Docker", "Kubernetes", "CI/CD", "Linux",
  "Git", "REST APIs", "GraphQL", "Microservices",
  "Excel", "Power BI", "Tableau", "Statistics", "Probability",
  "HTML", "CSS", "Tailwind CSS", "Figma", "UI/UX"
];

const BRANCHES = [
  "Computer Science", "Electronics & Communication", "Electrical Engineering",
  "Mechanical", "Civil", "Information Technology", "Chemical", "Biotechnology",
  "Aerospace", "Instrumentation", "Metallurgy", "Other"
];

const ROLES = [
  "Software Engineer", "Data Scientist", "Product Manager", "Business Analyst",
  "DevOps Engineer", "ML Engineer", "Frontend Developer", "Backend Developer",
  "Full Stack Developer", "Embedded Systems Engineer", "Cybersecurity Analyst",
  "Cloud Engineer", "QA Engineer", "Research & Development"
];

function getCollegeTier(college: string): string {
  const name = college.toLowerCase();
  if (/iit|iisc|bits pilani|nit trichy|nit warangal/.test(name)) return "Tier 1";
  if (/nit|iiit|vit|manipal|srm|thapar|dtu|nsit/.test(name)) return "Tier 2";
  if (/amity|lovely|chandigarh|chitkara|lpu/.test(name)) return "Tier 3";
  return "Tier 3";
}

export default function Onboarding() {
  const router = useRouter();
  const { data: session } = useSession();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [collegeSearch, setCollegeSearch] = useState("");
  const [showCollegeList, setShowCollegeList] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [customSkill, setCustomSkill] = useState("");
  const [form, setForm] = useState({
    college: "",
    branch: "",
    year: "",
    cgpa: "",
    skills: [] as string[],
    targetRole: "",
    projectsCount: "",
    hasInternship: "",
    internshipMonths: "",
    hackathons: "",
    leetcodeCount: "",
    openSource: "",
    certifications: "",
    githubActive: "",
  });

  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({});

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  // Pre-fill from existing profile and lock static fields
  useEffect(() => {
    const stored = localStorage.getItem("placeiq_profile");
    if (!stored) return;
    try {
      const p = JSON.parse(stored);
      const locked: Record<string, boolean> = {};
      const patch: Partial<typeof form> = {};

      if (p.college)    { patch.college    = String(p.college);    locked.college    = true; }
      if (p.branch)     { patch.branch     = String(p.branch);     locked.branch     = true; }
      if (p.year)       { patch.year       = String(p.year);       locked.year       = true; }
      if (p.cgpa)       { patch.cgpa       = String(p.cgpa);       locked.cgpa       = true; }
      if (p.targetRole) { patch.targetRole = String(p.targetRole); locked.targetRole = true; }

      if (Array.isArray(p.skills))   patch.skills          = p.skills;
      if (p.projectsCount)           patch.projectsCount   = p.projectsCount;
      if (p.hasInternship)           patch.hasInternship   = p.hasInternship;
      if (p.internshipMonths)        patch.internshipMonths = p.internshipMonths;
      if (p.hackathons)              patch.hackathons      = p.hackathons;
      if (p.leetcodeCount)           patch.leetcodeCount   = p.leetcodeCount;
      if (p.openSource)              patch.openSource      = p.openSource;
      if (p.certifications)          patch.certifications  = p.certifications;
      if (p.githubActive)            patch.githubActive    = p.githubActive;

      if (p.college) setCollegeSearch(p.college);
      setForm(f => ({ ...f, ...patch }));
      setLockedFields(locked);
    } catch {}
  }, []);

  const filteredColleges = COLLEGES.filter(c =>
    c.toLowerCase().includes(collegeSearch.toLowerCase())
  );
  const filteredSkills = SKILLS.filter(s =>
    s.toLowerCase().includes(skillSearch.toLowerCase())
  );

  const toggleSkill = (skill: string) => {
    setForm(f => ({
      ...f,
      skills: f.skills.includes(skill)
        ? f.skills.filter(s => s !== skill)
        : [...f.skills, skill]
    }));
  };

  const addCustomSkill = () => {
    const trimmed = customSkill.trim();
    if (trimmed && !form.skills.includes(trimmed)) {
      setForm(f => ({ ...f, skills: [...f.skills, trimmed] }));
      setCustomSkill("");
    }
  };

  const handleCgpa = (val: string) => {
    if (val === "" || val === ".") { setForm(f => ({ ...f, cgpa: val })); return; }
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0 && num <= 10 && /^\d{0,2}(\.\d{0,2})?$/.test(val)) {
      setForm(f => ({ ...f, cgpa: val }));
    }
  };

  const next = () => setStep(s => s + 1);
  const back = () => setStep(s => s - 1);

  const step4Valid =
    !!form.projectsCount &&
    !!form.hasInternship &&
    (form.hasInternship === "no" || !!form.internshipMonths) &&
    !!form.hackathons;

  const step5Valid =
    !!form.leetcodeCount &&
    !!form.openSource &&
    !!form.certifications &&
    !!form.githubActive;

  const submit = async () => {
    setSubmitting(true);
    const payload = { ...form, email: session?.user?.email ?? "" };

    const existing = (() => {
      try { return JSON.parse(localStorage.getItem("placeiq_profile") || "{}"); }
      catch { return {}; }
    })();

    try {
      const res = await fetchWithTimeout(`${config.apiUrl}/api/user/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, 10000);
      if (!res || !res.ok) throw new Error("backend error");
      const data = await res.json();
      localStorage.setItem("placeiq_profile", JSON.stringify({ ...existing, ...data }));
    } catch {
      // Backend unavailable or timed out — merge with existing so we don't lose prior data
      localStorage.setItem("placeiq_profile", JSON.stringify({
        ...existing,
        ...payload,
        collegeTier: getCollegeTier(payload.college),
        placementScore: existing.placementScore ?? 0,
        scoreReasoning: existing.scoreReasoning ?? "",
      }));
    }

    // Invalidate AI caches so they regenerate with new skills
    localStorage.removeItem("placeiq_roadmap");
    localStorage.removeItem("placeiq_skillgap");

    router.push("/dashboard");
  };

  // Reusable option-button class
  const optBtn = (selected: boolean) =>
    `w-full text-left px-4 py-3 rounded-xl border transition text-sm font-medium ${
      selected
        ? "bg-blue-600/20 border-blue-500 text-main"
        : "bg-surface border-theme text-muted hover:border-gray-500"
    }`;

  return (
    <main className="min-h-screen bg-primary-bg text-main flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg">

        {/* Progress — 5 steps */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? "bg-blue-500" : "bg-gray-800"}`} />
          ))}
        </div>

        {/* Step 1 — College Info */}
        {step === 1 && (
          <div>
            <h2 className="text-2xl font-bold mb-1">Your College Info</h2>
            <p className="text-muted mb-8">We use this to match you with on-campus opportunities.</p>

            <div className="space-y-4">
              {lockedFields.college ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm text-muted">College Name</label>
                    <button type="button" onClick={() => setLockedFields(f => ({ ...f, college: false }))} className="text-xs text-blue-400 hover:text-blue-300 transition">Edit</button>
                  </div>
                  <div className="w-full bg-elevated border border-theme rounded-lg px-4 py-3 text-muted text-sm">{form.college}</div>
                </div>
              ) : (
                <div className="relative">
                  <label className="text-sm text-muted mb-1 block">College Name</label>
                  <input
                    className="w-full bg-surface border border-theme rounded-lg px-4 py-3 text-main focus:outline-none focus:border-blue-500"
                    placeholder="Search your college..."
                    value={form.college || collegeSearch}
                    onChange={e => {
                      setCollegeSearch(e.target.value);
                      setForm(f => ({ ...f, college: "" }));
                      setShowCollegeList(true);
                    }}
                    onFocus={() => setShowCollegeList(true)}
                  />
                  {showCollegeList && collegeSearch && (
                    <div className="absolute z-10 w-full mt-1 bg-elevated border border-theme rounded-lg max-h-48 overflow-y-auto">
                      {filteredColleges.length > 0 ? filteredColleges.map(c => (
                        <button
                          key={c}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-800 text-muted"
                          onClick={() => {
                            setForm(f => ({ ...f, college: c }));
                            setCollegeSearch(c);
                            setShowCollegeList(false);
                          }}
                        >
                          {c}
                        </button>
                      )) : (
                        <button
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-800 text-muted"
                          onClick={() => {
                            setForm(f => ({ ...f, college: collegeSearch }));
                            setShowCollegeList(false);
                          }}
                        >
                          Add "{collegeSearch}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {lockedFields.branch ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm text-muted">Branch</label>
                    <button type="button" onClick={() => setLockedFields(f => ({ ...f, branch: false }))} className="text-xs text-blue-400 hover:text-blue-300 transition">Edit</button>
                  </div>
                  <div className="w-full bg-elevated border border-theme rounded-lg px-4 py-3 text-muted text-sm">{form.branch}</div>
                </div>
              ) : (
                <div>
                  <label className="text-sm text-muted mb-1 block">Branch</label>
                  <select
                    className="w-full bg-surface border border-theme rounded-lg px-4 py-3 text-main focus:outline-none focus:border-blue-500"
                    value={form.branch}
                    onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
                  >
                    <option value="">Select branch</option>
                    {BRANCHES.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
              )}

              <div className="flex gap-4">
                <div className="flex-1">
                  {lockedFields.year ? (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm text-muted">Year</label>
                        <button type="button" onClick={() => setLockedFields(f => ({ ...f, year: false }))} className="text-xs text-blue-400 hover:text-blue-300 transition">Edit</button>
                      </div>
                      <div className="w-full bg-elevated border border-theme rounded-lg px-4 py-3 text-muted text-sm">{form.year}</div>
                    </>
                  ) : (
                    <>
                      <label className="text-sm text-muted mb-1 block">Year</label>
                      <select
                        className="w-full bg-surface border border-theme rounded-lg px-4 py-3 text-main focus:outline-none focus:border-blue-500"
                        value={form.year}
                        onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                      >
                        <option value="">Select</option>
                        <option>1st</option><option>2nd</option><option>3rd</option><option>4th</option>
                      </select>
                    </>
                  )}
                </div>
                <div className="flex-1">
                  {lockedFields.cgpa ? (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm text-muted">CGPA (0 - 10)</label>
                        <button type="button" onClick={() => setLockedFields(f => ({ ...f, cgpa: false }))} className="text-xs text-blue-400 hover:text-blue-300 transition">Edit</button>
                      </div>
                      <div className="w-full bg-elevated border border-theme rounded-lg px-4 py-3 text-muted text-sm">{form.cgpa}</div>
                    </>
                  ) : (
                    <>
                      <label className="text-sm text-muted mb-1 block">CGPA (0 - 10)</label>
                      <input
                        className="w-full bg-surface border border-theme rounded-lg px-4 py-3 text-main focus:outline-none focus:border-blue-500"
                        placeholder="e.g. 8.5"
                        value={form.cgpa}
                        onChange={e => handleCgpa(e.target.value)}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={next}
              disabled={!form.college || !form.branch || !form.year || !form.cgpa}
              className="mt-8 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-main px-6 py-3 rounded-lg font-medium transition"
            >
              Next
            </button>
          </div>
        )}

        {/* Step 2 — Skills */}
        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold mb-1">Your Skills</h2>
            <p className="text-muted mb-4">Select all that apply. Be honest - this affects your score.</p>

            {(form?.skills?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {form.skills.map(skill => (
                  <span key={skill} className="bg-blue-600 text-main text-xs px-3 py-1 rounded-full flex items-center gap-1">
                    {skill}
                    <button onClick={() => toggleSkill(skill)} className="ml-1 hover:text-red-300">x</button>
                  </span>
                ))}
              </div>
            )}

            <input
              className="w-full bg-surface border border-theme rounded-lg px-4 py-3 text-main focus:outline-none focus:border-blue-500 mb-3"
              placeholder="Search skills..."
              value={skillSearch}
              onChange={e => setSkillSearch(e.target.value)}
            />

            <div className="flex flex-wrap gap-2 mb-4 max-h-48 overflow-y-auto">
              {filteredSkills.map(skill => (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition ${
                    form.skills.includes(skill)
                      ? "bg-blue-600 border-blue-500 text-main"
                      : "bg-surface border-theme text-muted hover:border-gray-500"
                  }`}
                >
                  {skill}
                </button>
              ))}
            </div>

            <div className="flex gap-2 mb-6">
              <input
                className="flex-1 bg-surface border border-theme rounded-lg px-4 py-2 text-main text-sm focus:outline-none focus:border-blue-500"
                placeholder="Add a custom skill..."
                value={customSkill}
                onChange={e => setCustomSkill(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustomSkill()}
              />
              <button
                onClick={addCustomSkill}
                className="bg-gray-800 hover:bg-gray-700 text-main px-4 py-2 rounded-lg text-sm transition"
              >
                Add
              </button>
            </div>

            <div className="flex gap-3">
              <button onClick={back} className="flex-1 border border-theme text-muted px-6 py-3 rounded-lg font-medium hover:border-gray-500 transition">Back</button>
              <button
                onClick={next}
                disabled={(form?.skills?.length ?? 0) === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-main px-6 py-3 rounded-lg font-medium transition"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Target Role */}
        {step === 3 && (
          <div>
            <h2 className="text-2xl font-bold mb-1">Target Role</h2>
            <p className="text-muted mb-8">What kind of job are you aiming for?</p>

            {lockedFields.targetRole ? (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-muted">Current selection</p>
                  <button type="button" onClick={() => setLockedFields(f => ({ ...f, targetRole: false }))} className="text-xs text-blue-400 hover:text-blue-300 transition">Edit</button>
                </div>
                <div className="w-full px-5 py-4 rounded-xl border bg-blue-600/20 border-blue-500 text-main">
                  {form.targetRole}
                </div>
              </div>
            ) : (
              <div className="space-y-3 mb-8">
                {ROLES.map(role => (
                  <button
                    key={role}
                    onClick={() => setForm(f => ({ ...f, targetRole: role }))}
                    className={`w-full text-left px-5 py-4 rounded-xl border transition ${
                      form.targetRole === role
                        ? "bg-blue-600/20 border-blue-500 text-main"
                        : "bg-surface border-theme text-muted hover:border-gray-500"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={back} className="flex-1 border border-theme text-muted px-6 py-3 rounded-lg font-medium hover:border-gray-500 transition">Back</button>
              <button
                onClick={next}
                disabled={!form.targetRole}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-main px-6 py-3 rounded-lg font-medium transition"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Projects & Experience */}
        {step === 4 && (
          <div>
            <h2 className="text-2xl font-bold mb-1">Projects & Experience</h2>
            <p className="text-muted mb-8">Tell us about your practical experience.</p>

            <div className="space-y-6">
              {/* Projects */}
              <div>
                <label className="text-sm text-muted mb-3 block">Projects completed</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["0", "1-2", "3-5", "5+"] as const).map(opt => (
                    <button key={opt} onClick={() => set("projectsCount", opt)} className={optBtn(form.projectsCount === opt)}>
                      {opt === "0" ? "None" : opt === "5+" ? "5 or more" : opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Internship */}
              <div>
                <label className="text-sm text-muted mb-3 block">Any internship experience?</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["yes", "no"] as const).map(opt => (
                    <button
                      key={opt}
                      onClick={() => {
                        set("hasInternship", opt);
                        if (opt === "no") set("internshipMonths", "");
                      }}
                      className={optBtn(form.hasInternship === opt)}
                    >
                      {opt === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Internship months — conditional */}
              {form.hasInternship === "yes" && (
                <div>
                  <label className="text-sm text-muted mb-3 block">How many months total?</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["1-3", "3-6", "6+"] as const).map(opt => (
                      <button key={opt} onClick={() => set("internshipMonths", opt)} className={optBtn(form.internshipMonths === opt)}>
                        {opt} mo
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hackathons */}
              <div>
                <label className="text-sm text-muted mb-3 block">Hackathons participated in</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["0", "1-2", "3+"] as const).map(opt => (
                    <button key={opt} onClick={() => set("hackathons", opt)} className={optBtn(form.hackathons === opt)}>
                      {opt === "0" ? "None" : opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={back} className="flex-1 border border-theme text-muted px-6 py-3 rounded-lg font-medium hover:border-gray-500 transition">Back</button>
              <button
                onClick={next}
                disabled={!step4Valid}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-main px-6 py-3 rounded-lg font-medium transition"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — Competitive Programming & Extras */}
        {step === 5 && (
          <div>
            <h2 className="text-2xl font-bold mb-1">Competitive Programming & Extras</h2>
            <p className="text-muted mb-8">A few more signals to sharpen your score.</p>

            <div className="space-y-6">
              {/* LeetCode */}
              <div>
                <label className="text-sm text-muted mb-3 block">LeetCode problems solved</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["0", "1-50", "51-200", "200+"] as const).map(opt => (
                    <button key={opt} onClick={() => set("leetcodeCount", opt)} className={optBtn(form.leetcodeCount === opt)}>
                      {opt === "0" ? "None" : opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Open source */}
              <div>
                <label className="text-sm text-muted mb-3 block">Open source contributions?</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["yes", "no"] as const).map(opt => (
                    <button key={opt} onClick={() => set("openSource", opt)} className={optBtn(form.openSource === opt)}>
                      {opt === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Certifications */}
              <div>
                <label className="text-sm text-muted mb-3 block">Certifications earned</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["0", "1-2", "3+"] as const).map(opt => (
                    <button key={opt} onClick={() => set("certifications", opt)} className={optBtn(form.certifications === opt)}>
                      {opt === "0" ? "None" : opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* GitHub */}
              <div>
                <label className="text-sm text-muted mb-3 block">Active on GitHub? (regular commits / public repos)</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["yes", "no"] as const).map(opt => (
                    <button key={opt} onClick={() => set("githubActive", opt)} className={optBtn(form.githubActive === opt)}>
                      {opt === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={back} className="flex-1 border border-theme text-muted px-6 py-3 rounded-lg font-medium hover:border-gray-500 transition">Back</button>
              <button
                onClick={submit}
                disabled={!step5Valid || submitting}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-main px-6 py-3 rounded-lg font-medium transition"
              >
                {submitting ? "Saving..." : "Get My Score"}
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
