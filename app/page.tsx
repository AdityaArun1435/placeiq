"use client";

import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Target, Building2, Zap, Globe, MessageSquare,
  ArrowRight, ChevronRight,
  Building, Wifi, Briefcase, Star, MessageSquareText,
  Code2, GraduationCap,
  CheckCircle,
} from "lucide-react";
import PlaceIQFooter from "@/components/ui/footer";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";

const FEATURES = [
  {
    icon: Target,
    name: "Placement Score",
    description: "ML model trained on NIRF data predicts your personal placement probability.",
    large: true,
  },
  {
    icon: Building2,
    name: "Company Predictor",
    description: "Ranked list of companies most likely to match your profile and skills.",
    large: true,
  },
  {
    icon: Zap,
    name: "Skill Gap Analysis",
    description: "Exactly which skills you're missing for your target role.",
    large: false,
  },
  {
    icon: Globe,
    name: "Off Campus Jobs",
    description: "Live job listings filtered by your skills and salary expectations.",
    large: false,
  },
  {
    icon: MessageSquare,
    name: "Interview Prep",
    description: "Previous year questions by company, round, and topic.",
    large: false,
  },
];

const STEPS = [
  {
    number: "01",
    title: "Build your profile",
    description: "Enter your college, branch, skills, and target role. Takes 2 minutes.",
  },
  {
    number: "02",
    title: "Get your score",
    description: "Our ML model computes your placement probability from real NIRF data.",
  },
  {
    number: "03",
    title: "Take action",
    description: "Follow your personalised roadmap and track your progress daily.",
  },
];

const DATA_SOURCES = [
  { icon: Building, label: "NIRF India" },
  { icon: Globe, label: "Adzuna" },
  { icon: Wifi, label: "Remotive" },
  { icon: Briefcase, label: "Arbeitnow" },
  { icon: Star, label: "AmbitionBox" },
  { icon: MessageSquareText, label: "Glassdoor" },
  { icon: Code2, label: "LeetCode" },
  { icon: GraduationCap, label: "NIRF Placements" },
];

const STATS_NEW = [
  { number: "24+", label: "Colleges tracked" },
  { number: "480+", label: "Companies" },
  { number: "2,000+", label: "Placement records" },
  { number: "Free", label: "Always" },
];


function ReviewForm() {
  const [name, setName] = useState("");
  const [college, setCollege] = useState("");
  const [review, setReview] = useState("");
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !review.trim()) return;
    const stored = JSON.parse(localStorage.getItem("placeiq_reviews") || "[]");
    stored.push({ name, college, review, rating, date: new Date().toISOString() });
    localStorage.setItem("placeiq_reviews", JSON.stringify(stored));
    setSubmitted(true);
    setName(""); setCollege(""); setReview(""); setRating(0);
    setTimeout(() => setSubmitted(false), 4000);
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-default)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 14,
    color: "var(--text-primary)",
    width: "100%",
    outline: "none",
    transition: "border-color 150ms ease-out",
    fontFamily: "var(--font-sans)",
  };

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        padding: 28,
        maxWidth: 540,
        margin: "0 auto",
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", marginBottom: 20, fontFamily: "var(--font-sans)" }}>
        Leave a suggestion or review
      </p>
      {submitted ? (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <CheckCircle size={32} style={{ margin: "0 auto 12px", color: "var(--accent-green)" }} />
          <p style={{ fontSize: 14, color: "var(--text-secondary)", fontFamily: "var(--font-sans)" }}>
            Thanks! We&apos;ll add your review soon.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
            onFocus={e => (e.target.style.borderColor = "var(--accent-blue)")}
            onBlur={e => (e.target.style.borderColor = "var(--border-default)")}
          />
          <input
            type="text"
            placeholder="College"
            value={college}
            onChange={e => setCollege(e.target.value)}
            style={inputStyle}
            onFocus={e => (e.target.style.borderColor = "var(--accent-blue)")}
            onBlur={e => (e.target.style.borderColor = "var(--border-default)")}
          />
          <textarea
            rows={4}
            placeholder="Your review or suggestion..."
            value={review}
            onChange={e => setReview(e.target.value)}
            style={{ ...inputStyle, resize: "vertical" }}
            onFocus={e => (e.target.style.borderColor = "var(--accent-blue)")}
            onBlur={e => (e.target.style.borderColor = "var(--border-default)")}
          />
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <button
                key={i}
                type="button"
                onClick={() => setRating(i)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(0)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <Star
                  size={20}
                  style={{
                    color: i <= (hovered || rating) ? "#f59e0b" : "var(--text-tertiary)",
                    fill: i <= (hovered || rating) ? "#f59e0b" : "transparent",
                    transition: "color 100ms, fill 100ms",
                  }}
                />
              </button>
            ))}
          </div>
          <button
            type="submit"
            style={{
              height: 42,
              background: "var(--accent-blue)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              transition: "filter 150ms ease-out",
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.1)")}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.filter = "")}
          >
            Submit review
          </button>
        </form>
      )}
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();

  const EASE = [0.23, 1, 0.32, 1] as [number, number, number, number];

  const fadeUpVariant = {
    hidden: shouldReduceMotion ? {} : { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  };

  const staggerContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.08 } },
  };

  const cardVariant = {
    hidden: shouldReduceMotion ? {} : { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  };

  return (
    <main
      style={{
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        minHeight: "100dvh",
        overflowX: "hidden",
      }}
    >
      {/* ── SECTION 1: Hero ─────────────────────────────────────────── */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 24px 80px",
          textAlign: "center",
          zIndex: 1,
        }}
      >
        {/* Content */}
        <div>
          {/* H1 */}
          <h1
            className={shouldReduceMotion ? "" : "hero-animate hero-animate-delay-1"}
            style={{
              fontFamily: "system-ui, -apple-system, 'Helvetica Neue', sans-serif",
              fontSize: "clamp(2.8rem, 6vw, 4.5rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              maxWidth: 700,
              marginBottom: 24,
              fontWeight: 800,
            }}
          >
            Know exactly where you stand. Get placed.
          </h1>

          {/* Subheading */}
          <p
            className={shouldReduceMotion ? "" : "hero-animate hero-animate-delay-2"}
            style={{
              fontSize: 17,
              color: "var(--text-secondary)",
              maxWidth: 500,
              lineHeight: 1.6,
              margin: "0 auto 36px",
              fontFamily: "var(--font-sans)",
              textAlign: "center",
            }}
          >
            PlaceIQ predicts your placement probability, shows which companies will visit your campus,
            and tells you exactly what to learn — all from real data.
          </p>

          {/* CTAs */}
          <div
            className={shouldReduceMotion ? "" : "hero-animate hero-animate-delay-3"}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}
          >
            <button
              onClick={() => router.push("/login")}
              className="focus-ring"
              style={{
                height: 42,
                padding: "0 20px",
                background: "var(--accent-blue)",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
                transition: "filter var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)",
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.1)")}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.filter = "")}
              onMouseDown={e => ((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)")}
              onMouseUp={e => ((e.currentTarget as HTMLButtonElement).style.transform = "")}
            >
              Get started free
            </button>
            <button
              onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
              className="focus-ring"
              style={{
                height: 42,
                padding: "0 20px",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
                transition: "color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
            >
              See how it works
            </button>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: Powered by Real Data strip ───────────────────── */}
      <section
        style={{
          borderTop: "1px solid var(--border-subtle)",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "40px 0",
          position: "relative",
          zIndex: 1,
          background: "transparent",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px" }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-sans)",
              marginBottom: 16,
            }}
          >
            Data Sources
          </p>

          {/* Logo pill strip — infinite marquee */}
          <div style={{ position: "relative", overflow: "hidden", width: "100%" }}>
            <div className="marquee-track" style={{ display: "flex", gap: 12, width: "max-content" }}>
              {[...DATA_SOURCES, ...DATA_SOURCES].map(({ icon: Icon, label }, idx) => (
                <div
                  key={`${label}-${idx}`}
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  <Icon size={14} color="var(--text-tertiary)" />
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", fontFamily: "var(--font-sans)" }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <ProgressiveBlur direction="left" className="absolute inset-y-0 left-0 w-20 z-10" />
            <ProgressiveBlur direction="right" className="absolute inset-y-0 right-0 w-20 z-10" />
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: 28,
              flexWrap: "wrap",
              gap: 0,
            }}
          >
            {STATS_NEW.map((stat, i) => (
              <div key={stat.label} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ textAlign: "center", padding: "0 28px" }}>
                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-sans)",
                      lineHeight: 1.1,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {stat.number}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, fontFamily: "var(--font-sans)" }}>
                    {stat.label}
                  </div>
                </div>
                {i < STATS_NEW.length - 1 && (
                  <div style={{ width: 1, height: 40, background: "var(--border-subtle)", flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3: Features bento ───────────────────────────────── */}
      <section
        style={{
          padding: "80px 24px",
          maxWidth: 1000,
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.1 }}
          style={{ display: "flex", gap: 16, flexWrap: "wrap" }}
        >
          {/* Left column — 2 large cards */}
          <div style={{ flex: "1 1 340px", display: "flex", flexDirection: "column", gap: 16 }}>
            {FEATURES.filter(f => f.large).map(feature => (
              <motion.div
                key={feature.name}
                variants={cardVariant}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 12,
                  padding: 28,
                  flex: 1,
                  transition: "border-color var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out)",
                  cursor: "pointer",
                }}
                onHoverStart={e => { const el = e.target as HTMLElement; el.style.borderColor = "var(--border-strong)"; el.style.transform = "translateY(-2px)"; }}
                onHoverEnd={e => { const el = e.target as HTMLElement; el.style.borderColor = "var(--border-default)"; el.style.transform = ""; }}
                onClick={() => router.push("/login")}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "var(--accent-blue-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <feature.icon size={18} color="var(--accent-blue)" />
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", marginBottom: 8, fontFamily: "var(--font-sans)", letterSpacing: "-0.01em" }}>
                  {feature.name}
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, fontFamily: "var(--font-sans)" }}>
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Right column — 3 small cards */}
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 12 }}>
            {FEATURES.filter(f => !f.large).map(feature => (
              <motion.div
                key={feature.name}
                variants={cardVariant}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 12,
                  padding: 24,
                  flex: 1,
                  transition: "border-color var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out)",
                  cursor: "pointer",
                }}
                onHoverStart={e => { const el = e.target as HTMLElement; el.style.borderColor = "var(--border-strong)"; el.style.transform = "translateY(-2px)"; }}
                onHoverEnd={e => { const el = e.target as HTMLElement; el.style.borderColor = "var(--border-default)"; el.style.transform = ""; }}
                onClick={() => router.push("/login")}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "var(--accent-blue-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <feature.icon size={16} color="var(--accent-blue)" />
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", marginBottom: 6, fontFamily: "var(--font-sans)", letterSpacing: "-0.01em" }}>
                  {feature.name}
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, fontFamily: "var(--font-sans)" }}>
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── SECTION 4: How it works ──────────────────────────────────── */}
      <section
        id="how-it-works"
        style={{
          padding: "80px 24px",
          maxWidth: 900,
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          style={{ display: "flex", gap: 0, flexWrap: "wrap" }}
        >
          {STEPS.map((step, i) => (
            <motion.div
              key={step.number}
              variants={cardVariant}
              style={{
                flex: "1 1 220px",
                padding: "0 32px",
                borderRight: i < STEPS.length - 1 ? "1px solid var(--border-subtle)" : "none",
                position: "relative",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  marginBottom: 12,
                }}
              >
                {step.number}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8, fontFamily: "var(--font-sans)", letterSpacing: "-0.01em" }}>
                {step.title}
              </h3>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, fontFamily: "var(--font-sans)" }}>
                {step.description}
              </p>
              {i < STEPS.length - 1 && (
                <div aria-hidden="true" style={{ position: "absolute", right: -12, top: "30%", color: "var(--text-tertiary)", zIndex: 2 }}>
                  <ChevronRight size={16} />
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── SECTION 5: CTA footer banner ────────────────────────────── */}
      <section
        style={{
          padding: "80px 24px",
          maxWidth: 900,
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <motion.div
          variants={fadeUpVariant}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: 16,
            padding: "48px 40px",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "system-ui, -apple-system, 'Helvetica Neue', sans-serif",
              fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
              lineHeight: 1.15,
              letterSpacing: "-0.025em",
              color: "var(--text-primary)",
              marginBottom: 16,
              fontWeight: 700,
            }}
          >
            Ready to know where you stand?
          </h2>
          <p style={{ fontSize: 16, color: "var(--text-secondary)", maxWidth: 440, margin: "0 auto 28px", lineHeight: 1.6, fontFamily: "var(--font-sans)" }}>
            Join students across 24 colleges using PlaceIQ to get placed faster.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="focus-ring"
            style={{
              height: 42,
              padding: "0 24px",
              background: "var(--accent-blue)",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "filter var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)",
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.1)")}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.filter = "")}
            onMouseDown={e => ((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)")}
            onMouseUp={e => ((e.currentTarget as HTMLButtonElement).style.transform = "")}
          >
            Get started free
            <ArrowRight size={14} />
          </button>
        </motion.div>
      </section>

      {/* ── SECTION 6: Reviews ──────────────────────────────────────── */}
      <section
        style={{
          padding: "80px 24px",
          maxWidth: 960,
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)", marginBottom: 8 }}>
            What students say
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", fontFamily: "var(--font-sans)" }}>
            Share your experience or suggestion — we read every one.
          </p>
        </div>

        {/* No reviews yet */}
        <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)", marginBottom: 48 }}>
          No reviews yet — be the first to share your experience.
        </p>

        {/* Review form */}
        <ReviewForm />
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <PlaceIQFooter />
    </main>
  );
}
