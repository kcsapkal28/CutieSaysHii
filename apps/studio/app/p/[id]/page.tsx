import { redirect } from "next/navigation";
import { backend } from "@/lib/server/backend-instance";
import { STAGES } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Opens a project at the first step that needs attention. */
export default async function ProjectIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await backend().loadProject(id);
  if (!p) redirect("/");
  if (!p.hasStyle) redirect(`/p/${id}/style`);
  if (p.latestVersion && p.stages.build === "approved") redirect(`/p/${id}/deck`);
  const next = STAGES.find((s) => p.stages[s] !== "approved") ?? "build";
  redirect(next === "build" ? `/p/${id}/build` : `/p/${id}/${next}`);
}
