import { BriefForm } from "@/components/brief-form";
import { backend } from "@/lib/server/backend-instance";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = (await backend().loadProject(id))!;
  return (
    <div className="h-full overflow-y-auto px-10 pb-24 pt-12">
      <div className="mx-auto mb-10 max-w-[680px]">
        <h1 className="font-display text-[32px] font-normal leading-[1.1] tracking-[-0.02em]">Brief</h1>
        <p className="mt-2 text-[13.5px] text-sub">Changes apply to stages you run from now on. Re-run a stage to pick them up.</p>
      </div>
      <BriefForm initial={p.brief} projectId={id} />
    </div>
  );
}
