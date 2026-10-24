import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";
import type { StageFileName } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILES: StageFileName[] = ["brief.json", "style.json", "research.md", "outline.json"];

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  try {
    const { id, file } = await ctx.params;
    if (!FILES.includes(file as StageFileName)) return Response.json({ error: `Unknown file "${file}"` }, { status: 404 });
    return Response.json(await backend().saveStageFile(id, file as StageFileName, await req.text()));
  } catch (e) {
    return errorResponse(e);
  }
}
