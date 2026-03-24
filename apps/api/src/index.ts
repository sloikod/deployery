import http, { ServerResponse, type IncomingMessage } from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";

import httpProxy from "http-proxy";
import { collectDefaultMetrics, Counter, Registry } from "prom-client";

import { loadPersistenceOptionsFromEnv } from "@deployery/persistence";
import { WorkflowEngine } from "@deployery/workflow-engine";

interface JsonResponse {
  statusCode?: number;
  body: unknown;
}

interface SandboxRuntimeInfo {
  isolationMode: string;
  runtime: string;
  rootfsPath: string;
  homePath: string;
  codeServerPort: number;
}

const VALID_WORKFLOW_NAME = /^[a-z][a-z0-9-]*$/;

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function sendJson(response: ServerResponse, payload: JsonResponse): void {
  response.statusCode = payload.statusCode ?? 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload.body));
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  response.end(body);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseOptionalJson(buffer: Buffer): unknown {
  if (buffer.length === 0) {
    return null;
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function getRequestOrigin(request: IncomingMessage): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto : "http";
  const host = request.headers.host ?? "localhost:3131";
  return `${protocol}://${host}`;
}

function extractApiKey(request: IncomingMessage): string | null {
  const headerKey = request.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.length > 0) {
    return headerKey;
  }

  const authorization = request.headers.authorization;
  if (
    typeof authorization === "string" &&
    authorization.startsWith("Bearer ")
  ) {
    return authorization.slice("Bearer ".length);
  }

  return null;
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "3131", 10);
  const codeServerPort = Number.parseInt(
    getEnv("DEPLOYERY_CODE_SERVER_PORT", "13337"),
    10,
  );
  const sandboxRootfsPath = getEnv("DEPLOYERY_SANDBOX_ROOTFS", "/");
  const sandboxHomePath = getEnv("DEPLOYERY_SANDBOX_HOME", "/home/user");
  const sandboxIsolationMode = getEnv(
    "DEPLOYERY_SANDBOX_ISOLATION_MODE",
    "compatibility",
  );
  const sandboxRuntime = getEnv("DEPLOYERY_SANDBOX_RUNTIME", "docker");
  const sqlitePath =
    process.env.DB_SQLITE_PATH ??
    getEnv("DEPLOYERY_SQLITE_PATH", "/var/lib/deployery/data/deployery.sqlite");
  const persistence = loadPersistenceOptionsFromEnv(sqlitePath);
  const baseUrl = process.env.DEPLOYERY_BASE_URL;
  const sandboxRuntimeInfo: SandboxRuntimeInfo = {
    isolationMode: sandboxIsolationMode,
    runtime: sandboxRuntime,
    rootfsPath: sandboxRootfsPath,
    homePath: sandboxHomePath,
    codeServerPort,
  };

  if (persistence.type === "sqlite") {
    fs.mkdirSync(path.dirname(persistence.sqlitePath ?? sqlitePath), {
      recursive: true,
    });
  }

  const engine = new WorkflowEngine({
    persistence,
    sandboxRootfsPath,
    sandboxHomePath,
    baseUrl,
    logger: {
      info(message) {
        console.log(message);
      },
      warn(message) {
        console.warn(message);
      },
      error(message) {
        console.error(message);
      },
    },
  });
  await engine.start();
  let engineReady = true;

  console.log(
    `Deployery sandbox runtime ready: mode=${sandboxRuntimeInfo.isolationMode} runtime=${sandboxRuntimeInfo.runtime} rootfs=${sandboxRuntimeInfo.rootfsPath}`,
  );

  const metricsRegistry = new Registry();
  collectDefaultMetrics({ register: metricsRegistry });
  const requestCounter = new Counter({
    name: "deployery_http_requests_total",
    help: "Count of HTTP requests served by the Deployery API",
    labelNames: ["method", "route", "status_code"],
    registers: [metricsRegistry],
  });

  const proxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${codeServerPort}`,
    changeOrigin: false,
    xfwd: true,
    ws: true,
  });

  proxy.on("error", (_error, _request, response) => {
    if (response instanceof ServerResponse) {
      sendJson(response, {
        statusCode: 502,
        body: {
          error: "code-server is unavailable",
        },
      });
    }
  });

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", getRequestOrigin(request));
    const pathname = requestUrl.pathname;

    const finish = (route: string, statusCode: number) => {
      requestCounter.inc({
        method,
        route,
        status_code: String(statusCode),
      });
    };

    try {
      if (method === "GET" && pathname === "/healthz") {
        sendJson(response, {
          body: {
            status: "ok",
            sandbox: {
              isolationMode: sandboxRuntimeInfo.isolationMode,
              runtime: sandboxRuntimeInfo.runtime,
            },
          },
        });
        finish("/healthz", 200);
        return;
      }

      if (method === "GET" && pathname === "/healthz/readiness") {
        const ready = fs.existsSync(sandboxRootfsPath) && engineReady;
        sendJson(response, {
          statusCode: ready ? 200 : 503,
          body: {
            status: ready ? "ready" : "starting",
            sandbox: {
              isolationMode: sandboxRuntimeInfo.isolationMode,
              runtime: sandboxRuntimeInfo.runtime,
              rootfsPath: sandboxRuntimeInfo.rootfsPath,
            },
          },
        });
        finish("/healthz/readiness", ready ? 200 : 503);
        return;
      }

      if (method === "GET" && pathname === "/api/v1/runtime") {
        sendJson(response, {
          body: sandboxRuntimeInfo,
        });
        finish("/api/v1/runtime", 200);
        return;
      }

      if (method === "GET" && pathname === "/metrics") {
        const body = await metricsRegistry.metrics();
        sendText(response, 200, body, metricsRegistry.contentType);
        finish("/metrics", 200);
        return;
      }

      const isApiRoute = pathname.startsWith("/api/");
      if (isApiRoute) {
        const apiKeyCount = await engine.store.asyncKeyCount();
        if (apiKeyCount > 0) {
          const apiKey = extractApiKey(request);
          if (!apiKey || !(await engine.store.verifyApiKey(apiKey))) {
            sendJson(response, {
              statusCode: 401,
              body: {
                error: "invalid api key",
              },
            });
            finish("/api/*", 401);
            return;
          }
        }
      }

      if (method === "GET" && pathname === "/api/v1/workflows") {
        sendJson(response, {
          body: await engine.listWorkflows(),
        });
        finish("/api/v1/workflows", 200);
        return;
      }

      if (method === "POST" && pathname === "/api/v1/workflows") {
        const body = parseOptionalJson(await readRequestBody(request));
        const payload = (body ?? {}) as { name?: string; manifest?: unknown };
        if (!payload.name || !payload.manifest) {
          sendJson(response, {
            statusCode: 400,
            body: {
              error: "name and manifest are required",
            },
          });
          finish("/api/v1/workflows", 400);
          return;
        }

        if (!VALID_WORKFLOW_NAME.test(payload.name)) {
          sendJson(response, {
            statusCode: 400,
            body: {
              error: "workflow name must match /^[a-z][a-z0-9-]*$/",
            },
          });
          finish("/api/v1/workflows", 400);
          return;
        }

        const workflow = await engine.saveWorkflow(
          payload.name,
          payload.manifest,
        );
        sendJson(response, {
          statusCode: 201,
          body: workflow,
        });
        finish("/api/v1/workflows", 201);
        return;
      }

      const workflowIdMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
      if (method === "GET" && workflowIdMatch) {
        const workflow = await engine.getWorkflow(workflowIdMatch[1]);
        if (!workflow) {
          sendJson(response, {
            statusCode: 404,
            body: {
              error: "workflow not found",
            },
          });
          finish("/api/v1/workflows/:id", 404);
          return;
        }

        sendJson(response, {
          body: workflow,
        });
        finish("/api/v1/workflows/:id", 200);
        return;
      }

      const triggerMatch = pathname.match(
        /^\/api\/v1\/workflows\/([^/]+)\/trigger$/,
      );
      if (method === "POST" && triggerMatch) {
        const body = parseOptionalJson(await readRequestBody(request));
        const payload = (body ?? {}) as { data?: unknown };
        const run = await engine.triggerWorkflow({
          workflowId: triggerMatch[1],
          triggerType: "manual",
          input: (payload.data ?? null) as never,
          triggerSource: "api",
        });
        sendJson(response, {
          statusCode: 202,
          body: run,
        });
        finish("/api/v1/workflows/:id/trigger", 202);
        return;
      }

      const runsMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/runs$/);
      if (method === "GET" && runsMatch) {
        const limit = requestUrl.searchParams.get("limit");
        const status = requestUrl.searchParams.get("status");
        const runs = await engine.listRuns(
          runsMatch[1],
          limit ? Number.parseInt(limit, 10) : undefined,
          (status as never) ?? undefined,
        );
        sendJson(response, {
          body: runs,
        });
        finish("/api/v1/workflows/:id/runs", 200);
        return;
      }

      const workflowRunMatch = pathname.match(
        /^\/api\/v1\/workflows\/([^/]+)\/runs\/([^/]+)$/,
      );
      if (method === "GET" && workflowRunMatch) {
        const run = await engine.getRun(workflowRunMatch[2]);
        if (!run || run.workflowId !== workflowRunMatch[1]) {
          sendJson(response, {
            statusCode: 404,
            body: {
              error: "run not found",
            },
          });
          finish("/api/v1/workflows/:id/runs/:runId", 404);
          return;
        }

        sendJson(response, {
          body: run,
        });
        finish("/api/v1/workflows/:id/runs/:runId", 200);
        return;
      }

      const runByIdMatch = pathname.match(
        /^\/api\/v1\/workflows\/runs\/([^/]+)$/,
      );
      if (method === "GET" && runByIdMatch) {
        const run = await engine.getRun(runByIdMatch[1]);
        if (!run) {
          sendJson(response, {
            statusCode: 404,
            body: {
              error: "run not found",
            },
          });
          finish("/api/v1/workflows/runs/:runId", 404);
          return;
        }

        sendJson(response, {
          body: run,
        });
        finish("/api/v1/workflows/runs/:runId", 200);
        return;
      }

      const logsMatch = pathname.match(
        /^\/api\/v1\/workflows\/([^/]+)\/runs\/([^/]+)\/logs$/,
      );
      if (method === "GET" && logsMatch) {
        const run = await engine.getRun(logsMatch[2]);
        if (!run || run.workflowId !== logsMatch[1]) {
          sendJson(response, {
            statusCode: 404,
            body: {
              error: "run not found",
            },
          });
          finish("/api/v1/workflows/:id/runs/:runId/logs", 404);
          return;
        }

        const after = requestUrl.searchParams.get("after");
        const logs = await engine.listRunLogs(
          logsMatch[2],
          after ? Number.parseInt(after, 10) : undefined,
        );
        sendJson(response, {
          body: logs,
        });
        finish("/api/v1/workflows/:id/runs/:runId/logs", 200);
        return;
      }

      const cancelMatch = pathname.match(
        /^\/api\/v1\/workflows\/([^/]+)\/runs\/([^/]+)\/cancel$/,
      );
      if (method === "POST" && cancelMatch) {
        const run = await engine.getRun(cancelMatch[2]);
        if (!run || run.workflowId !== cancelMatch[1]) {
          sendJson(response, {
            statusCode: 404,
            body: {
              error: "run not found",
            },
          });
          finish("/api/v1/workflows/:id/runs/:runId/cancel", 404);
          return;
        }

        const cancelled = await engine.cancelRun(run.id);
        sendJson(response, {
          body: cancelled,
        });
        finish("/api/v1/workflows/:id/runs/:runId/cancel", 200);
        return;
      }

      const webhookUrlsMatch = pathname.match(
        /^\/api\/v1\/workflows\/([^/]+)\/webhook-urls$/,
      );
      if (method === "GET" && webhookUrlsMatch) {
        const urls = await engine.getWebhookUrls(
          webhookUrlsMatch[1],
          getRequestOrigin(request),
        );
        sendJson(response, {
          body: urls,
        });
        finish("/api/v1/workflows/:id/webhook-urls", 200);
        return;
      }

      const webhookTriggerMatch = pathname.match(
        /^\/webhook\/trigger\/([^/]+)(?:\/([^/]+))?$/,
      );
      if (method === "POST" && webhookTriggerMatch) {
        const rawBody = await readRequestBody(request);
        const jsonBody = parseOptionalJson(rawBody);
        const run = await engine.triggerWebhook(webhookTriggerMatch[1], {
          method,
          headers: request.headers,
          rawBody,
          jsonBody: (jsonBody ?? null) as never,
          requestUrl: requestUrl.toString(),
          providedSecret: webhookTriggerMatch[2] ?? null,
        });
        sendJson(response, {
          statusCode: 202,
          body: run,
        });
        finish("/webhook/trigger/:workflowId", 202);
        return;
      }

      const webhookResumeMatch = pathname.match(/^\/webhook\/resume\/([^/]+)$/);
      if (method === "POST" && webhookResumeMatch) {
        const rawBody = await readRequestBody(request);
        const jsonBody = parseOptionalJson(rawBody);
        const resumed = await engine.resumeRun(
          webhookResumeMatch[1],
          (jsonBody ?? null) as never,
        );
        sendJson(response, {
          body: resumed,
        });
        finish("/webhook/resume/:resumeToken", 200);
        return;
      }

      proxy.web(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, {
        statusCode: 500,
        body: {
          error: message,
        },
      });
      finish("error", 500);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", getRequestOrigin(request));
    if (
      requestUrl.pathname.startsWith("/api/") ||
      requestUrl.pathname.startsWith("/webhook/")
    ) {
      socket.destroy();
      return;
    }
    proxy.ws(request, socket, head);
  });

  server.listen(port, () => {
    console.log(`Deployery API listening on http://0.0.0.0:${port}`);
  });

  const shutdown = () => {
    engineReady = false;
    server.close(() => {
      void engine
        .stop()
        .then(() => {
          process.exit(0);
        })
        .catch((error) => {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        });
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
