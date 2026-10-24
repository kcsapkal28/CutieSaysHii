import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { StageView } from "@/components/stage-view";

const DOC_STAGES = ["research", "outline"] as const;
type DocStage = (typeof DOC_STAGES)[number];
/** Script and Storyboard are part of the Outline stage now; old links land there. */
const MERGED = ["script", "storyboard"];

export default async function StagePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  if (MERGED.includes(stage)) redirect(`/p/${id}/outline`);
  if (!(DOC_STAGES as readonly string[]).includes(stage)) notFound();
  return (
    <Suspense>
      <StageView key={stage} stage={stage as DocStage} />
    </Suspense>
  );
}
