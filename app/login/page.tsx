"use client";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
      <div className="bg-[#111] border border-gray-800 rounded-2xl p-10 w-full max-w-md text-center">
        <h1 className="text-3xl font-bold mb-2">
          Place<span className="text-blue-500">IQ</span>
        </h1>
        <p className="text-gray-400 mb-8">Sign in to track your placement journey</p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="w-full flex items-center justify-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" />
          Continue with Google
        </button>
      </div>
    </main>
  );
}
