import http from "node:http";
import type { AddressInfo } from "node:net";

export type Scripted = { status?: number; error?: string; content?: string; finishReason?: string; cost?: number; headers?: Record<string, string> };

/** Replies with exactly the marks the output instructions ask for, as a well-behaved Model would. */
export function validReply(prompt: string) {
  const instructions = prompt.slice(prompt.lastIndexOf("Reply with only a JSON object"));
  const shape = JSON.parse(instructions.split("\n")[1]) as { lines: Record<string, { marks?: number[]; total?: number }> };
  const lines = Object.fromEntries(
    Object.entries(shape.lines).map(([label, l]) => [
      label,
      l.marks ? { marks: l.marks.map((_, i) => (i === 0 ? 1 : 0)) } : { total: 1 },
    ]),
  );
  return JSON.stringify({ lines, reason: "Partly right." });
}

/** An OpenAI-compatible server whose replies depend on the Model's name or a test's script. */
export class FakeLlmEndpoint {
  server!: http.Server;
  url = "";
  requests: { model: string; body: Record<string, unknown> }[] = [];
  script?: (body: { model: string; prompt: string; responseFormat: unknown }) => Scripted;
  private seen = new Map<string, number>();

  async start(port = 0) {
    this.server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => this.handle(req, res, raw));
    });
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
    return this;
  }

  stop() {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(resolve));
  }

  private byName(model: string, prompt: string): Scripted {
    const n = (this.seen.get(prompt + model) ?? 0) + 1;
    this.seen.set(prompt + model, n);
    if (model === "flaky" && n === 1) return { status: 429, error: "Slow down", headers: { "retry-after": "1" } };
    if (model === "rambling") return { content: "I think about two marks." };
    if (model === "broken") return { status: 500, error: "The provider is down" };
    return { content: validReply(prompt), cost: 0.0002 };
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string) {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.url?.endsWith("/models")) {
      return send(200, {
        object: "list",
        data: ["steady", "flaky", "rambling", "broken"].map((id) => ({
          id,
          object: "model",
          pricing: { prompt: "0.000001", completion: "0.000002" },
        })),
      });
    }
    const body = JSON.parse(raw);
    this.requests.push({ model: body.model, body });
    const prompt = body.messages.at(-1).content as string;
    const scripted = this.script
      ? this.script({ model: body.model, prompt, responseFormat: body.response_format })
      : this.byName(body.model, prompt);
    if (scripted.status && scripted.status >= 400) {
      return send(scripted.status, { error: { message: scripted.error ?? "error" } }, scripted.headers);
    }
    return send(200, {
      id: "x",
      object: "chat.completion",
      created: 0,
      model: body.model,
      choices: [
        { index: 0, finish_reason: scripted.finishReason ?? "stop", message: { role: "assistant", content: scripted.content ?? "" } },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, ...(scripted.cost === undefined ? {} : { cost: scripted.cost }) },
    });
  }
}
