export default function LoadingScreen({ message = "Connecting to PlaceIQ..." }: { message?: string }) {
  return (
    <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-400 text-sm">{message}</p>
    </main>
  );
}
