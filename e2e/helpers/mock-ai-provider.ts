import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export type MockAiRequest = {
  method?: string;
  url?: string;
  body: unknown;
};

export type MockAiProvider = {
  baseUrl: string;
  requests: MockAiRequest[];
  stop: () => Promise<void>;
};

export type MockAiProviderOptions = {
  response?: string | ((request: MockAiRequest, requestIndex: number) => string);
  protocol?: "chat_completions" | "openai_responses";
  models?: string[];
  actualSpeed?: string;
};

const defaultResponse = "## Mock 自动化结果\n- 已读取授权范围\n- 下一步建议：继续复盘";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

/** 启动本地 Chat Completions 或 Responses 兼容服务，只供 E2E 成功态回归使用。 */
export async function startMockAiProvider(options: MockAiProviderOptions = {}): Promise<MockAiProvider> {
  const requests: MockAiRequest[] = [];
  const server = createServer((request, response) => {
    void readJson(request)
      .then((body) => {
        const mockRequest = { method: request.method, url: request.url, body };
        if (request.method === "GET" && request.url === "/v1/models") {
          requests.push(mockRequest);
          writeJson(response, 200, { data: (options.models ?? ["gpt-5.5"]).map((id) => ({ id, status: "active" })) });
          return;
        }
        const expectedPath = options.protocol === "openai_responses" ? "/v1/responses" : "/v1/chat/completions";
        if (request.method !== "POST" || request.url !== expectedPath) {
          writeJson(response, 404, { error: "not found" });
          return;
        }
        requests.push(mockRequest);
        const content = typeof options.response === "function"
          ? options.response(mockRequest, requests.length - 1)
          : options.response ?? defaultResponse;
        if (options.protocol === "openai_responses") {
          const input = body as { stream?: boolean };
          if (input.stream) {
            response.writeHead(200, { "Content-Type": "text/event-stream", "x-request-id": `mock-${requests.length}` });
            response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: content })}\n\n`);
            response.write(`data: ${JSON.stringify({ type: "response.completed", response: { id: `mock-${requests.length}`, service_tier: options.actualSpeed ?? "priority", usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } })}\n\n`);
            response.end();
            return;
          }
          writeJson(response, 200, {
            id: `mock-${requests.length}`,
            output_text: content,
            service_tier: options.actualSpeed ?? "priority",
            usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
          });
          return;
        }
        writeJson(response, 200, {
          id: `mock-${requests.length}`,
          choices: [{ message: { role: "assistant", content } }],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        });
      })
      .catch((error) => writeJson(response, 500, { error: error instanceof Error ? error.message : "mock error" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    stop: () => closeServer(server),
  };
}
