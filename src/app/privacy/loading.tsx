// Streaming skeleton — shows instantly while the static page content renders.
export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-2xl space-y-4">
        <div className="h-8 w-56 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-4 w-full rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-40 w-full rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-4 w-full rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-4 w-4/6 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
      </div>
    </div>
  )
}
