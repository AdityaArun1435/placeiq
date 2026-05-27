"use client";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("placeiq_theme");
    const isLight = stored === "light";
    setIsDark(!isLight);
  }, []);

  const toggle = () => {
    const nextIsDark = !isDark;
    setIsDark(nextIsDark);
    if (nextIsDark) {
      document.documentElement.classList.remove("light");
      localStorage.setItem("placeiq_theme", "dark");
    } else {
      document.documentElement.classList.add("light");
      localStorage.setItem("placeiq_theme", "light");
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="focus-ring"
      style={{
        width: 36,
        height: 36,
        minWidth: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        cursor: "pointer",
        color: "var(--text-secondary)",
        transition: `color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)`,
        flexShrink: 0,
      }}
    >
      {mounted && (
        <span key={isDark ? "dark" : "light"} className="icon-enter" style={{ display: "flex" }}>
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </span>
      )}
    </button>
  );
}
