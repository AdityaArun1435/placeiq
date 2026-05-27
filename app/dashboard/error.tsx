"use client";
export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen bg-primary-bg flex flex-col items-center justify-center gap-4">
      <p className="text-red-400 font-semibold">Something went wrong loading the dashboard.</p>
      <button onClick={reset} className="bg-blue-600 hover:bg-blue-500 text-main px-6 py-2.5 rounded-lg text-sm font-medium transition">
        Try again
      </button>
    </main>
  );
}
