import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = { method: string; path: string; headers: IncomingHttpHeaders; body: unknown };

export type FakeResponse =
  | { status?: number; headers?: Record<string, string>; body?: unknown }
  /** Holds the request open until the client goes away. */
  | { hang: true };

export type FakeServerOptions = {
  /** Sends `x-proxy-controls: 1` on every response unless false. */
  controls?: boolean;
  /** Answers GET /v1/models; defaults to a one-model page. */
  models?: FakeResponse;
};

export type FakeServer = {
  baseUrl: string;
  requests: RecordedRequest[];
  /** Queues responses for POST /v1/messages, served in order. */
  reply(...responses: FakeResponse[]): void;
  /** How many held (`hang`) requests the client has closed. */
  closedHangs(): number;
  close(): Promise<void>;
};

const MODELS_PAGE = {
  data: [{ type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-01-01T00:00:00Z" }],
  has_more: false,
  first_id: "claude-sonnet-5-5",
  last_id: "claude-sonnet-5-5",
};

export async function startFakeServer(opts: FakeServerOptions = {}): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const queue: FakeResponse[] = [];
  let hangsClosed = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const path = req.url ?? "";
      requests.push({ method: req.method ?? "", path, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });

      const scripted = path.startsWith("/v1/models")
        ? (opts.models ?? { body: MODELS_PAGE })
        : (queue.shift() ?? { status: 500, body: { type: "error", error: { type: "api_error", message: "fake server: no reply queued" } } });

      if ("hang" in scripted) {
        res.on("close", () => (hangsClosed += 1));
        return;
      }
      const headers: Record<string, string> = { "content-type": "application/json", ...scripted.headers };
      if (opts.controls !== false) headers["x-proxy-controls"] = "1";
      res.writeHead(scripted.status ?? 200, headers);
      res.end(JSON.stringify(scripted.body ?? {}));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    reply: (...responses) => queue.push(...responses),
    closedHangs: () => hangsClosed,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

/** A loopback port that refuses connections: bound, then released. Never port 1, which fetch blocks before connecting. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export function apiError(status: number, type: string, message: string, headers?: Record<string, string>): FakeResponse {
  return { status, headers, body: { type: "error", error: { type, message }, request_id: `req_fake_${status}` } };
}

export function toolMessage(over: { content?: unknown[]; stop_reason?: string; stop_details?: unknown; usage?: unknown } = {}) {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: over.content ?? [{ type: "tool_use", id: "toolu_1", name: "emit_design", input: { ok: true } }],
    stop_reason: over.stop_reason ?? "tool_use",
    stop_sequence: null,
    stop_details: over.stop_details ?? null,
    usage: over.usage ?? { input_tokens: 4, output_tokens: 139, cache_read_input_tokens: 3275, cache_creation_input_tokens: 0 },
  };
}
