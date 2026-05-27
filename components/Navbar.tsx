"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

const NAV_LINKS = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Skills", path: "/skills" },
  { label: "Companies", path: "/companies" },
  { label: "Roadmap", path: "/roadmap" },
  { label: "On Campus", path: "/oncampus" },
  { label: "Off Campus", path: "/offcampus" },
  { label: "Internships", path: "/internships" },
  { label: "Tracker", path: "/tracker" },
  { label: "Market", path: "/market" },
  { label: "Resume", path: "/resume" },
  { label: "PYQ", path: "/pyq" },
  { label: "Referral", path: "/referral" },
  { label: "Progress", path: "/progress" },
  { label: "Resources", path: "/resources" },
  { label: "Company Directory", path: "/company-directory" },
  { label: "College Stats", path: "/college-stats" },
];

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  if (status !== "authenticated") return null;

  const navStyle: React.CSSProperties = {
    height: 52,
    background: "var(--bg-primary)",
    borderBottom: "1px solid var(--border-subtle)",
    position: "sticky",
    top: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 16,
    gap: 12,
  };

  return (
    <>
      <nav style={navStyle}>
        {/* Hamburger — mobile only */}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          className="focus-ring"
          style={{
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-secondary)",
            borderRadius: 6,
            flexShrink: 0,
            transition: `color var(--duration-fast) var(--ease-out)`,
          }}
        >
          <Menu size={16} />
        </button>

        {/* Logo */}
        <button
          onClick={() => router.push("/dashboard")}
          aria-label="Go to dashboard"
          className="focus-ring"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
            fontSize: 17,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            padding: "0 4px",
            flexShrink: 0,
            borderRadius: 4,
          }}
        >
          Place<span style={{ color: "var(--accent-blue)" }}>IQ</span>
        </button>

        {/* Desktop nav links */}
        <div
          className="scrollbar-hide"
          style={{
            flex: 1,
            overflowX: "auto",
            display: "flex",
            alignItems: "stretch",
            gap: 0,
          }}
        >
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.path;
            return (
              <button
                key={link.path}
                onClick={() => router.push(link.path)}
                className="focus-ring"
                style={{
                  position: "relative",
                  flexShrink: 0,
                  padding: "0 10px",
                  height: 52,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 450,
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  transition: `color var(--duration-fast) var(--ease-out)`,
                  whiteSpace: "nowrap",
                  borderRadius: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                }}
              >
                {link.label}
                {isActive && <span className="nav-underline" />}
              </button>
            );
          })}
        </div>

        {/* Right side actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <ThemeToggle />
          {session.user?.image && (
            <img
              src={session.user.image}
              alt={session.user.name ?? "User avatar"}
              style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }}
            />
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="focus-ring"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--text-tertiary)",
              transition: `color var(--duration-fast) var(--ease-out)`,
              padding: "6px 4px",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-tertiary)"; }}
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Backdrop */}
      <div
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 100,
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? "auto" : "none",
          transition: `opacity 200ms var(--ease-out)`,
        }}
      />

      {/* Drawer */}
      <nav
        aria-label="Mobile navigation"
        aria-hidden={!drawerOpen}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: 280,
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-default)",
          zIndex: 101,
          transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
          transition: `transform ${drawerOpen ? "280ms" : "220ms"} var(--ease-drawer)`,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* Drawer header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 17,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Place<span style={{ color: "var(--accent-blue)" }}>IQ</span>
          </span>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
            className="focus-ring"
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-secondary)",
              borderRadius: 6,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Drawer links */}
        <div style={{ padding: "8px 8px", flex: 1 }}>
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.path;
            return (
              <button
                key={link.path}
                onClick={() => router.push(link.path)}
                className="focus-ring"
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: isActive ? "var(--accent-blue-muted)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? "var(--accent-blue)" : "var(--text-secondary)",
                  transition: `background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)`,
                  minHeight: 44,
                }}
              >
                {link.label}
              </button>
            );
          })}
        </div>

        {/* Drawer footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border-subtle)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {session.user?.image && (
              <img
                src={session.user.image}
                alt=""
                style={{ width: 28, height: 28, borderRadius: "50%" }}
              />
            )}
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {session.user?.name?.split(" ")?.[0]}
            </span>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="focus-ring"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--text-tertiary)",
              padding: "6px 4px",
              borderRadius: 4,
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
    </>
  );
}
