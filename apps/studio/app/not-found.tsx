import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid h-dvh place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-[12px] text-dim">404</p>
        <h1 className="mt-3 font-display text-[28px] tracking-[-0.01em]">There’s no deck here</h1>
        <p className="mt-2 text-[13.5px] text-sub">The project may have been removed, or the link is mistyped.</p>
        <Link href="/" className="mt-6 inline-flex h-8 items-center rounded-lg bg-fg px-3 text-[13px] font-medium text-bg hover:bg-white">
          Back to all decks
        </Link>
      </div>
    </main>
  );
}
