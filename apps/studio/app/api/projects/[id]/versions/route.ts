import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await backend().listVersions(id));
  } catch (e) {
    return errorResponse(e);
  }
}
