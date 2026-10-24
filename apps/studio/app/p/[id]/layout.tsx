import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectShell } from "@/components/project-shell";
import { backend } from "@/lib/server/backend-instance";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await backend().loadProject(id);
  return { title: p?.title ?? "Not found" };
}

export default async function ProjectLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params;
  const project = await backend().loadProject(id);
  if (!project) notFound();
  return (
    <ProjectShell key={project.id} initial={project}>
      {children}
    </ProjectShell>
  );
}
