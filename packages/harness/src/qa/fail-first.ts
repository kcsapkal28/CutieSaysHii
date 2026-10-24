import { InternalError } from "../kernel/errors.ts";
import type { QaPort, QaRequest } from "../kernel/ports.ts";

/** For the patch-loop golden: the first run fails the picked slide (overflow); later runs delegate. */
export function failFirstQa(inner: QaPort, pickSlide: (req: QaRequest) => string): QaPort {
  let failNext = true;
  return {
    run: async (req, signal) => {
      const fail = failNext;
      failNext = false;
      const report = await inner.run(req, signal);
      if (!fail) return report;
      const id = pickSlide(req);
      if (!report.slides.some((s) => s.id === id)) throw new InternalError(`failFirstQa picked slide ${id}, which is not in the QA report`);
      return { ...report, pass: false, slides: report.slides.map((s) => (s.id === id ? { ...s, overflow: true } : s)) };
    },
  };
}
