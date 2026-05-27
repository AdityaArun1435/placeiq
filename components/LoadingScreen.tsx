export default function LoadingScreen({ message = "Connecting to PlaceIQ..." }: { message?: string }) {
  return (
    <main className="min-h-screen bg-primary-bg flex flex-col items-center justify-center gap-4">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-muted text-sm">{message}</p>
    </main>
  );
}
