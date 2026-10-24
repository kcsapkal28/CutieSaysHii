import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";
import type { Brief } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const brief = (await req.json()) as Brief;
    if (!brief?.topic) return Response.json({ error: "The brief needs a topic before the stylist can recommend a style." }, { status: 422 });
    return Response.json(await backend().recommendStyle(brief));
  } catch (e) {
    return errorResponse(e);
  }
}
