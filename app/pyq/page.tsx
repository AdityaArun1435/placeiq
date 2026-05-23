"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import config from '@/lib/config'
import LoadingScreen from '@/components/LoadingScreen'

const COMPANIES = [
  "TCS", "Infosys", "Wipro", "Accenture", "Cognizant", "HCL", "Capgemini",
  "IBM", "Deloitte", "Zoho", "Freshworks", "Razorpay", "CRED", "Swiggy",
  "Zepto", "PhonePe", "Groww", "Flipkart", "Amazon", "Microsoft", "Google",
  "Dream11", "Paytm", "Uber", "Goldman Sachs", "JP Morgan", "Morgan Stanley",
  "DE Shaw", "Sprinklr", "Atlassian", "Salesforce", "Adobe", "Intel",
  "Qualcomm", "Samsung", "Bosch", "MathWorks",
];

const ROUNDS = ["Aptitude", "Coding", "Technical", "HR"];
const OPTION_LABELS = ["A", "B", "C", "D"];

// ── Types ──────────────────────────────────────────────────────────────────────

type Question = {
  question: string;
  type: "MCQ" | "Coding" | "Subjective";
  difficulty: "Easy" | "Medium" | "Hard";
  answer: string;
  explanation: string;
  frequency: string;
  topic: string;
};

type ExamPattern = {
  total_questions: number;
  time_limit: string;
  sections: string[];
  negative_marking: boolean;
  difficulty_level: string;
};

type Resource = {
  name: string;
  url: string;
  what_to_practice: string;
};

type PYQResult = {
  company: string;
  round: string;
  questions: Question[];
  exam_pattern: ExamPattern;
  pro_tips: string[];
  resources: Resource[];
};

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

function typeBadge(t: string) {
  if (t === "Coding") return "bg-purple-500/15 text-purple-400 border-purple-500/30";
  if (t === "Subjective") return "bg-gray-500/15 text-gray-400 border-gray-500/30";
  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
}

function frequencyBadge(f: string) {
  if (f === "Asked frequently") return "bg-blue-600/15 text-blue-400 border-blue-500/30";
  if (f === "Sometimes asked") return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  return "bg-gray-700/30 text-gray-500 border-gray-600/30";
}

// ── Browse mode: Question Card ─────────────────────────────────────────────────

function QuestionCard({ q, idx }: { q: Question; idx: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#111] border border-gray-800 rounded-xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-gray-500 text-sm font-mono shrink-0 pt-0.5">Q{idx + 1}</span>
        <div className="flex-1">
          <div className="flex flex-wrap gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${difficultyBadge(q.difficulty)}`}>
              {q.difficulty}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${typeBadge(q.type)}`}>
              {q.type}
            </span>
            {q.frequency !== "Rarely asked" && (
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${frequencyBadge(q.frequency)}`}>
                {q.frequency}
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
              {q.topic}
            </span>
          </div>
          <p className="text-white font-medium leading-relaxed">{q.question}</p>
        </div>
      </div>
      <button
        onClick={() => setOpen(v => !v)}
        className="ml-8 text-sm text-blue-400 hover:text-blue-300 transition"
      >
        {open ? "Hide Answer" : "Show Answer"}
      </button>
      {open && (
        <div className="ml-8 mt-3 space-y-2">
          <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
            <p className="text-xs text-green-400 uppercase tracking-widest mb-1">Answer</p>
            <p className="text-gray-200 text-sm leading-relaxed">{q.answer}</p>
          </div>
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
            <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">Explanation</p>
            <p className="text-gray-300 text-sm leading-relaxed">{q.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── LocalStorage helpers ───────────────────────────────────────────────────────

function loadBestScores(): Record<string, BestScore> {
  try {
    const raw = localStorage.getItem("placeiq_pyq_scores");
    if (!raw) return {};
    const arr: BestScore[] = JSON.parse(raw);
    const map: Record<string, BestScore> = {};
    for (const s of arr) {
      if (!map[s.company] || s.percentage > map[s.company].percentage) {
        map[s.company] = s;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function saveBestScore(score: BestScore) {
  try {
    const raw = localStorage.getItem("placeiq_pyq_scores");
    const arr: BestScore[] = raw ? JSON.parse(raw) : [];
    const idx = arr.findIndex(s => s.company === score.company);
    if (idx >= 0) {
      if (score.percentage > arr[idx].percentage) arr[idx] = score;
    } else {
      arr.push(score);
    }
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

  // ── Browse mode state ──────────────────────────────────────────────────────
  const [company, setCompany] = useState("TCS");
  const [companySearch, setCompanySearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [round, setRound] = useState("Aptitude");
  const [targetRole, setTargetRole] = useState("Software Engineer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PYQResult | null>(null);

  // ── Quiz state ─────────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    try {
      const prof = localStorage.getItem("placeiq_profile");
      if (prof) {
        const p = JSON.parse(prof);
        if (p.targetRole) setTargetRole(p.targetRole);
      }
    } catch {}
    setBestScores(loadBestScores());
  }, []);

  const cacheKey = `placeiq_pyq_${company}_${round}`;

  useEffect(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) setResult(JSON.parse(cached));
      else setResult(null);
    } catch {}
  }, [company, round]);

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
          // Time's up — mark as wrong and reveal answer
          setAnswers(a => ({
            ...a,
            [currentIndex]: { selected: null, status: "wrong" },
          }));
          setSelectedAnswer(null);
          setShowAnswer(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [mode, quizTimed, showAnswer, currentIndex]);

  // ── Browse generate ────────────────────────────────────────────────────────
  const filteredCompanies = COMPANIES.filter(c =>
    c.toLowerCase().includes(companySearch.toLowerCase())
  );

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${config.apiUrl}/api/pyq/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, round_type: round, target_role: targetRole }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: PYQResult = await res.json();
      setResult(data);
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

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
    setAnswers(a => ({
      ...a,
      [currentIndex]: { selected: optionIdx, status: correct ? "correct" : "wrong" },
    }));
    setShowAnswer(true);
  }

  function handleSkip() {
    if (showAnswer) return;
    clearInterval(timerRef.current!);
    setAnswers(a => ({
      ...a,
      [currentIndex]: { selected: null, status: "skipped" },
    }));
    setShowAnswer(true);
    setSelectedAnswer(null);
  }

  function nextQuestion() {
    if (currentIndex >= quizQuestions.length - 1) {
      finishQuiz();
      return;
    }
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

  // ── Derived quiz stats ─────────────────────────────────────────────────────
  const correctCount = Object.values(answers).filter(a => a.status === "correct").length;
  const wrongCount = Object.values(answers).filter(a => a.status === "wrong").length;
  const skippedCount = Object.values(answers).filter(a => a.status === "skipped").length;
  const totalQuestions = quizQuestions.length;
  const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const timeTaken = quizStartTime && quizEndTime
    ? Math.round((quizEndTime.getTime() - quizStartTime.getTime()) / 1000)
    : 0;

  const filteredQuizCompanies = COMPANIES.filter(c =>
    c.toLowerCase().includes(quizCompanySearch.toLowerCase())
  );

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
            <button
              onClick={() => setMode("review")}
              className="px-6 py-3 bg-[#111] border border-gray-700 text-white rounded-xl text-sm font-medium hover:border-gray-500 transition"
            >
              See Answers
            </button>
            <button
              onClick={retakeQuiz}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition"
            >
              Retake Quiz
            </button>
            <button
              onClick={() => setMode("browse")}
              className="px-6 py-3 bg-[#111] border border-gray-700 text-white rounded-xl text-sm font-medium hover:border-gray-500 transition"
            >
              Back to Browse
            </button>
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
            <button
              onClick={() => setMode("results")}
              className="text-gray-500 hover:text-gray-300 text-sm transition"
            >
              ← Back to Results
            </button>
            <h2 className="text-2xl font-bold">Answer Review — {quizCompany}</h2>
          </div>
          <div className="space-y-6">
            {quizQuestions.map((q, i) => {
              const ans = answers[i];
              const status = ans?.status ?? "skipped";
              return (
                <div key={q.id} className="bg-[#111] border border-gray-800 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-gray-500 text-sm font-mono">Q{i + 1}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      status === "correct" ? "bg-green-500/20 text-green-400" :
                      status === "skipped" ? "bg-gray-600/20 text-gray-400" :
                      "bg-red-500/20 text-red-400"
                    }`}>
                      {status === "correct" ? "✓ Correct" : status === "skipped" ? "— Skipped" : "✗ Wrong"}
                    </span>
                    <span className="text-xs text-gray-600 ml-auto">{q.topic}</span>
                  </div>
                  <p className="text-white font-medium mb-4 leading-relaxed">{q.question}</p>
                  <div className="space-y-2 mb-4">
                    {q.options.map((opt, idx) => {
                      const isCorrect = idx === q.correct_index;
                      const wasSelected = ans?.selected === idx;
                      return (
                        <div
                          key={idx}
                          className={`rounded-xl p-3 text-sm border ${
                            isCorrect
                              ? "border-green-500 bg-green-500/10 text-green-300"
                              : wasSelected && !isCorrect
                              ? "border-red-500 bg-red-500/10 text-red-300"
                              : "border-gray-800 text-gray-400"
                          }`}
                        >
                          <span className="font-mono mr-2">{OPTION_LABELS[idx]}.</span>
                          {opt}
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
    const progress = ((currentIndex) / totalQuestions) * 100;
    const isLastQuestion = currentIndex === totalQuestions - 1;

    return (
      <main className="min-h-screen bg-[#0a0a0a] text-white">
        <div className="max-w-2xl mx-auto px-8 py-10">
          {/* Progress bar */}
          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-8 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-gray-500 text-sm">
                Question <span className="text-white font-semibold">{currentIndex + 1}</span> of {totalQuestions}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{quizCompany} · {currentQ.topic}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${difficultyBadge(currentQ.difficulty)}`}>
                {currentQ.difficulty}
              </span>
              {quizTimed && (
                <span className={`text-lg font-mono font-bold tabular-nums ${timeLeft <= 10 ? "text-red-400" : "text-gray-400"}`}>
                  {timeLeft}s
                </span>
              )}
            </div>
          </div>

          {/* Question */}
          <h2 className="text-xl font-semibold leading-relaxed mb-8 text-white">
            {currentQ.question}
          </h2>

          {/* Options */}
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
                <button
                  key={idx}
                  onClick={() => handleAnswer(idx)}
                  disabled={showAnswer}
                  className={`w-full rounded-xl p-4 text-left transition text-sm ${cls}`}
                >
                  <span className={`font-mono mr-3 ${showAnswer && isCorrect ? "text-green-400" : "text-gray-500"}`}>
                    {OPTION_LABELS[idx]}.
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>

          {/* Explanation (shown after answer) */}
          {showAnswer && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 mb-6">
              <p className="text-xs text-blue-400 uppercase tracking-widest mb-1">Explanation</p>
              <p className="text-gray-300 text-sm leading-relaxed">{currentQ.explanation}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-4">
            {!showAnswer && (
              <button
                onClick={handleSkip}
                className="text-gray-500 hover:text-gray-300 text-sm transition"
              >
                Skip →
              </button>
            )}
            {showAnswer && (
              <button
                onClick={nextQuestion}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition"
              >
                {isLastQuestion ? "See Results →" : "Next Question →"}
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ── Browse mode ────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Quiz Config Modal */}
      {mode === "quiz_config" && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setMode("browse")}
        >
          <div
            className="bg-[#111] border border-gray-800 rounded-2xl p-8 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-6">Quiz Setup</h3>

            {/* Company dropdown */}
            <div className="mb-6">
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Company</label>
              <div className="relative">
                <div
                  className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm cursor-pointer flex items-center justify-between"
                  onClick={() => setShowQuizDropdown(v => !v)}
                >
                  <span className="text-white">{quizCompany}</span>
                  <span className="text-gray-500 text-xs">▾</span>
                </div>
                {showQuizDropdown && (
                  <div className="absolute z-20 top-full mt-1 w-full bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-gray-800">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Search..."
                        value={quizCompanySearch}
                        onChange={e => setQuizCompanySearch(e.target.value)}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 outline-none"
                      />
                    </div>
                    <ul className="max-h-48 overflow-y-auto">
                      {filteredQuizCompanies.map(c => (
                        <li
                          key={c}
                          onClick={() => { setQuizCompany(c); setQuizCompanySearch(""); setShowQuizDropdown(false); }}
                          className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-800 transition ${c === quizCompany ? "text-blue-400" : "text-gray-300"}`}
                        >
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {bestScores[quizCompany] && (
                <p className="text-xs text-blue-400 mt-2">
                  Your best score: <span className="font-semibold">{bestScores[quizCompany].percentage}%</span>
                  {" "}({bestScores[quizCompany].score}/{bestScores[quizCompany].total})
                </p>
              )}
            </div>

            {/* Timed / Untimed */}
            <div className="mb-8">
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setQuizTimed(false)}
                  className={`py-4 rounded-xl text-sm font-medium border transition ${
                    !quizTimed
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-[#0a0a0a] border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  Untimed
                </button>
                <button
                  onClick={() => setQuizTimed(true)}
                  className={`py-4 rounded-xl text-sm font-medium border transition ${
                    quizTimed
                      ? "bg-orange-600 border-orange-500 text-white"
                      : "bg-[#0a0a0a] border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  Timed (60s/q)
                </button>
              </div>
            </div>

            {quizError && <p className="text-red-400 text-sm mb-4">{quizError}</p>}

            <button
              onClick={startQuiz}
              disabled={loadingQuiz}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition"
            >
              {loadingQuiz ? "Generating questions..." : "Start Quiz →"}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold mb-1">Previous Year Questions</h2>
            <p className="text-gray-400">Company-specific interview questions from real placement drives.</p>
          </div>
          <div className="text-right">
            {bestScores[company] && (
              <p className="text-xs text-blue-400 mb-2">
                Best for {company}: <span className="font-semibold">{bestScores[company].percentage}%</span>
              </p>
            )}
            <button
              onClick={() => { setQuizCompany(company); setMode("quiz_config"); }}
              className="px-5 py-2.5 bg-[#111] border border-gray-700 hover:border-blue-500 text-white text-sm font-medium rounded-xl transition"
            >
              Start Quiz ▶
            </button>
          </div>
        </div>

        {/* Browse Controls */}
        <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            {/* Company searchable dropdown */}
            <div className="relative">
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Company</label>
              <div
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm cursor-pointer flex items-center justify-between"
                onClick={() => setShowDropdown(v => !v)}
              >
                <span className="text-white">{company}</span>
                <span className="text-gray-500 text-xs">▾</span>
              </div>
              {showDropdown && (
                <div className="absolute z-20 top-full mt-1 w-full bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="p-2 border-b border-gray-800">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search..."
                      value={companySearch}
                      onChange={e => setCompanySearch(e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 outline-none"
                    />
                  </div>
                  <ul className="max-h-52 overflow-y-auto">
                    {filteredCompanies.map(c => (
                      <li
                        key={c}
                        onClick={() => { setCompany(c); setCompanySearch(""); setShowDropdown(false); }}
                        className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-800 transition ${c === company ? "text-blue-400" : "text-gray-300"}`}
                      >
                        {c}
                      </li>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <li className="px-4 py-2 text-sm text-gray-600">No results</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* Round */}
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Round</label>
              <select
                value={round}
                onChange={e => setRound(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white outline-none"
              >
                {ROUNDS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Target Role */}
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-widest mb-2">Target Role</label>
              <input
                type="text"
                value={targetRole}
                onChange={e => setTargetRole(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none"
                placeholder="e.g. Software Engineer"
              />
            </div>
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium transition"
          >
            {loading ? `Fetching questions for ${company} ${round} round...` : "Generate Questions"}
          </button>

          {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
        </div>

        {result && (
          <div className="space-y-6">
            {/* Exam Pattern */}
            <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
              <h3 className="font-semibold mb-4 text-blue-400 uppercase tracking-widest text-xs">Exam Pattern</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-gray-500 text-xs mb-1">Total Questions</p>
                  <p className="text-white font-bold text-lg">{result.exam_pattern.total_questions}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Time Limit</p>
                  <p className="text-white font-bold text-lg">{result.exam_pattern.time_limit}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Difficulty</p>
                  <p className={`font-bold text-lg ${
                    result.exam_pattern.difficulty_level === "Easy" ? "text-green-400"
                    : result.exam_pattern.difficulty_level === "Hard" ? "text-red-400"
                    : "text-yellow-400"
                  }`}>{result.exam_pattern.difficulty_level}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Negative Marking</p>
                  <p className={`font-bold text-lg ${result.exam_pattern.negative_marking ? "text-red-400" : "text-green-400"}`}>
                    {result.exam_pattern.negative_marking ? "Yes" : "No"}
                  </p>
                </div>
              </div>
              {result.exam_pattern.sections.length > 0 && (
                <div className="mt-4">
                  <p className="text-gray-500 text-xs mb-2">Sections</p>
                  <div className="flex flex-wrap gap-2">
                    {result.exam_pattern.sections.map((s, i) => (
                      <span key={i} className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full border border-gray-700">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Questions */}
            <div>
              <h3 className="font-semibold mb-4">
                {result.company} · {result.round} Round
                <span className="text-gray-500 font-normal ml-2 text-sm">({result.questions.length} questions)</span>
              </h3>
              <div className="space-y-4">
                {result.questions.map((q, i) => (
                  <QuestionCard key={i} q={q} idx={i} />
                ))}
              </div>
            </div>

            {/* Pro Tips */}
            {result.pro_tips.length > 0 && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-6">
                <h3 className="font-semibold mb-3 text-yellow-400">Pro Tips for {result.company} {result.round} Round</h3>
                <ul className="space-y-2">
                  {result.pro_tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-yellow-500 shrink-0 mt-0.5">→</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Resources */}
            {result.resources.length > 0 && (
              <div className="bg-[#111] border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold mb-4">Recommended Resources</h3>
                <div className="space-y-3">
                  {result.resources.map((r, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-blue-500 shrink-0 mt-0.5">↗</span>
                      <div>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-sm font-medium transition"
                        >
                          {r.name}
                        </a>
                        <p className="text-gray-500 text-xs mt-0.5">{r.what_to_practice}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
