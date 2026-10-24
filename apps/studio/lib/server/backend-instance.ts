// The process-wide StudioBackend. Swap MockBackend for the pipeline adapter here at merge time.
import type { StudioBackend } from "../backend";
import { MockBackend } from "../mock/backend";

const g = globalThis as unknown as { __studioBackend?: StudioBackend };

export function backend(): StudioBackend {
  return (g.__studioBackend ??= new MockBackend());
}
