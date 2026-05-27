"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

const COMPANIES = [
  "TCS", "Infosys", "Wipro", "Cognizant", "Accenture",
  "Amazon", "Microsoft", "Google", "Deloitte", "Capgemini",
  "HCL", "Tech Mahindra", "Zoho", "Freshworks", "Goldman Sachs",
];

const ROUNDS = ["aptitude", "coding", "technical", "hr"];
const ROUND_LABELS: Record<string, string> = {
  aptitude: "Aptitude",
  coding: "Coding",
  technical: "Technical",
  hr: "HR",
};
const OPTION_LABELS = ["A", "B", "C", "D"];

// ── Interview Simulation Types ────────────────────────────────────────────────

type SimAptQ = { id: string; question: string; options: string[]; correct_index: number; explanation: string; topic: string; };
type SimCodingQ = { id: string; title: string; problem: string; constraints: string; example_input: string; example_output: string; model_answer: string; time_complexity: string; space_complexity: string; };
type SimTechQ = { id: string; question: string; type: "mcq" | "open"; options?: string[]; correct_index?: number; explanation: string; topic: string; };
type SimHRQ = { id: string; question: string; what_look_for: string[]; red_flags: string[]; sample_answer: string; };

type SimResult = {
  company: string;
  date: string;
  aptitude_score: number;
  aptitude_total: number;
  coding_self_score: number;
  technical_score: number;
  technical_total: number;
  hr_completed: boolean;
  weak_areas: string[];
};

// ── Simulation Question Bank ─────────────────────────────────────────────────

const APT_QUESTIONS: SimAptQ[] = [
  { id: "a1", question: "Find the next number: 2, 6, 12, 20, 30, ?", options: ["42", "40", "38", "44"], correct_index: 0, explanation: "Differences are 4,6,8,10,12 — so next is 30+12=42.", topic: "Number Series" },
  { id: "a2", question: "A train travels 360 km in 4 hours. What is its speed in m/s?", options: ["25 m/s", "90 m/s", "100 m/s", "30 m/s"], correct_index: 0, explanation: "360km/4h = 90 km/h = 90×(1000/3600) = 25 m/s.", topic: "Time & Distance" },
  { id: "a3", question: "A man can do a job in 15 days. His son can do it in 20 days. Working together, how many days?", options: ["8.57 days", "10 days", "7 days", "12 days"], correct_index: 0, explanation: "Together: 1/15+1/20 = 7/60 per day → 60/7 ≈ 8.57 days.", topic: "Time & Work" },
  { id: "a4", question: "What is the compound interest on Rs 8000 at 10% per annum for 2 years?", options: ["Rs 1680", "Rs 1600", "Rs 1720", "Rs 800"], correct_index: 0, explanation: "CI = 8000[(1.1)² – 1] = 8000×0.21 = Rs 1680.", topic: "Interest" },
  { id: "a5", question: "If COLD = 15, HEAT = 35, then WARM = ?", options: ["55", "50", "45", "60"], correct_index: 0, explanation: "Sum of alphabetical positions: W+A+R+M = 23+1+18+13 = 55.", topic: "Coding/Decoding" },
  { id: "a6", question: "A boat goes 36 km upstream in 9 hrs and 36 km downstream in 6 hrs. Speed of stream?", options: ["1 km/h", "2 km/h", "3 km/h", "4 km/h"], correct_index: 0, explanation: "Upstream=36/9=4 km/h, Downstream=36/6=6 km/h. Stream speed=(6-4)/2=1 km/h.", topic: "Boats & Streams" },
  { id: "a7", question: "All roses are flowers. Some flowers fade quickly. Therefore:", options: ["Cannot be determined", "Some roses fade quickly", "No roses fade quickly", "All flowers are roses"], correct_index: 0, explanation: "We can't determine if roses specifically fade — the connection is indirect.", topic: "Syllogism" },
  { id: "a8", question: "A cistern is filled by pipes A(12 min) and B(15 min). Both opened, after 3 min A closes. Time to fill?", options: ["11.25 min", "10 min", "12 min", "8 min"], correct_index: 0, explanation: "In 3 min, (1/12+1/15)×3 = (9/60)×3 = 27/60 filled. Remaining = 33/60 by B alone = (33/60)×15 = 8.25 min. Total ≈ 11.25 min.", topic: "Pipes & Cisterns" },
  { id: "a9", question: "A is south of B, C is east of B. In which direction is A from C?", options: ["South-West", "South-East", "North-West", "West"], correct_index: 0, explanation: "B is north of A and west of C. So A is south-west of C.", topic: "Directions" },
  { id: "a10", question: "If 3 men or 6 boys do work in 10 days, how many days for 6 men and 8 boys?", options: ["5 days", "4 days", "3 days", "6 days"], correct_index: 1, explanation: "1 man = 2 boys. 6 men+8 boys = 12+8=20 boys. 6 boys in 10 days → 20 boys in 60/20=3 days. So 3 days.", topic: "Time & Work" },
];

const CODING_PROBLEMS: SimCodingQ[] = [
  { id: "c1", title: "Two Sum", problem: "Given an array of integers and a target sum, return the indices of two numbers that add up to the target.", constraints: "Array length 2–10,000. Each input has exactly one solution. Cannot use same element twice.", example_input: "nums = [2,7,11,15], target = 9", example_output: "[0, 1]", model_answer: "Use a hash map: for each number, check if (target - num) exists in the map. If yes, return both indices. If not, add current number with its index to the map.", time_complexity: "O(n)", space_complexity: "O(n)" },
  { id: "c2", title: "Reverse a Linked List", problem: "Given the head of a singly linked list, reverse the list and return the reversed head.", constraints: "Node count: 0 to 5000. Node values: -5000 to 5000.", example_input: "1 → 2 → 3 → 4 → 5", example_output: "5 → 4 → 3 → 2 → 1", model_answer: "Iterative: Use three pointers (prev=null, curr=head, next). In each step: save next=curr.next, set curr.next=prev, move prev=curr, curr=next. Return prev.", time_complexity: "O(n)", space_complexity: "O(1)" },
  { id: "c3", title: "Maximum Subarray (Kadane's Algorithm)", problem: "Find the contiguous subarray within an array which has the largest sum.", constraints: "Array length 1–100,000. Values: -10,000 to 10,000.", example_input: "[-2,1,-3,4,-1,2,1,-5,4]", example_output: "6 (subarray [4,-1,2,1])", model_answer: "Kadane's: Keep track of max_current and max_global. For each element: max_current = max(element, max_current + element). max_global = max(max_global, max_current).", time_complexity: "O(n)", space_complexity: "O(1)" },
];

const TECH_QUESTIONS: SimTechQ[] = [
  { id: "t1", question: "What is the difference between process and thread?", type: "mcq", options: ["Threads share memory; processes have separate memory spaces", "Processes share memory; threads don't", "Both share memory", "Neither shares memory"], correct_index: 0, explanation: "Threads within a process share heap/globals; processes have isolated address spaces. Thread creation is cheaper.", topic: "OS" },
  { id: "t2", question: "What is normalization in DBMS? What is 3NF?", type: "mcq", options: ["Organizing data to reduce redundancy. 3NF: no transitive dependencies on non-key attributes.", "Compressing data. 3NF: all columns are keys.", "Encrypting data. 3NF: no duplicates.", "None of the above"], correct_index: 0, explanation: "Normalization eliminates redundancy. 3NF requires no transitive dependency (A→B→C where B is not a key).", topic: "DBMS" },
  { id: "t3", question: "What is polymorphism in OOP?", type: "mcq", options: ["Same interface behaves differently based on object type (method overloading/overriding)", "Multiple inheritance", "Data hiding", "Abstract classes only"], correct_index: 0, explanation: "Polymorphism means one interface, multiple implementations. Compile-time (overloading) and runtime (overriding).", topic: "OOP" },
  { id: "t4", question: "TCP vs UDP — which one guarantees delivery?", type: "mcq", options: ["TCP", "UDP", "Both", "Neither"], correct_index: 0, explanation: "TCP provides guaranteed delivery via acknowledgements, retransmission, and connection setup. UDP is connectionless and faster but unreliable.", topic: "Networks" },
  { id: "t5", question: "What is the time complexity of QuickSort in the average case?", type: "mcq", options: ["O(n log n)", "O(n²)", "O(n)", "O(log n)"], correct_index: 0, explanation: "QuickSort average is O(n log n) due to good pivot selection. Worst case is O(n²) with bad pivots.", topic: "Algorithms" },
  { id: "t6", question: "What is a deadlock? Name the four Coffman conditions.", type: "mcq", options: ["State where processes wait forever for each other's resources. Conditions: Mutual Exclusion, Hold & Wait, No Preemption, Circular Wait.", "A process that consumes 100% CPU. Conditions: CPU, Memory, I/O, Network.", "Infinite loop. Conditions: None.", "Memory leak."], correct_index: 0, explanation: "Deadlock occurs when circular wait exists. All 4 Coffman conditions must hold simultaneously.", topic: "OS" },
  { id: "t7", question: "Explain the concept of indexing in databases.", type: "mcq", options: ["Data structure (B-tree/hash) for faster query lookup, avoids full table scan", "Numbering rows in order", "Compressing table data", "Creating backups"], correct_index: 0, explanation: "Indexes use B-tree or hash structures to find rows faster. Trade-off: faster reads, slower writes.", topic: "DBMS" },
  { id: "t8", question: "What is the difference between stack and heap memory?", type: "mcq", options: ["Stack: LIFO, function-scoped, auto-freed. Heap: dynamic, manually managed, larger.", "Stack: larger, persists. Heap: small, fast.", "Both are the same.", "Stack stores objects; heap stores primitives."], correct_index: 0, explanation: "Stack holds local variables and call frames (fast, limited). Heap is for dynamic allocation (flexible, needs GC).", topic: "OS/Memory" },
  { id: "t9", question: "What is your understanding of REST API? How does it differ from GraphQL?", type: "open", explanation: "REST uses fixed endpoints per resource (GET /users). GraphQL uses a single endpoint with flexible queries — clients specify exactly what data they need. REST is simpler; GraphQL reduces over/under-fetching.", topic: "Backend" },
  { id: "t10", question: "Explain how you would design a URL shortener like bit.ly (system design basics).", type: "open", explanation: "Key components: URL storage (DB with short_code→long_url mapping), ID generation (base62 encoding of auto-increment ID), redirect service (302 redirect), caching (Redis for popular URLs), analytics (click tracking). Scale: sharded DB, CDN edge.", topic: "System Design" },
];

const HR_QUESTIONS: SimHRQ[] = [
  { id: "h1", question: "Tell me about yourself.", what_look_for: ["Structured 2-minute answer", "Relevant experience and skills", "Why you're interested in this role"], red_flags: ["Reading from a script", "Covering unrelated personal history", "Negative comments about past experiences"], sample_answer: "I'm a final-year CSE student at [College]. I've built [projects], interned at [company], and have strong skills in [skill]. I'm interested in this role because [specific reason]." },
  { id: "h2", question: "Why do you want to work at [company]?", what_look_for: ["Company-specific research", "Alignment with company values/products", "Long-term career fit"], red_flags: ["Generic answer applicable to any company", "Only mentioning salary", "Showing no knowledge of what the company does"], sample_answer: "I've been following [company]'s work in [domain]. I'm particularly excited about [specific product/initiative] because it aligns with my experience in [skill]. I believe I can contribute to [specific area]." },
  { id: "h3", question: "What is your greatest weakness?", what_look_for: ["Self-awareness", "Genuine weakness (not strength disguised)", "Steps taken to improve"], red_flags: ["Saying 'I'm a perfectionist'", "Weakness that is a core job requirement", "No improvement plan mentioned"], sample_answer: "I sometimes take too long on tasks because I want everything to be perfect. I've been working on this by setting time-boxed deadlines for myself — it's helped me ship faster while maintaining quality." },
  { id: "h4", question: "Describe a challenge you faced and how you overcame it.", what_look_for: ["Specific STAR format (Situation, Task, Action, Result)", "Your personal contribution", "Quantified results if possible"], red_flags: ["Vague answer without specifics", "Blaming teammates", "No clear resolution"], sample_answer: "In our capstone project, our backend kept crashing under load. I profiled the queries, found N+1 query issues, and refactored with eager loading — this reduced response time from 3s to 200ms and allowed us to demo successfully." },
  { id: "h5", question: "Where do you see yourself in 5 years?", what_look_for: ["Realistic growth trajectory", "Commitment to the company/field", "Learning and leadership ambitions"], red_flags: ["'I want to start my own company immediately'", "Unrealistic promotions timeline", "No connection to the job being applied for"], sample_answer: "In 5 years, I see myself as a senior engineer with strong expertise in [domain]. I'd like to take on mentorship responsibilities and contribute to architectural decisions. I want to grow within [company] as it scales." },
  { id: "h6", question: "Do you have any questions for us?", what_look_for: ["Thoughtful questions about role/team/growth", "Shows research and genuine interest", "Positive engagement"], red_flags: ["'No, I think you covered everything'", "Only asking about salary/holidays", "Asking something already covered in the JD"], sample_answer: "What does success look like for this role in the first 90 days? What does the engineering team's typical sprint/project cadence look like? What opportunities exist for learning and certifications?" },
];

// ── Company Tips Data ────────────────────────────────────────────────────────

type CompanyTips = {
  what_they_look_for: string[];
  biggest_mistakes: string[];
  day_before_checklist: string[];
  dress_code: string;
};

const COMPANY_TIPS: Record<string, CompanyTips> = {
  "TCS": {
    what_they_look_for: ["Fundamentals of programming (C, Java, or Python)", "Good communication and teamwork", "Positive attitude and willingness to learn"],
    biggest_mistakes: ["Skipping the TCS NQT English section — it has significant weight", "Not preparing for verbal ability questions"],
    day_before_checklist: ["Revise basic aptitude: time-work, percentages, series", "Practice 10 coding questions on TCS CodeVita/PrepInsta", "Keep official ID proof ready", "Charge laptop for virtual interview", "Read TCS values on their website"],
    dress_code: "Formal business attire for in-person; business casual for virtual",
  },
  "Infosys": {
    what_they_look_for: ["Strong logical reasoning and aptitude", "Communication skills (GD/PI round)", "Basic coding ability"],
    biggest_mistakes: ["Underestimating the communication round — it's eliminatory", "Not preparing for the HR round questions"],
    day_before_checklist: ["Practice InfyTQ mock tests", "Prepare STAR answers for 3 behavioral questions", "Review Infosys values: client value, leadership, integrity", "Check dress code instructions in call letter", "Arrange all documents: ID, offer letter printout"],
    dress_code: "Formal — strict. Avoid casual wear.",
  },
  "Amazon": {
    what_they_look_for: ["Leadership Principles in every answer (STAR format)", "Strong Data Structures & Algorithms", "Customer obsession mindset"],
    biggest_mistakes: ["Not knowing Amazon's 16 Leadership Principles", "Giving vague behavioral answers without specific examples"],
    day_before_checklist: ["Review all 16 Leadership Principles", "Prepare 3 stories per principle in STAR format", "Solve 2 medium LC problems", "Review time/space complexity of common algorithms", "Test Chime/Zoom connection for virtual"],
    dress_code: "Business casual — Amazon is relaxed but neat",
  },
  "Microsoft": {
    what_they_look_for: ["Growth mindset and learning agility", "Strong problem-solving with clear communication of approach", "System design for SDE2+ roles"],
    biggest_mistakes: ["Jumping to code without discussing approach first", "Not asking clarifying questions on the problem"],
    day_before_checklist: ["Review graphs, trees, DP problems on LeetCode", "Practice explaining solutions out loud", "Read Microsoft's culture values", "Test Teams for virtual interview", "Prepare 2-3 project descriptions with impact metrics"],
    dress_code: "Smart casual — Microsoft is relaxed",
  },
  "Google": {
    what_they_look_for: ["Googleyness: collaborative, humble, structured thinker", "Strong algorithms and system design", "Clear communication while coding"],
    biggest_mistakes: ["Staying silent while thinking — always narrate your thought process", "Not testing edge cases after writing the solution"],
    day_before_checklist: ["Solve 3 medium-hard LeetCode problems", "Practice thinking out loud for 30 minutes", "Review system design: load balancing, caching, DB sharding", "Get proper lighting and background for virtual", "Rest well — Google interviews are 5+ hours"],
    dress_code: "Casual — T-shirt is fine at Google",
  },
  "Wipro": {
    what_they_look_for: ["Basic programming and aptitude", "Honesty about skills and limitations", "Team player mindset"],
    biggest_mistakes: ["Exaggerating skills — Wipro often technical-tests claimed skills", "Poor communication in the HR round"],
    day_before_checklist: ["Revise basic Java/Python syntax", "Practice 5 easy-medium LeetCode problems", "Prepare honest answers about skills", "Review Wipro's recent projects/CSR initiatives", "Keep certificates of courses/projects ready"],
    dress_code: "Formal business attire",
  },
  "Cognizant": {
    what_they_look_for: ["AMCAT-style aptitude performance", "Basic coding and logical reasoning", "Positive attitude and flexibility"],
    biggest_mistakes: ["Not registering for GenC/GenC Next categories correctly", "Skipping mock AMCAT tests"],
    day_before_checklist: ["Take a full AMCAT mock test", "Revise quant: percentages, profit/loss, series", "Prepare a clear resume with projects", "Review Cognizant's 'Evolving with Velocity' strategy", "Keep all originals + photocopies ready"],
    dress_code: "Formal business attire",
  },
  "Accenture": {
    what_they_look_for: ["Coding ability (basic to intermediate)", "Communication and presentation skills", "Adaptability and client mindset"],
    biggest_mistakes: ["Not preparing for the Cognitive and Technical assessments", "Underestimating the Communication Test — it's used heavily"],
    day_before_checklist: ["Complete Accenture's official mock test", "Practice coding in Java/Python/C++", "Prepare elevator pitch about yourself", "Check accenture.com/careers for latest process", "Review DSA basics: arrays, strings, recursion"],
    dress_code: "Formal business attire",
  },
  "Deloitte": {
    what_they_look_for: ["Analytical reasoning and case problem-solving", "Initiative and leadership examples", "Interest in specific consulting service lines"],
    biggest_mistakes: ["Not researching which Deloitte service line you're interviewing for", "Generic answers not tied to business impact"],
    day_before_checklist: ["Prepare STAR answers: leadership, conflict, failure", "Research Deloitte's service lines (Audit, Consulting, Tax, Advisory)", "Practice a short business case analysis", "Review Deloitte's purpose: 'Making an impact that matters'", "Prepare 3 questions about Deloitte's India projects"],
    dress_code: "Formal business — Deloitte is professional services",
  },
  "Capgemini": {
    what_they_look_for: ["Programming logic and basics", "Problem-solving approach", "Teamwork and communication"],
    biggest_mistakes: ["Not preparing for the Pseudo Code section of the assessment", "Forgetting to bring all certificates for document verification"],
    day_before_checklist: ["Practice Pseudo Code MCQ questions", "Revise basic loops, arrays, sorting in C/Java/Python", "Prepare 'group discussion' practice on a current topic", "Research Capgemini's focus areas: cloud, data, AI", "Keep all mark sheets and certifications ready"],
    dress_code: "Formal business attire",
  },
  "Zoho": {
    what_they_look_for: ["Strong DSA fundamentals and problem-solving", "Self-built projects (they love product thinkers)", "Logical reasoning and pattern recognition"],
    biggest_mistakes: ["Using AI-generated code — Zoho interviewers probe deeply on your own code", "Not being able to explain your project in depth"],
    day_before_checklist: ["Practice 5 coding problems without IDE — Zoho often does written tests", "Deeply understand your own projects", "Revise core CS: arrays, strings, trees, recursion", "Review Zoho's products (CRM, Desk, Books, Mail)", "Prepare to explain your approach clearly on paper"],
    dress_code: "Casual — Zoho is a product company with relaxed culture",
  },
  "Freshworks": {
    what_they_look_for: ["Product mindset and customer empathy", "Clean code and good testing practices", "Enthusiasm for B2B SaaS products"],
    biggest_mistakes: ["Not using the product before the interview — download Freshdesk/Freshsales", "Ignoring system design questions for SDE roles"],
    day_before_checklist: ["Explore Freshdesk or Freshsales free trial", "Prepare to discuss your favorite Freshworks product", "Review REST API concepts", "Solve 3 LeetCode medium problems", "Prepare a question about their tech stack (Rails, React)"],
    dress_code: "Smart casual — Freshworks is modern SaaS culture",
  },
  "HCL": {
    what_they_look_for: ["Basic aptitude and programming skills", "Domain knowledge if applying for technical role", "Flexible mindset for client-facing work"],
    biggest_mistakes: ["Being overly selective about locations — HCL may ask for flexibility", "Not researching HCL's major clients and service areas"],
    day_before_checklist: ["Revise HCL mock aptitude questions", "Review HCL Technologies' service lines", "Prepare answers for 'relocation' and 'shift work' questions", "Test your code editor and camera for online interview", "Keep ID and original documents ready"],
    dress_code: "Formal business attire",
  },
  "Tech Mahindra": {
    what_they_look_for: ["Communication skills (strong emphasis)", "Basic Java/Python/C++ skills", "Interest in telecom/IT services"],
    biggest_mistakes: ["Not preparing for the SHL-style assessment", "Weak English communication — a major filter at Tech M"],
    day_before_checklist: ["Practice SHL verbal reasoning tests", "Review telecom basics if applying for telecom vertical", "Prepare 'why Tech Mahindra' answer with specific research", "Revise basic OOP concepts", "Practice group discussion on a current IT topic"],
    dress_code: "Formal business attire",
  },
  "Goldman Sachs": {
    what_they_look_for: ["Strong quantitative and analytical skills", "Exceptional coding ability (top-tier DSA)", "Commercial awareness and financial markets interest"],
    biggest_mistakes: ["Not reading financial news — interviewers test market awareness", "Weak performance on Hackerrank assessment (they set a high bar)"],
    day_before_checklist: ["Read WSJ/ET Markets for 30 minutes", "Solve 3 hard LeetCode problems", "Review dynamic programming, graphs, and math problems", "Prepare 'why finance/fintech' narrative", "Review GS values: partnership, client service, excellence"],
    dress_code: "Business formal — financial services culture",
  },
};

// ── Sourced Data Types ─────────────────────────────────────────────────────────

type SourcedQuestion = {
  question: string;
  difficulty: string;
  topic: string;
  source_url: string;
  source_name: string;
  year: number;
  verified: boolean;
};

type SourcedRound = {
  topics: string[];
  exam_pattern: string;
  questions: SourcedQuestion[];
};

type SourcedData = {
  company: string;
  key_topics: string[];
  data_source: string;
  rounds: Record<string, SourcedRound>;
  found: boolean;
};

// ── Quiz Types ─────────────────────────────────────────────────────────────────

type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard";
};

type AnswerRecord = {
  selected: number | null;
  status: "correct" | "wrong" | "skipped";
};

type BestScore = {
  company: string;
  score: number;
  total: number;
  percentage: number;
  timed: boolean;
  date: string;
};

// ── Badge helpers ──────────────────────────────────────────────────────────────

function difficultyBadge(d: string) {
  if (d === "Easy") return "bg-green-500/15 text-green-400 border-green-500/30";
  if (d === "Hard") return "bg-red-500/15 text-red-400 border-red-500/30";
  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
}

// ── LocalStorage helpers ───────────────────────────────────────────────────────

function loadBestScores(): Record<string, BestScore> {
  try {
    const raw = localStorage.getItem("placeiq_pyq_scores");
    if (!raw) return {};
    const arr: BestScore[] = JSON.parse(raw);
    const map: Record<string, BestScore> = {};
    for (const s of arr) {
      if (!map[s.company] || s.percentage > map[s.company].percentage) map[s.company] = s;
    }
    return map;
  } catch { return {}; }
}

function saveBestScore(score: BestScore) {
  try {
    const raw = localStorage.getItem("placeiq_pyq_scores");
    const arr: BestScore[] = raw ? JSON.parse(raw) : [];
    const idx = arr.findIndex(s => s.company === score.company);
    if (idx >= 0) { if (score.percentage > arr[idx].percentage) arr[idx] = score; } else arr.push(score);
    localStorage.setItem("placeiq_pyq_scores", JSON.stringify(arr));
  } catch {}
}

function formatSeconds(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PYQPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Browse sourced state
  const [company, setCompany] = useState("TCS");
  const [companySearch, setCompanySearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeRound, setActiveRound] = useState("aptitude");
  const [sourcedData, setSourcedData] = useState<SourcedData | null>(null);
  const [sourcedLoading, setSourcedLoading] = useState(false);
  const [sourcedError, setSourcedError] = useState("");

  // Quiz state
  const [mode, setMode] = useState<"browse" | "quiz_config" | "quiz" | "results" | "review">("browse");
  const [quizCompany, setQuizCompany] = useState("TCS");
  const [quizCompanySearch, setQuizCompanySearch] = useState("");
  const [showQuizDropdown, setShowQuizDropdown] = useState(false);
  const [quizTimed, setQuizTimed] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, AnswerRecord>>({});
  const [showAnswer, setShowAnswer] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(60);
  const [quizStartTime, setQuizStartTime] = useState<Date | null>(null);
  const [quizEndTime, setQuizEndTime] = useState<Date | null>(null);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [bestScores, setBestScores] = useState<Record<string, BestScore>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Interview Simulation State ────────────────────────────────────────────
  const [simPhase, setSimPhase] = useState<"idle" | "r1" | "r1_result" | "r2" | "r2_result" | "r3" | "r3_result" | "r4" | "r4_result" | "summary">("idle");
  const [simCompany, setSimCompany] = useState("");
  const [simTimeLeft, setSimTimeLeft] = useState(0);
  const simTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Round 1 (Aptitude)
  const [r1Index, setR1Index] = useState(0);
  const [r1Answers, setR1Answers] = useState<Record<number, number | null>>({});
  const [r1Submitted, setR1Submitted] = useState(false);

  // Round 2 (Coding)
  const [r2Index, setR2Index] = useState(0);
  const [r2Approaches, setR2Approaches] = useState<string[]>(["", "", ""]);
  const [r2SelfScores, setR2SelfScores] = useState<(number | null)[]>([null, null, null]);
  const [r2Revealed, setR2Revealed] = useState<boolean[]>([false, false, false]);

  // Round 3 (Technical)
  const [r3Index, setR3Index] = useState(0);
  const [r3Answers, setR3Answers] = useState<Record<number, number | string | null>>({});
  const [r3Submitted, setR3Submitted] = useState(false);

  // Round 4 (HR)
  const [r4Index, setR4Index] = useState(0);
  const [r4Answers, setR4Answers] = useState<string[]>(["", "", "", "", "", ""]);
  const [r4TipsOpen, setR4TipsOpen] = useState<boolean[]>([false, false, false, false, false, false]);
  const [r4Done, setR4Done] = useState(false);

  // Summary
  const [pastSimulations, setPastSimulations] = useState<SimResult[]>([]);
  const [showPastSims, setShowPastSims] = useState(false);

  // Quick Tips
  const [showTips, setShowTips] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    setBestScores(loadBestScores());
    try {
      const raw = localStorage.getItem("placeiq_interview_simulations");
      if (raw) setPastSimulations(JSON.parse(raw));
    } catch {}
  }, []);

  // Simulation round timer
  useEffect(() => {
    if (simTimerRef.current) clearInterval(simTimerRef.current);
    if (simPhase === "r1" || simPhase === "r2" || simPhase === "r3" || simPhase === "r4") {
      simTimerRef.current = setInterval(() => {
        setSimTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(simTimerRef.current!);
            if (simPhase === "r1") setR1Submitted(true);
            if (simPhase === "r2") setSimPhase("r2_result");
            if (simPhase === "r3") setR3Submitted(true);
            if (simPhase === "r4") setR4Done(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (simTimerRef.current) clearInterval(simTimerRef.current!); };
  }, [simPhase]);

  // Fetch sourced data when company changes
  useEffect(() => {
    if (!company) return;
    setSourcedData(null);
    setSourcedError("");
    setSourcedLoading(true);
    fetch(`${config.apiUrl}/api/pyq/sourced/${encodeURIComponent(company)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setSourcedData(data); else setSourcedError("No data found for this company."); })
      .catch(() => setSourcedError("Could not load data — check backend."))
      .finally(() => setSourcedLoading(false));
  }, [company]);

  useEffect(() => {
    if (!showDropdown) return;
    const close = () => setShowDropdown(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showDropdown]);

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "quiz" || !quizTimed || showAnswer) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setAnswers(a => ({ ...a, [currentIndex]: { selected: null, status: "wrong" } }));
          setSelectedAnswer(null);
          setShowAnswer(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [mode, quizTimed, showAnswer, currentIndex]);

  // ── Quiz flow ──────────────────────────────────────────────────────────────
  async function startQuiz() {
    setLoadingQuiz(true);
    setQuizError("");
    try {
      const res = await fetch(`${config.apiUrl}/api/pyq/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: quizCompany }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const qs: QuizQuestion[] = data.questions || [];
      if (qs.length === 0) throw new Error("No questions returned");
      setQuizQuestions(qs);
      setCurrentIndex(0);
      setAnswers({});
      setShowAnswer(false);
      setSelectedAnswer(null);
      setTimeLeft(60);
      setQuizStartTime(new Date());
      setQuizEndTime(null);
      setMode("quiz");
    } catch (e: unknown) {
      setQuizError(e instanceof Error ? e.message : "Failed to load quiz");
    } finally {
      setLoadingQuiz(false);
    }
  }

  function handleAnswer(optionIdx: number) {
    if (showAnswer) return;
    clearInterval(timerRef.current!);
    const correct = quizQuestions[currentIndex].correct_index === optionIdx;
    setSelectedAnswer(optionIdx);
    setAnswers(a => ({ ...a, [currentIndex]: { selected: optionIdx, status: correct ? "correct" : "wrong" } }));
    setShowAnswer(true);
  }

  function handleSkip() {
    if (showAnswer) return;
    clearInterval(timerRef.current!);
    setAnswers(a => ({ ...a, [currentIndex]: { selected: null, status: "skipped" } }));
    setShowAnswer(true);
    setSelectedAnswer(null);
  }

  function nextQuestion() {
    if (currentIndex >= quizQuestions.length - 1) { finishQuiz(); return; }
    setCurrentIndex(i => i + 1);
    setShowAnswer(false);
    setSelectedAnswer(null);
    setTimeLeft(60);
  }

  function finishQuiz() {
    const endTime = new Date();
    setQuizEndTime(endTime);
    const correct = Object.values(answers).filter(a => a.status === "correct").length;
    const total = quizQuestions.length;
    const pct = Math.round((correct / total) * 100);
    saveBestScore({ company: quizCompany, score: correct, total, percentage: pct, timed: quizTimed, date: new Date().toISOString() });
    setBestScores(loadBestScores());
    setMode("results");
  }

  function retakeQuiz() {
    const shuffled = [...quizQuestions].sort(() => Math.random() - 0.5);
    setQuizQuestions(shuffled);
    setCurrentIndex(0);
    setAnswers({});
    setShowAnswer(false);
    setSelectedAnswer(null);
    setTimeLeft(60);
    setQuizStartTime(new Date());
    setQuizEndTime(null);
    setMode("quiz");
  }

  function startSimulation(co: string) {
    setSimCompany(co);
    setR1Index(0); setR1Answers({}); setR1Submitted(false);
    setR2Index(0); setR2Approaches(["","",""]); setR2SelfScores([null,null,null]); setR2Revealed([false,false,false]);
    setR3Index(0); setR3Answers({}); setR3Submitted(false);
    setR4Index(0); setR4Answers(["","","","","",""]); setR4TipsOpen([false,false,false,false,false,false]); setR4Done(false);
    setSimTimeLeft(15 * 60);
    setSimPhase("r1");
  }

  function finishSimulation() {
    const r1Correct = APT_QUESTIONS.filter((q, i) => r1Answers[i] === q.correct_index).length;
    const r2SelfTotal = r2SelfScores.reduce((a: number, b) => a + (b ?? 0), 0);
    const r3Correct = TECH_QUESTIONS.filter((q, i) => q.type === "mcq" && r3Answers[i] === q.correct_index).length;
    const r3Total = TECH_QUESTIONS.filter(q => q.type === "mcq").length;
    const weak: string[] = [];
    APT_QUESTIONS.forEach((q, i) => { if (r1Answers[i] !== q.correct_index) weak.push(q.topic); });
    TECH_QUESTIONS.forEach((q, i) => { if (q.type === "mcq" && r3Answers[i] !== q.correct_index) weak.push(q.topic); });
    const result: SimResult = {
      company: simCompany,
      date: new Date().toISOString(),
      aptitude_score: r1Correct,
      aptitude_total: APT_QUESTIONS.length,
      coding_self_score: r2SelfTotal,
      technical_score: r3Correct,
      technical_total: r3Total,
      hr_completed: true,
      weak_areas: [...new Set(weak)].slice(0, 5),
    };
    const updated = [result, ...pastSimulations].slice(0, 10);
    setPastSimulations(updated);
    try { localStorage.setItem("placeiq_interview_simulations", JSON.stringify(updated)); } catch {}
    setSimPhase("summary");
  }

  function formatSimTime(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  const correctCount = Object.values(answers).filter(a => a.status === "correct").length;
  const wrongCount = Object.values(answers).filter(a => a.status === "wrong").length;
  const skippedCount = Object.values(answers).filter(a => a.status === "skipped").length;
  const totalQuestions = quizQuestions.length;
  const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const timeTaken = quizStartTime && quizEndTime ? Math.round((quizEndTime.getTime() - quizStartTime.getTime()) / 1000) : 0;
  const filteredQuizCompanies = COMPANIES.filter(c => c.toLowerCase().includes(quizCompanySearch.toLowerCase()));
  const filteredCompanies = COMPANIES.filter(c => c.toLowerCase().includes(companySearch.toLowerCase()));

  if (status === "loading") return <LoadingScreen />;

  // ── Results screen ─────────────────────────────────────────────────────────
  if (mode === "results") {
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-white">
        <div className="max-w-2xl mx-auto px-8 py-16 text-center">
          <div className="mb-6">
            <p className="text-gray-500 text-sm mb-2 uppercase tracking-widest">{quizCompany} Quiz</p>
            <h2 className="text-3xl font-bold mb-1">Quiz Complete!</h2>
          </div>
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-10 mb-6">
            <p className="text-7xl font-bold text-blue-400 mb-2">{scorePercentage}%</p>
            <p className="text-gray-400 text-lg mb-1">{correctCount} out of {totalQuestions} correct</p>
            {quizTimed && quizStartTime && quizEndTime && (
              <p className="text-gray-600 text-sm">Time taken: {formatSeconds(timeTaken)}</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-5">
              <p className="text-3xl font-bold text-green-400">{correctCount}</p>
              <p className="text-sm text-gray-500 mt-1">Correct</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
              <p className="text-3xl font-bold text-red-400">{wrongCount}</p>
              <p className="text-sm text-gray-500 mt-1">Wrong</p>
            </div>
            <div className="bg-gray-700/20 border border-gray-700/30 rounded-xl p-5">
              <p className="text-3xl font-bold text-gray-400">{skippedCount}</p>
              <p className="text-sm text-gray-500 mt-1">Skipped</p>
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={() => setMode("review")} className="px-6 py-3 bg-[#111] border border-gray-700 text-white rounded-xl text-sm font-medium hover:border-gray-500 transition">See Answers</button>
            <button onClick={retakeQuiz} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Retake Quiz</button>
            <button onClick={() => setMode("browse")} className="px-6 py-3 bg-[#111] border border-gray-700 text-white rounded-xl text-sm font-medium hover:border-gray-500 transition">Back to Browse</button>
          </div>
        </div>
      </main>
    );
  }

  // ── Review screen ──────────────────────────────────────────────────────────
  if (mode === "review") {
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-white">
        <div className="max-w-2xl mx-auto px-8 py-10">
          <div className="flex items-center gap-4 mb-8">
            <button onClick={() => setMode("results")} className="text-gray-500 hover:text-gray-300 text-sm transition">← Back to Results</button>
            <h2 className="text-2xl font-bold">Answer Review — {quizCompany}</h2>
          </div>
          <div className="space-y-6">
            {quizQuestions.map((q, i) => {
              const ans = answers[i];
              const st = ans?.status ?? "skipped";
              return (
                <div key={q.id} className="bg-[#111] border border-gray-800 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-gray-500 text-sm font-mono">Q{i + 1}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st === "correct" ? "bg-green-500/20 text-green-400" : st === "skipped" ? "bg-gray-600/20 text-gray-400" : "bg-red-500/20 text-red-400"}`}>
                      {st === "correct" ? "✓ Correct" : st === "skipped" ? "— Skipped" : "✗ Wrong"}
                    </span>
                    <span className="text-xs text-gray-600 ml-auto">{q.topic}</span>
                  </div>
                  <p className="text-white font-medium mb-4 leading-relaxed">{q.question}</p>
                  <div className="space-y-2 mb-4">
                    {q.options.map((opt, idx) => {
                      const isCorrect = idx === q.correct_index;
                      const wasSelected = ans?.selected === idx;
                      return (
                        <div key={idx} className={`rounded-xl p-3 text-sm border ${isCorrect ? "border-green-500 bg-green-500/10 text-green-300" : wasSelected && !isCorrect ? "border-red-500 bg-red-500/10 text-red-300" : "border-gray-800 text-gray-400"}`}>
                          <span className="font-mono mr-2">{OPTION_LABELS[idx]}.</span>{opt}
                          {isCorrect && <span className="ml-2 text-green-500">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
                    <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">Explanation</p>
                    <p className="text-gray-300 text-sm leading-relaxed">{q.explanation}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    );
  }

  // ── Quiz question screen ───────────────────────────────────────────────────
  if (mode === "quiz") {
    const currentQ = quizQuestions[currentIndex];
    const progress = (currentIndex / totalQuestions) * 100;
    const isLastQuestion = currentIndex === totalQuestions - 1;
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-white">
        <div className="max-w-2xl mx-auto px-8 py-10">
          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-8 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-gray-500 text-sm">Question <span className="text-white font-semibold">{currentIndex + 1}</span> of {totalQuestions}</p>
              <p className="text-xs text-gray-600 mt-0.5">{quizCompany} · {currentQ.topic}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${difficultyBadge(currentQ.difficulty)}`}>{currentQ.difficulty}</span>
              {quizTimed && <span className={`text-lg font-mono font-bold tabular-nums ${timeLeft <= 10 ? "text-red-400" : "text-gray-400"}`}>{timeLeft}s</span>}
            </div>
          </div>
          <h2 className="text-xl font-semibold leading-relaxed mb-8 text-white">{currentQ.question}</h2>
          <div className="space-y-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              const isCorrect = idx === currentQ.correct_index;
              const wasSelected = selectedAnswer === idx;
              let cls = "bg-[#111] border border-gray-800 text-gray-200 hover:border-blue-500 cursor-pointer";
              if (showAnswer) {
                if (isCorrect) cls = "border-green-500 bg-green-500/10 text-green-300 cursor-default";
                else if (wasSelected) cls = "border-red-500 bg-red-500/10 text-red-300 cursor-default";
                else cls = "border-gray-800 bg-[#111] text-gray-500 cursor-default opacity-60";
              }
              return (
                <button key={idx} onClick={() => handleAnswer(idx)} disabled={showAnswer} className={`w-full rounded-xl p-4 text-left transition text-sm ${cls}`}>
                  <span className={`font-mono mr-3 ${showAnswer && isCorrect ? "text-green-400" : "text-gray-500"}`}>{OPTION_LABELS[idx]}.</span>
                  {opt}
                </button>
              );
            })}
          </div>
          {showAnswer && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 mb-6">
              <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">Explanation</p>
              <p className="text-gray-300 text-sm leading-relaxed">{currentQ.explanation}</p>
            </div>
          )}
          <div className="flex items-center gap-4">
            {!showAnswer && <button onClick={handleSkip} className="text-gray-500 hover:text-gray-300 text-sm transition">Skip →</button>}
            {showAnswer && (
              <button onClick={nextQuestion} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">
                {isLastQuestion ? "See Results →" : "Next Question →"}
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ── Interview Simulation Renders ───────────────────────────────────────────
  if (simPhase !== "idle") {
    const r1Correct = APT_QUESTIONS.filter((q, i) => r1Answers[i] === q.correct_index).length;
    const r3Total = TECH_QUESTIONS.filter(q => q.type === "mcq").length;
    const r3Correct = TECH_QUESTIONS.filter((q, i) => q.type === "mcq" && r3Answers[i] === q.correct_index).length;

    // ── Summary ──────────────────────────────────────────────────────────────
    if (simPhase === "summary") {
      const readiness = Math.round(((r1Correct / APT_QUESTIONS.length) * 50) + ((r3Correct / r3Total) * 50));
      const weak: string[] = [];
      APT_QUESTIONS.forEach((q, i) => { if (r1Answers[i] !== q.correct_index) weak.push(q.topic); });
      TECH_QUESTIONS.forEach((q, i) => { if (q.type === "mcq" && r3Answers[i] !== q.correct_index) weak.push(q.topic); });
      const weakUniq = [...new Set(weak)].slice(0, 5);
      const aptColor = r1Correct >= 7 ? "text-green-400" : r1Correct >= 5 ? "text-yellow-400" : "text-red-400";
      const techColor = r3Correct >= 6 ? "text-green-400" : r3Correct >= 4 ? "text-yellow-400" : "text-red-400";
      return (
        <main className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
          <div className="max-w-xl w-full">
            <h2 className="text-2xl font-bold text-center mb-1">Interview Complete</h2>
            <p className="text-center text-gray-500 mb-6 text-sm">{simCompany} · {new Date().toLocaleDateString("en-IN")}</p>
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 space-y-3 mb-6">
              <div className="flex justify-between items-center"><span className="text-gray-400 text-sm">Aptitude (Round 1)</span><span className={`font-bold ${aptColor}`}>{r1Correct}/{APT_QUESTIONS.length}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400 text-sm">Coding (Round 2)</span><span className="font-bold text-blue-400">{r2SelfScores.map((s, i) => `Q${i+1}: ${s ?? "–"}/5`).join(", ")}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400 text-sm">Technical (Round 3)</span><span className={`font-bold ${techColor}`}>{r3Correct}/{r3Total}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400 text-sm">HR (Round 4)</span><span className="font-bold text-green-400">Completed ✓</span></div>
              <div className="border-t border-gray-800 pt-3 flex justify-between items-center">
                <span className="text-gray-300 font-medium">Overall Readiness</span>
                <span className={`text-xl font-bold ${readiness >= 70 ? "text-green-400" : readiness >= 50 ? "text-yellow-400" : "text-red-400"}`}>{readiness}%</span>
              </div>
            </div>
            {weakUniq.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                <p className="text-xs text-red-400 font-semibold uppercase mb-2">Weak Areas to Focus On</p>
                <div className="flex flex-wrap gap-2">{weakUniq.map(w => <span key={w} className="text-xs bg-red-500/10 border border-red-500/20 text-red-300 px-2 py-0.5 rounded">{w}</span>)}</div>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={() => startSimulation(simCompany)} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Retry this company</button>
              <button onClick={() => setSimPhase("idle")} className="px-5 py-2.5 bg-[#111] border border-gray-700 text-white rounded-xl text-sm font-medium hover:border-gray-500 transition">Try another company</button>
            </div>
          </div>
        </main>
      );
    }

    // Round transition screens
    if (simPhase === "r1_result") {
      const wrong = APT_QUESTIONS.map((q, i) => r1Answers[i] !== q.correct_index ? q : null).filter(Boolean) as SimAptQ[];
      return (
        <main className="min-h-screen bg-[#0a0a0a] text-white">
          <div className="max-w-2xl mx-auto px-6 py-10">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-1">Round 1 Complete — Aptitude</h2>
              <p className="text-3xl font-bold text-blue-400 my-3">{r1Correct}/{APT_QUESTIONS.length}</p>
              <p className={`text-sm font-medium ${r1Correct >= 7 ? "text-green-400" : r1Correct >= 5 ? "text-yellow-400" : "text-red-400"}`}>
                {r1Correct >= 7 ? "Excellent!" : r1Correct >= 5 ? "Good effort" : "Needs improvement"}
              </p>
            </div>
            {wrong.length > 0 && (
              <div className="space-y-3 mb-8">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Questions you got wrong:</p>
                {wrong.map((q, i) => (
                  <div key={q.id} className="bg-[#111] border border-red-800/30 rounded-xl p-4">
                    <p className="text-sm text-white mb-2 font-medium">{q.question}</p>
                    <p className="text-xs text-green-400 mb-1">Correct: {q.options[q.correct_index]}</p>
                    <p className="text-xs text-gray-500">{q.explanation}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={() => { setSimTimeLeft(30 * 60); setSimPhase("r2"); }} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Continue to Round 2: Coding →</button>
            </div>
          </div>
        </main>
      );
    }

    if (simPhase === "r2_result") {
      return (
        <main className="min-h-screen bg-[#0a0a0a] text-white">
          <div className="max-w-2xl mx-auto px-6 py-10 text-center">
            <h2 className="text-2xl font-bold mb-1">Round 2 Complete — Coding</h2>
            <p className="text-gray-400 text-sm mb-6">Self-assessed scores: {r2SelfScores.map((s, i) => `Q${i+1}: ${s ?? "–"}/5`).join(" · ")}</p>
            <button onClick={() => { setSimTimeLeft(25 * 60); setSimPhase("r3"); }} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Continue to Round 3: Technical →</button>
          </div>
        </main>
      );
    }

    if (simPhase === "r3_result") {
      return (
        <main className="min-h-screen bg-[#0a0a0a] text-white">
          <div className="max-w-2xl mx-auto px-6 py-10 text-center">
            <h2 className="text-2xl font-bold mb-1">Round 3 Complete — Technical</h2>
            <p className="text-3xl font-bold text-blue-400 my-3">{r3Correct}/{r3Total}</p>
            <button onClick={() => { setSimTimeLeft(20 * 60); setSimPhase("r4"); }} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Continue to Round 4: HR →</button>
          </div>
        </main>
      );
    }

    if (simPhase === "r4_result") {
      return (
        <main className="min-h-screen bg-[#0a0a0a] text-white">
          <div className="max-w-2xl mx-auto px-6 py-10 text-center">
            <h2 className="text-2xl font-bold mb-1">Round 4 Complete — HR</h2>
            <p className="text-gray-400 text-sm mb-6">Review your answers and the tips provided.</p>
            <button onClick={finishSimulation} className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition">See Final Summary →</button>
          </div>
        </main>
      );
    }

    // ── Round 1: Aptitude ────────────────────────────────────────────────────
    if (simPhase === "r1") {
      const q = APT_QUESTIONS[r1Index];
      const isLast = r1Index === APT_QUESTIONS.length - 1;
      if (r1Submitted) {
        const correct = APT_QUESTIONS.filter((q, i) => r1Answers[i] === q.correct_index).length;
        const progress = ((r1Index + 1) / APT_QUESTIONS.length) * 100;
        void correct;
        return (
          <main className="fixed inset-0 bg-[#0a0a0a] z-50 overflow-auto text-white">
            <div className="max-w-2xl mx-auto px-6 py-10">
              <div className="flex items-center justify-between mb-6">
                <div><p className="text-xs text-gray-500 uppercase tracking-widest">Round 1 — Aptitude</p><h3 className="text-lg font-bold">{simCompany} Interview</h3></div>
                <span className="text-red-400 font-mono font-bold text-lg">{formatSimTime(simTimeLeft)}</span>
              </div>
              <div className="w-full bg-gray-800 h-1.5 rounded-full mb-6"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${progress}%` }} /></div>
              <p className="text-xs text-gray-500 mb-1">Q{r1Index + 1}/{APT_QUESTIONS.length} — {q.topic}</p>
              <p className="text-white font-medium text-base leading-relaxed mb-5">{q.question}</p>
              <div className="space-y-3 mb-6">
                {q.options.map((opt, idx) => {
                  const isCorrect = idx === q.correct_index;
                  const wasSelected = r1Answers[r1Index] === idx;
                  return (
                    <div key={idx} className={`rounded-xl p-3.5 text-sm border ${isCorrect ? "border-green-500 bg-green-500/10 text-green-300" : wasSelected ? "border-red-500 bg-red-500/10 text-red-300" : "border-gray-800 text-gray-400"}`}>
                      <span className="font-mono mr-2 text-gray-500">{OPTION_LABELS[idx]}.</span>{opt}
                      {isCorrect && <span className="ml-2 text-green-400 text-xs">✓ Correct</span>}
                    </div>
                  );
                })}
              </div>
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 mb-6">
                <p className="text-xs text-blue-400 uppercase mb-1">Explanation</p>
                <p className="text-sm text-gray-300">{q.explanation}</p>
              </div>
              <div className="flex gap-3">
                {r1Index > 0 && <button onClick={() => setR1Index(i => i - 1)} className="px-4 py-2.5 border border-gray-700 text-gray-400 rounded-xl text-sm hover:border-gray-500 transition">← Back</button>}
                {!isLast ? (
                  <button onClick={() => setR1Index(i => i + 1)} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Next →</button>
                ) : (
                  <button onClick={() => { clearInterval(simTimerRef.current!); setSimPhase("r1_result"); }} className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition">See Results →</button>
                )}
              </div>
            </div>
          </main>
        );
      }
      const progress = (r1Index / APT_QUESTIONS.length) * 100;
      return (
        <main className="fixed inset-0 bg-[#0a0a0a] z-50 overflow-auto text-white">
          <div className="max-w-2xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-6">
              <div><p className="text-xs text-gray-500 uppercase tracking-widest">Round 1 — Aptitude (15 min)</p><h3 className="text-lg font-bold">{simCompany} Interview</h3></div>
              <span className={`font-mono font-bold text-lg ${simTimeLeft < 120 ? "text-red-400" : "text-gray-400"}`}>{formatSimTime(simTimeLeft)}</span>
            </div>
            <div className="w-full bg-gray-800 h-1.5 rounded-full mb-6"><div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
            <p className="text-xs text-gray-500 mb-1">Q{r1Index + 1}/{APT_QUESTIONS.length} — {q.topic}</p>
            <p className="text-white font-medium text-base leading-relaxed mb-5">{q.question}</p>
            <div className="space-y-3 mb-6">
              {q.options.map((opt, idx) => (
                <button key={idx} onClick={() => setR1Answers(prev => ({ ...prev, [r1Index]: idx }))}
                  className={`w-full rounded-xl p-3.5 text-sm text-left border transition ${r1Answers[r1Index] === idx ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-gray-800 bg-[#111] text-gray-300 hover:border-blue-500/50"}`}>
                  <span className="font-mono mr-2 text-gray-500">{OPTION_LABELS[idx]}.</span>{opt}
                </button>
              ))}
            </div>
            <div className="flex gap-3 items-center">
              {r1Index > 0 && <button onClick={() => setR1Index(i => i - 1)} className="px-4 py-2.5 border border-gray-700 text-gray-400 rounded-xl text-sm hover:border-gray-500 transition">← Back</button>}
              {!isLast ? (
                <button onClick={() => setR1Index(i => i + 1)} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Next →</button>
              ) : (
                <button onClick={() => { clearInterval(simTimerRef.current!); setR1Submitted(true); setSimPhase("r1"); }} className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition">Submit Round 1</button>
              )}
            </div>
          </div>
        </main>
      );
    }

    // ── Round 2: Coding ──────────────────────────────────────────────────────
    if (simPhase === "r2") {
      const cp = CODING_PROBLEMS[r2Index];
      const selfScore = r2SelfScores[r2Index];
      const revealed = r2Revealed[r2Index];
      return (
        <main className="fixed inset-0 bg-[#0a0a0a] z-50 overflow-auto text-white">
          <div className="max-w-2xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-4">
              <div><p className="text-xs text-gray-500 uppercase tracking-widest">Round 2 — Coding (30 min)</p><h3 className="text-lg font-bold">{simCompany}</h3></div>
              <span className={`font-mono font-bold text-lg ${simTimeLeft < 300 ? "text-red-400" : "text-gray-400"}`}>{formatSimTime(simTimeLeft)}</span>
            </div>
            <div className="bg-[#111] border border-gray-800 rounded-xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-2"><span className="text-xs text-gray-500">Problem {r2Index + 1}/3</span><span className="font-semibold text-white">{cp.title}</span></div>
              <p className="text-sm text-gray-300 mb-3 leading-relaxed">{cp.problem}</p>
              <p className="text-xs text-gray-500 mb-2"><span className="text-gray-400">Constraints:</span> {cp.constraints}</p>
              <div className="bg-[#0d1117] rounded-lg p-3 text-xs font-mono">
                <p className="text-gray-500 mb-1">Input: <span className="text-green-400">{cp.example_input}</span></p>
                <p className="text-gray-500">Output: <span className="text-green-400">{cp.example_output}</span></p>
              </div>
            </div>
            {!revealed ? (
              <>
                <label className="block text-xs text-gray-500 mb-2 uppercase tracking-widest">Your approach / pseudocode</label>
                <textarea
                  value={r2Approaches[r2Index]}
                  onChange={e => { const a = [...r2Approaches]; a[r2Index] = e.target.value; setR2Approaches(a); }}
                  className="w-full bg-[#0d1117] text-green-400 font-mono border border-gray-700 rounded-lg p-4 h-40 text-sm resize-none focus:outline-none focus:border-green-500"
                  placeholder="Write your approach or pseudocode here..."
                />
                <div className="mt-3 mb-4">
                  <p className="text-xs text-gray-500 mb-2">Self-assess your approach (1 = very unsure, 5 = confident):</p>
                  <div className="flex gap-2">
                    {[1,2,3,4,5].map(n => (
                      <button key={n} onClick={() => { const s = [...r2SelfScores]; s[r2Index] = n; setR2SelfScores(s); }}
                        className={`w-10 h-10 rounded-lg border text-sm font-bold transition ${r2SelfScores[r2Index] === n ? "bg-blue-600 border-blue-500 text-white" : "bg-[#111] border-gray-700 text-gray-400 hover:border-gray-500"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => { const r = [...r2Revealed]; r[r2Index] = true; setR2Revealed(r); }} className="text-sm text-blue-400 hover:text-blue-300 transition">See model answer →</button>
              </>
            ) : (
              <div className="bg-[#111] border border-gray-800 rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Model Answer</p>
                <p className="text-sm text-gray-200 leading-relaxed mb-3">{cp.model_answer}</p>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>Time: <span className="text-blue-400">{cp.time_complexity}</span></span>
                  <span>Space: <span className="text-blue-400">{cp.space_complexity}</span></span>
                </div>
              </div>
            )}
            <div className="flex gap-3 mt-4">
              {r2Index > 0 && <button onClick={() => setR2Index(i => i - 1)} className="px-4 py-2.5 border border-gray-700 text-gray-400 rounded-xl text-sm hover:border-gray-500 transition">← Back</button>}
              {r2Index < CODING_PROBLEMS.length - 1 ? (
                <button onClick={() => setR2Index(i => i + 1)} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Next Problem →</button>
              ) : (
                <button onClick={() => { clearInterval(simTimerRef.current!); setSimPhase("r2_result"); }} className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition">Submit Round 2</button>
              )}
            </div>
          </div>
        </main>
      );
    }

    // ── Round 3: Technical ───────────────────────────────────────────────────
    if (simPhase === "r3") {
      const q = TECH_QUESTIONS[r3Index];
      const isLast = r3Index === TECH_QUESTIONS.length - 1;
      if (r3Submitted) {
        return (
          <main className="fixed inset-0 bg-[#0a0a0a] z-50 overflow-auto text-white">
            <div className="max-w-2xl mx-auto px-6 py-10">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold">Round 3 — Technical (Review)</h3>
                <button onClick={() => { clearInterval(simTimerRef.current!); setSimPhase("r3_result"); }} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm transition">Submit</button>
              </div>
              <div className="space-y-4">
                {TECH_QUESTIONS.map((tq, i) => (
                  <div key={tq.id} className="bg-[#111] border border-gray-800 rounded-xl p-4">
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{tq.topic}</span>
                      <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">{tq.type === "mcq" ? "MCQ" : "Short Answer"}</span>
                      {tq.type === "mcq" && (
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${r3Answers[i] === tq.correct_index ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"}`}>
                          {r3Answers[i] === tq.correct_index ? "✓ Correct" : "✗ Wrong"}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white mb-2">{tq.question}</p>
                    {tq.type === "mcq" && tq.options && (
                      <div className="space-y-1 mb-2">
                        {tq.options.map((opt, idx) => (
                          <div key={idx} className={`text-xs px-3 py-1.5 rounded-lg border ${idx === tq.correct_index ? "border-green-500 bg-green-500/10 text-green-300" : r3Answers[i] === idx ? "border-red-500 bg-red-500/10 text-red-300" : "border-gray-800 text-gray-500"}`}>
                            <span className="font-mono mr-1">{OPTION_LABELS[idx]}.</span>{opt}
                          </div>
                        ))}
                      </div>
                    )}
                    {tq.type === "open" && (
                      <div className="text-xs text-gray-400 bg-[#0a0a0a] rounded p-2 mb-2">{r3Answers[i] as string || "(no answer)"}</div>
                    )}
                    <p className="text-xs text-blue-400 leading-relaxed">{tq.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          </main>
        );
      }
      return (
        <main className="fixed inset-0 bg-[#0a0a0a] z-50 overflow-auto text-white">
          <div className="max-w-2xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-4">
              <div><p className="text-xs text-gray-500 uppercase tracking-widest">Round 3 — Technical (25 min)</p><h3 className="text-lg font-bold">{simCompany}</h3></div>
              <span className={`font-mono font-bold text-lg ${simTimeLeft < 120 ? "text-red-400" : "text-gray-400"}`}>{formatSimTime(simTimeLeft)}</span>
            </div>
            <div className="w-full bg-gray-800 h-1.5 rounded-full mb-6"><div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(r3Index / TECH_QUESTIONS.length) * 100}%` }} /></div>
            <p className="text-xs text-gray-500 mb-1">Q{r3Index + 1}/{TECH_QUESTIONS.length} — {q.topic} ({q.type === "mcq" ? "MCQ" : "Short answer"})</p>
            <p className="text-white font-medium text-base leading-relaxed mb-5">{q.question}</p>
            {q.type === "mcq" && q.options ? (
              <div className="space-y-3 mb-6">
                {q.options.map((opt, idx) => (
                  <button key={idx} onClick={() => setR3Answers(prev => ({ ...prev, [r3Index]: idx }))}
                    className={`w-full rounded-xl p-3.5 text-sm text-left border transition ${r3Answers[r3Index] === idx ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-gray-800 bg-[#111] text-gray-300 hover:border-blue-500/50"}`}>
                    <span className="font-mono mr-2 text-gray-500">{OPTION_LABELS[idx]}.</span>{opt}
                  </button>
                ))}
              </div>
            ) : (
              <textarea
                value={(r3Answers[r3Index] as string) || ""}
                onChange={e => setR3Answers(prev => ({ ...prev, [r3Index]: e.target.value }))}
                className="w-full bg-[#0d1117] text-white border border-gray-700 rounded-lg p-4 h-28 text-sm resize-none focus:outline-none focus:border-blue-500 mb-6"
                placeholder="Type your answer..."
              />
            )}
            <div className="flex gap-3">
              {r3Index > 0 && <button onClick={() => setR3Index(i => i - 1)} className="px-4 py-2.5 border border-gray-700 text-gray-400 rounded-xl text-sm hover:border-gray-500 transition">← Back</button>}
              {!isLast ? (
                <button onClick={() => setR3Index(i => i + 1)} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition">Next →</button>
              ) : (
                <button onClick={() => { clearInterval(simTimerRef.current!); setR3Submitted(true); }} className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition">Submit Round 3</button>
              )}
            </div>
          </div>
        </main>
      );
    }

    // ── Round 4: HR ──────────────────────────────────────────────────────────
    if (simPhase === "r4") {
      const hrQ = HR_QUESTIONS[r4Index];
      const isLast = r4Index === HR_QUESTIONS.length - 1;
      const tipsOpen = r4TipsOpen[r4Index];
      if (r4Done) {
        return (
          <main className="fixed inset-0 bg-[#0a0a0a] z-50 overflow-auto text-white">
            <div className="max-w-2xl mx-auto px-6 py-10 text-center">
              <h2 className="text-2xl font-bold mb-2">HR Round Complete</h2>
              <p className="text-gray-400 text-sm mb-6">Review your answers and the tips provided for each question.</p>
              <div className="space-y-4 text-left mb-8">
                {HR_QUESTIONS.map((q, i) => (
                  <div key={q.id} className="bg-[#111] border border-gray-800 rounded-xl p-4">
                    <p className="text-sm font-medium text-white mb-2">{q.question}</p>
                    <p className="text-xs text-gray-400 bg-[#0a0a0a] rounded p-2 mb-2">{r4Answers[i] || "(no answer)"}</p>
                    <p className="text-xs text-blue-400 italic">{q.sample_answer}</p>
                  </div>
                ))}
              </div>
              <button onClick={() => setSimPhase("r4_result")} className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition">Continue →</button>
            </div>
          </main>
        );
      }
      return (
        <main className="fixed inset-0 bg-[#0a0a0a] z-50 overflow-auto text-white">
          <div className="max-w-2xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-4">
              <div><p className="text-xs text-gray-500 uppercase tracking-widest">Round 4 — HR (20 min)</p><h3 className="text-lg font-bold">{simCompany}</h3></div>
              <span className={`font-mono font-bold text-lg ${simTimeLeft < 120 ? "text-red-400" : "text-gray-400"}`}>{formatSimTime(simTimeLeft)}</span>
            </div>
            <div className="w-full bg-gray-800 h-1.5 rounded-full mb-6"><div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${(r4Index / HR_QUESTIONS.length) * 100}%` }} /></div>
            <p className="text-xs text-gray-500 mb-2">Question {r4Index + 1}/{HR_QUESTIONS.length}</p>
            <p className="text-white font-medium text-lg leading-relaxed mb-4">{hrQ.question}</p>
            <textarea
              value={r4Answers[r4Index]}
              onChange={e => { const a = [...r4Answers]; a[r4Index] = e.target.value; setR4Answers(a); }}
              className="w-full bg-[#0d1117] text-white border border-gray-700 rounded-lg p-4 h-28 text-sm resize-none focus:outline-none focus:border-purple-500 mb-4"
              placeholder="Type your answer..."
            />
            <button onClick={() => { const t = [...r4TipsOpen]; t[r4Index] = !t[r4Index]; setR4TipsOpen(t); }}
              className="text-xs text-purple-400 hover:text-purple-300 transition mb-4 flex items-center gap-1">
              {tipsOpen ? "▲" : "▼"} Best Answer Tips
            </button>
            {tipsOpen && (
              <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 mb-4 space-y-3">
                <div>
                  <p className="text-xs text-purple-400 font-semibold uppercase mb-1">What interviewers look for</p>
                  <ul className="space-y-0.5">{hrQ.what_look_for.map((w, i) => <li key={i} className="text-xs text-gray-300">• {w}</li>)}</ul>
                </div>
                <div>
                  <p className="text-xs text-red-400 font-semibold uppercase mb-1">Red flags to avoid</p>
                  <ul className="space-y-0.5">{hrQ.red_flags.map((r, i) => <li key={i} className="text-xs text-gray-400">⚠ {r}</li>)}</ul>
                </div>
                <div>
                  <p className="text-xs text-green-400 font-semibold uppercase mb-1">Sample strong answer</p>
                  <p className="text-xs text-gray-400 italic">{hrQ.sample_answer}</p>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              {r4Index > 0 && <button onClick={() => setR4Index(i => i - 1)} className="px-4 py-2.5 border border-gray-700 text-gray-400 rounded-xl text-sm hover:border-gray-500 transition">← Back</button>}
              {!isLast ? (
                <button onClick={() => setR4Index(i => i + 1)} className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-medium transition">Next →</button>
              ) : (
                <button onClick={() => { clearInterval(simTimerRef.current!); setR4Done(true); }} className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition">Complete HR Round</button>
              )}
            </div>
          </div>
        </main>
      );
    }
  }

  // ── Browse mode ────────────────────────────────────────────────────────────
  const currentRoundData = sourcedData?.rounds?.[activeRound];

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Quiz Config Modal */}
      {mode === "quiz_config" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setMode("browse")}>
          <div className="bg-[#111] border border-gray-800 rounded-2xl p-8 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-6">Quiz Setup</h3>
            <div className="mb-6">
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Company</label>
              <div className="relative">
                <div className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm cursor-pointer flex items-center justify-between" onClick={() => setShowQuizDropdown(v => !v)}>
                  <span className="text-white">{quizCompany}</span>
                  <span className="text-gray-500 text-xs">▾</span>
                </div>
                {showQuizDropdown && (
                  <div className="absolute z-20 top-full mt-1 w-full bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-gray-800">
                      <input autoFocus type="text" placeholder="Search..." value={quizCompanySearch} onChange={e => setQuizCompanySearch(e.target.value)}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 outline-none" />
                    </div>
                    <ul className="max-h-48 overflow-y-auto">
                      {filteredQuizCompanies.map(c => (
                        <li key={c} onClick={() => { setQuizCompany(c); setQuizCompanySearch(""); setShowQuizDropdown(false); }}
                          className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-800 transition ${c === quizCompany ? "text-blue-400" : "text-gray-300"}`}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {bestScores[quizCompany] && (
                <p className="text-xs text-blue-400 mt-2">Best score: <span className="font-semibold">{bestScores[quizCompany].percentage}%</span> ({bestScores[quizCompany].score}/{bestScores[quizCompany].total})</p>
              )}
            </div>
            <div className="mb-8">
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setQuizTimed(false)} className={`py-4 rounded-xl text-sm font-medium border transition ${!quizTimed ? "bg-blue-600 border-blue-500 text-white" : "bg-[#0a0a0a] border-gray-700 text-gray-400 hover:border-gray-600"}`}>Untimed</button>
                <button onClick={() => setQuizTimed(true)} className={`py-4 rounded-xl text-sm font-medium border transition ${quizTimed ? "bg-orange-600 border-orange-500 text-white" : "bg-[#0a0a0a] border-gray-700 text-gray-400 hover:border-gray-600"}`}>Timed (60s/q)</button>
              </div>
            </div>
            {quizError && <p className="text-red-400 text-sm mb-4">{quizError}</p>}
            <button onClick={startQuiz} disabled={loadingQuiz} className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition">
              {loadingQuiz ? "Loading quiz..." : "Start Quiz →"}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-bold mb-1">Interview Prep</h2>
            <p className="text-gray-400">Sourced questions and topics from real company interviews · PrepInsta, GFG, LeetCode</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {bestScores[company] && (
              <p className="text-xs text-blue-400">Best: <span className="font-semibold">{bestScores[company].percentage}%</span></p>
            )}
            <button onClick={() => { setQuizCompany(company); setMode("quiz_config"); }}
              className="px-5 py-2.5 bg-[#111] border border-gray-700 hover:border-blue-500 text-white text-sm font-medium rounded-xl transition">
              Start Quiz ▶
            </button>
            <button onClick={() => startSimulation(company)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition">
              Start Full Interview Simulation →
            </button>
          </div>
        </div>

        {/* Company selector */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-6">
          <label className="block text-xs text-gray-500 uppercase tracking-widest mb-3">Select Company</label>
          <div className="flex flex-wrap gap-2">
            {COMPANIES.map(c => (
              <button
                key={c}
                onClick={() => { setCompany(c); setActiveRound("aptitude"); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                  c === company ? "bg-blue-600 border-blue-500 text-white" : "bg-[#0a0a0a] border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {sourcedLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="bg-[#111] border border-gray-800 rounded-2xl p-5 animate-pulse h-16" />)}
          </div>
        )}

        {sourcedError && !sourcedLoading && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{sourcedError}</div>
        )}

        {/* Quick Tips Panel */}
        {COMPANY_TIPS[company] && (
          <div className="mb-5">
            <button onClick={() => setShowTips(t => !t)}
              className="w-full flex items-center justify-between bg-[#111] border border-gray-800 rounded-2xl px-5 py-3 hover:border-gray-700 transition">
              <span className="text-sm font-medium text-white">Interview Tips for {company}</span>
              <span className="text-gray-500 text-xs">{showTips ? "▲ Collapse" : "▼ Expand"}</span>
            </button>
            {showTips && (
              <div className="bg-[#111] border border-gray-800 border-t-0 rounded-b-2xl px-5 pb-5 space-y-4">
                <div className="pt-4">
                  <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-2">What they actually look for</p>
                  <ul className="space-y-1">{COMPANY_TIPS[company].what_they_look_for.map((w, i) => <li key={i} className="text-sm text-gray-300">• {w}</li>)}</ul>
                </div>
                <div>
                  <p className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-2">Biggest mistakes candidates make</p>
                  <ul className="space-y-1">{COMPANY_TIPS[company].biggest_mistakes.map((m, i) => <li key={i} className="text-sm text-gray-400">⚠ {m}</li>)}</ul>
                </div>
                <div>
                  <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-2">Day-before checklist</p>
                  <ul className="space-y-1.5">{COMPANY_TIPS[company].day_before_checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <input type="checkbox" className="mt-0.5 accent-yellow-400 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}</ul>
                </div>
                <div className="bg-gray-800/50 rounded-lg px-4 py-2">
                  <p className="text-xs text-gray-500"><span className="text-gray-300 font-medium">Dress code & format:</span> {COMPANY_TIPS[company].dress_code}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {!sourcedLoading && sourcedData && (
          <>
            {/* Key Topics to Master */}
            {sourcedData.key_topics && sourcedData.key_topics.length > 0 && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-5 mb-5">
                <p className="text-xs text-yellow-400 uppercase tracking-widest mb-3">Key Topics to Master — {company}</p>
                <div className="flex flex-wrap gap-2">
                  {sourcedData.key_topics.map((t, i) => (
                    <span key={t} className="flex items-center gap-1.5 bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 text-xs px-3 py-1.5 rounded-full font-medium">
                      <span className="text-yellow-500 font-bold">{i + 1}.</span> {t}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600 mt-3">Source: {sourcedData.data_source}</p>
              </div>
            )}

            {/* Round tabs */}
            <div className="flex gap-1 mb-5 border-b border-gray-800">
              {ROUNDS.map(r => (
                <button
                  key={r}
                  onClick={() => setActiveRound(r)}
                  className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition border-b-2 -mb-px ${
                    activeRound === r
                      ? "border-blue-500 text-blue-400 bg-blue-500/5"
                      : "border-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {ROUND_LABELS[r]}
                </button>
              ))}
            </div>

            {currentRoundData && (
              <>
                {/* Topics */}
                {currentRoundData.topics && currentRoundData.topics.length > 0 && (
                  <div className="bg-[#111] border border-gray-800 rounded-2xl p-5 mb-5">
                    <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Topics to Study</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {currentRoundData.topics.map(t => (
                        <span key={t} className="bg-gray-800 text-gray-300 text-xs px-3 py-1.5 rounded-full border border-gray-700">{t}</span>
                      ))}
                    </div>
                    {currentRoundData.topics.length === 0 && (
                      <p className="text-gray-600 text-sm">No formal round for this category.</p>
                    )}
                  </div>
                )}

                {/* Exam Pattern */}
                {currentRoundData.exam_pattern && (
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-4 py-3 mb-5">
                    <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">Exam Format</p>
                    <p className="text-gray-300 text-sm leading-relaxed">{currentRoundData.exam_pattern}</p>
                  </div>
                )}

                {/* Questions */}
                {currentRoundData.questions && currentRoundData.questions.length > 0 ? (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Sample Questions</p>
                    <div className="space-y-3">
                      {currentRoundData.questions.map((q, i) => (
                        <SourcedQuestionCard key={i} q={q} idx={i} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#111] border border-gray-800 rounded-xl p-6 text-center">
                    <p className="text-gray-500 text-sm">Focus on the topics above — practice on LeetCode / PrepInsta for this round.</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Past Simulations */}
        {pastSimulations.length > 0 && (
          <div className="mt-8 border-t border-gray-800 pt-6">
            <button onClick={() => setShowPastSims(v => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition mb-4">
              {showPastSims ? "▲" : "▼"} Past Simulations ({pastSimulations.length})
            </button>
            {showPastSims && (
              <div className="space-y-3">
                {pastSimulations.map((sim, i) => (
                  <div key={i} className="bg-[#111] border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-medium text-white text-sm">{sim.company}</p>
                      <p className="text-xs text-gray-500">{new Date(sim.date).toLocaleDateString("en-IN")}</p>
                    </div>
                    <div className="flex gap-4 text-xs">
                      <span className={`font-medium ${sim.aptitude_score >= 7 ? "text-green-400" : sim.aptitude_score >= 5 ? "text-yellow-400" : "text-red-400"}`}>
                        Apt: {sim.aptitude_score}/{sim.aptitude_total}
                      </span>
                      <span className={`font-medium ${sim.technical_score >= 6 ? "text-green-400" : sim.technical_score >= 4 ? "text-yellow-400" : "text-red-400"}`}>
                        Tech: {sim.technical_score}/{sim.technical_total}
                      </span>
                      <span className="text-green-400">{sim.hr_completed ? "HR ✓" : "HR –"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ── Sourced Question Card ──────────────────────────────────────────────────────

function SourcedQuestionCard({ q, idx }: { q: SourcedQuestion; idx: number }) {
  return (
    <div className="bg-[#111] border border-gray-800 rounded-xl p-5">
      <div className="flex items-start gap-3">
        <span className="text-gray-500 text-sm font-mono shrink-0 pt-0.5">Q{idx + 1}</span>
        <div className="flex-1">
          <div className="flex flex-wrap gap-2 mb-2">
            {q.difficulty && (
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                q.difficulty === "Easy" ? "bg-green-500/15 text-green-400 border-green-500/30" :
                q.difficulty === "Hard" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
              }`}>{q.difficulty}</span>
            )}
            {q.topic && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{q.topic}</span>
            )}
            {q.verified && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-900/20 text-green-500 border border-green-700/30">✓ Verified</span>
            )}
          </div>
          <p className="text-white font-medium leading-relaxed mb-2">{q.question}</p>
          {q.source_name && (
            <div className="flex items-center gap-2 mt-2">
              {q.source_url ? (
                <a href={q.source_url} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-blue-400 hover:text-blue-300 underline underline-offset-2 transition">
                  Source: {q.source_name}{q.year ? ` · ${q.year}` : ""}
                </a>
              ) : (
                <span className="text-[11px] text-gray-600">Source: {q.source_name}{q.year ? ` · ${q.year}` : ""}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
