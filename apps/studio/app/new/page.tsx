import Link from "next/link";
import { BriefForm } from "@/components/brief-form";
import { IconArrowLeft } from "@/components/icons";

export const metadata = { title: "New deck" };

export default function NewDeck() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-14 max-w-[1200px] items-center px-8">
        <Link href="/" className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-sub transition-colors hover:text-fg">
          <IconArrowLeft size={14} />
          All decks
        </Link>
      </header>
      <main className="px-8 pb-24 pt-10">
        <div className="mx-auto mb-10 max-w-[680px]">
          <p className="text-[12.5px] font-medium text-ember">New deck · Brief</p>
          <h1 className="mt-2 font-display text-[40px] font-normal leading-[1.05] tracking-[-0.02em]">Start with the brief</h1>
          <p className="mt-3 max-w-[56ch] text-[14px] text-sub">
            The agents read this before every stage. Be specific about the audience; it changes what gets explained and what gets skipped.
          </p>
        </div>
        <BriefForm />
      </main>
    </div>
  );
}
