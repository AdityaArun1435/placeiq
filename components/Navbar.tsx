"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

const NAV_LINKS = [
  { label: "Dashboard",        path: "/dashboard" },
  { label: "Skills",           path: "/skills" },
  { label: "Companies",        path: "/companies" },
  { label: "Roadmap",          path: "/roadmap" },
  { label: "On Campus",        path: "/oncampus" },
  { label: "Off Campus",       path: "/offcampus" },
  { label: "Internships",      path: "/internships" },
  { label: "Tracker",          path: "/tracker" },
  { label: "Market",           path: "/market" },
  { label: "Resume",           path: "/resume" },
  { label: "PYQ",              path: "/pyq" },
  { label: "Referral",         path: "/referral" },
  { label: "Progress",         path: "/progress" },
  { label: "Resources",        path: "/resources" },
  { label: "Company Directory", path: "/company-directory" },
  { label: "College Stats",     path: "/college-stats" },
];

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (status !== "authenticated") return null;

  return (
    <nav className="bg-[#0a0a0a] border-b border-gray-800 sticky top-0 z-50">
      <div className="px-6 py-3 flex items-center gap-4">
        <h1
          className="text-xl font-bold shrink-0 cursor-pointer"
          onClick={() => router.push("/dashboard")}
        >
          Place<span className="text-blue-500">IQ</span>
        </h1>

        <div className="flex-1 overflow-x-auto scrollbar-hide">
          <div className="flex gap-1 whitespace-nowrap">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.path;
              return (
                <button
                  key={link.path}
                  onClick={() => !isActive && router.push(link.path)}
                  className={`text-sm px-3 py-1.5 rounded transition shrink-0 ${
                    isActive
                      ? "text-white bg-white/5 border-b-2 border-blue-500"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {session.user?.image && (
            <img src={session.user.image} className="w-7 h-7 rounded-full" alt="" />
          )}
          <span className="text-gray-400 text-sm hidden md:inline">
            {session.user?.name}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-gray-500 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
