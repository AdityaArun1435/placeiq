"use client";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center px-6">
      <div className="max-w-3xl text-center">
        <p className="text-sm uppercase tracking-widest text-blue-400 mb-4">
          Beta -- Coming Soon
        </p>
        <h1 className="text-6xl font-bold mb-6">
          Place<span className="text-blue-500">IQ</span>
        </h1>
        <p className="text-xl text-gray-400 mb-10">
          India's first student-facing placement intelligence platform. Know where you stand, which companies to target, and exactly what to do next.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => router.push("/login")}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition"
          >
            Get Early Access
          </button>
          <button className="border border-gray-600 hover:border-gray-400 text-gray-300 px-6 py-3 rounded-lg font-medium transition">
            Learn More
          </button>
        </div>
      </div>
    </main>
  );
}
