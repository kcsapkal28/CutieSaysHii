// The process-wide StudioBackend: the real agent pipeline by default, the timed fake (lib/mock) with STUDIO_BACKEND=mock.
import type { StudioBackend } from "../backend";
import { MockBackend } from "../mock/backend";
import { RealBackend } from "./real-backend";

const g = globalThis as unknown as { __studioBackend?: StudioBackend };

export function backend(): StudioBackend {
  return (g.__studioBackend ??= process.env.STUDIO_BACKEND === "mock" ? new MockBackend() : new RealBackend());
}
