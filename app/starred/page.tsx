"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Star, X } from "lucide-react";

type StarredCompany = {
  company_name: string;
  college_name: string | null;
  starred_at: string;
};

function daysAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "1 day ago";
    return `${diff} days ago`;
  } catch { return ""; }
}

export default function StarredPage() {
  const { status } = useSession();
  const router = useRouter();
  const [starred, setStarred] = useState<StarredCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [fading, setFading] = useState<Set<string>>(new Set());
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    const raw = localStorage.getItem("placeiq_profile") || "{}";
    let email = "";
    try { email = JSON.parse(raw).email || ""; } catch {}
    if (!email) { setLoading(false); return; }
    fetch(`${apiUrl}/api/starred/list?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => setStarred(d.starred || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const remove = async (companyName: string) => {
    const raw = localStorage.getItem("placeiq_profile") || "{}";
    let email = "";
    try { email = JSON.parse(raw).email || ""; } catch {}
    if (!email) return;

    setRemoving(prev => new Set(prev).add(companyName));
    setFading(prev => new Set(prev).add(companyName));

    try {
      await fetch(`${apiUrl}/api/starred/remove`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_email: email, company_name: companyName }),
      });
      setTimeout(() => {
        setStarred(prev => prev.filter(s => s.company_name !== companyName));
        setRemoving(prev => { const n = new Set(prev); n.delete(companyName); return n; });
        setFading(prev => { const n = new Set(prev); n.delete(companyName); return n; });
      }, 300);
    } catch {
      setRemoving(prev => { const n = new Set(prev); n.delete(companyName); return n; });
      setFading(prev => { const n = new Set(prev); n.delete(companyName); return n; });
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)", padding: "40px 24px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>Starred Companies</h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>Track companies you want to join</p>
      </div>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: 10, padding: "16px 20px", height: 68, opacity: 0.5 }} />
          ))}
        </div>
      )}

      {!loading && starred.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 16, textAlign: "center" }}>
          <Star size={40} style={{ color: "#f59e0b" }} />
          <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text-secondary)" }}>No starred companies yet</p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 340, lineHeight: 1.6 }}>
            Star companies from the Companies, On Campus, or Off Campus pages to track them here.
          </p>
        </div>
      )}

      {!loading && starred.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {starred.map(s => (
            <div
              key={s.company_name}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: 10,
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                transition: "opacity 300ms ease-out",
                opacity: fading.has(s.company_name) ? 0 : 1,
              }}
            >
              <div>
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{s.company_name}</p>
                {s.college_name && (
                  <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 1 }}>{s.college_name}</p>
                )}
                <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Starred {daysAgo(s.starred_at)}</p>
              </div>
              <button
                onClick={() => remove(s.company_name)}
                disabled={removing.has(s.company_name)}
                title="Remove from starred"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: removing.has(s.company_name) ? "not-allowed" : "pointer",
                  color: "var(--text-tertiary)",
                  padding: 4,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  transition: "color 150ms ease-out",
                  flexShrink: 0,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-tertiary)"; }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
