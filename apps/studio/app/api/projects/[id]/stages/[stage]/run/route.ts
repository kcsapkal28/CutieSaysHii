import { backend } from "@/lib/server/backend-instance";
import { errorResponse, isStage, sse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST → SSE stream of the stage run. The run is detached: closing the stream does not stop it. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  try {
    const { id, stage } = await ctx.params;
    if (!isStage(stage)) return Response.json({ error: `Unknown stage "${stage}"` }, { status: 404 });
    if (!(await backend().loadProject(id))) return Response.json({ error: `No project "${id}"` }, { status: 404 });
    return sse((signal) => backend().runStage(id, stage, { signal }), req.signal);
  } catch (e) {
    return errorResponse(e);
  }
}
