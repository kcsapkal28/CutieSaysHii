import { backend } from "@/lib/server/backend-instance";
import { errorResponse, isStage } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  try {
    const { id, stage } = await ctx.params;
    if (!isStage(stage)) return Response.json({ error: `Unknown stage "${stage}"` }, { status: 404 });
    return Response.json(await backend().approveStage(id, stage));
  } catch (e) {
    return errorResponse(e);
  }
}
