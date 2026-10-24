import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StageView } from "@/components/stage-view";

const DOC_STAGES = ["research", "outline", "script", "storyboard"] as const;
type DocStage = (typeof DOC_STAGES)[number];

export default async function StagePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { stage } = await params;
  if (!(DOC_STAGES as readonly string[]).includes(stage)) notFound();
  return (
    <Suspense>
      <StageView key={stage} stage={stage as DocStage} />
    </Suspense>
  );
}
