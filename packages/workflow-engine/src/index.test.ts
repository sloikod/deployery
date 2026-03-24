import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowEngine } from "./index";

const SANDBOX = "/sandbox";

const MINIMAL_MANIFEST = {
  triggers: [{ type: "manual" as const }],
  steps: [{ type: "command" as const, name: "run", command: "echo hi" }],
};

const WEBHOOK_MANIFEST = {
  triggers: [{ type: "webhook" as const, method: "POST" }],
  steps: [{ type: "command" as const, name: "run", command: "echo hi" }],
};

const WEBHOOK_SECRET_MANIFEST = {
  triggers: [{ type: "webhook" as const, method: "POST", secret: "my-secret" }],
  steps: [{ type: "command" as const, name: "run", command: "echo hi" }],
};

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function createEngine(baseUrl?: string) {
  return new WorkflowEngine({
    sandboxRootfsPath: SANDBOX,
    persistence: { type: "sqlite", sqlitePath: ":memory:" },
    logger: silentLogger(),
    ...(baseUrl ? { baseUrl } : {}),
  });
}

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine;

  beforeEach(async () => {
    vi.useFakeTimers();
    engine = createEngine();
    await engine.store.init();
  });

  afterEach(async () => {
    await engine.store.close();
    vi.useRealTimers();
  });

  describe("saveWorkflow / listWorkflows / getWorkflow / getWorkflowByName", () => {
    it("listWorkflows returns empty initially", async () => {
      expect(await engine.listWorkflows()).toEqual([]);
    });

    it("saveWorkflow stores and returns the workflow", async () => {
      const workflow = await engine.saveWorkflow(
        "my-workflow",
        MINIMAL_MANIFEST,
      );
      expect(workflow.id).toBeTruthy();
      expect(workflow.name).toBe("my-workflow");
      expect(workflow.enabled).toBe(true);
    });

    it("getWorkflow returns null for unknown id", async () => {
      expect(await engine.getWorkflow("nonexistent")).toBeNull();
    });

    it("getWorkflowByName returns null for unknown name", async () => {
      expect(await engine.getWorkflowByName("nonexistent")).toBeNull();
    });

    it("getWorkflow retrieves by id", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      const fetched = await engine.getWorkflow(workflow.id);
      expect(fetched?.id).toBe(workflow.id);
    });

    it("getWorkflowByName retrieves by name", async () => {
      const workflow = await engine.saveWorkflow("named-wf", MINIMAL_MANIFEST);
      const fetched = await engine.getWorkflowByName("named-wf");
      expect(fetched?.id).toBe(workflow.id);
    });

    it("saveWorkflow rejects invalid manifest", async () => {
      await expect(
        engine.saveWorkflow("bad", { triggers: [] }),
      ).rejects.toThrow();
    });

    it("saveWorkflow stores scheduled triggers for schedule-type triggers", async () => {
      const schedManifest = {
        triggers: [{ type: "schedule" as const, cron: "0 * * * *" }],
        steps: MINIMAL_MANIFEST.steps,
      };
      const workflow = await engine.saveWorkflow("sched-wf", schedManifest);
      const triggers = await engine.store.listScheduledTriggers(workflow.id);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].cron).toBe("0 * * * *");
    });
  });

  describe("triggerWorkflow", () => {
    it("throws when workflow not found by id", async () => {
      await expect(
        engine.triggerWorkflow({
          workflowId: "nonexistent",
          triggerType: "manual",
        }),
      ).rejects.toThrow("workflow not found");
    });

    it("throws when workflow not found by name", async () => {
      await expect(
        engine.triggerWorkflow({
          workflowName: "nonexistent",
          triggerType: "manual",
        }),
      ).rejects.toThrow("workflow not found");
    });

    it("throws when neither workflowId nor workflowName provided", async () => {
      await expect(
        engine.triggerWorkflow({ triggerType: "manual" }),
      ).rejects.toThrow("workflow not found");
    });

    it("throws when workflow is disabled", async () => {
      const workflow = await engine.saveWorkflow(
        "disabled-wf",
        MINIMAL_MANIFEST,
      );
      await engine.store.db.run(
        `UPDATE workflows SET enabled = 0 WHERE id = ?`,
        [workflow.id],
      );
      await expect(
        engine.triggerWorkflow({
          workflowId: workflow.id,
          triggerType: "manual",
        }),
      ).rejects.toThrow("workflow is disabled");
    });

    it("creates a run with correct initial state", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      const run = await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      expect(run.workflowId).toBe(workflow.id);
      expect(run.status).toBe("queued");
      expect(run.triggerType).toBe("manual");
      expect(run.currentStep).toBe(0);
      expect(run.stepRuns).toHaveLength(1);
      expect(run.stepRuns[0].name).toBe("run");
      expect(run.stepRuns[0].status).toBe("pending");
    });

    it("passes input to the run", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      const run = await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
        input: { data: "value" },
        triggerSource: "user",
      });
      expect(run.input).toEqual({ data: "value" });
      expect(run.triggerSource).toBe("user");
    });

    it("can trigger by name", async () => {
      await engine.saveWorkflow("named-wf", MINIMAL_MANIFEST);
      const run = await engine.triggerWorkflow({
        workflowName: "named-wf",
        triggerType: "manual",
      });
      expect(run.triggerType).toBe("manual");
    });
  });

  describe("cancelRun", () => {
    it("throws when run not found", async () => {
      await expect(engine.cancelRun("nonexistent")).rejects.toThrow(
        "run not found",
      );
    });

    it("cancels an existing run", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      const run = await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      const cancelled = await engine.cancelRun(run.id);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.finishedAt).toBeTruthy();
    });
  });

  describe("listRuns / getRun / listRunLogs", () => {
    it("getRun returns null for unknown id", async () => {
      expect(await engine.getRun("nonexistent")).toBeNull();
    });

    it("listRuns returns runs for a workflow", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      const runs = await engine.listRuns(workflow.id);
      expect(runs).toHaveLength(2);
    });

    it("listRunLogs returns logs for a run", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      const run = await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      await engine.store.appendRunLog(
        run.id,
        workflow.id,
        "system",
        "test log",
      );
      const logs = await engine.listRunLogs(run.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].chunk).toBe("test log");
    });
  });

  describe("getWebhookUrls", () => {
    it("throws when workflow not found", async () => {
      await expect(engine.getWebhookUrls("nonexistent")).rejects.toThrow(
        "workflow not found",
      );
    });

    it("uses default localhost when no baseUrl or requestOrigin", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_MANIFEST);
      const urls = await engine.getWebhookUrls(workflow.id);
      expect(urls.trigger).toBe(
        `http://localhost:3131/webhook/trigger/${workflow.id}`,
      );
      expect(urls.resumeTemplate).toBe(
        "http://localhost:3131/webhook/resume/{resumeToken}",
      );
    });

    it("uses engine baseUrl option", async () => {
      const eng = createEngine("https://myapp.example.com");
      await eng.store.init();
      const workflow = await eng.saveWorkflow("wf", WEBHOOK_MANIFEST);
      const urls = await eng.getWebhookUrls(workflow.id);
      expect(urls.trigger).toContain("https://myapp.example.com/");
      await eng.store.close();
    });

    it("strips trailing slash from baseUrl", async () => {
      const eng = createEngine("https://myapp.example.com/");
      await eng.store.init();
      const workflow = await eng.saveWorkflow("wf", WEBHOOK_MANIFEST);
      const urls = await eng.getWebhookUrls(workflow.id);
      expect(urls.trigger).toContain("https://myapp.example.com/webhook/");
      await eng.store.close();
    });

    it("uses requestOrigin when no baseUrl", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_MANIFEST);
      const urls = await engine.getWebhookUrls(
        workflow.id,
        "https://origin.example.com",
      );
      expect(urls.trigger).toContain("https://origin.example.com/");
    });

    it("includes encoded secret segment when webhook trigger has secret", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_SECRET_MANIFEST);
      const urls = await engine.getWebhookUrls(workflow.id);
      expect(urls.trigger).toContain("/my-secret");
    });

    it("excludes secret segment when no webhook secret", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_MANIFEST);
      const urls = await engine.getWebhookUrls(workflow.id);
      expect(urls.trigger).toBe(
        `http://localhost:3131/webhook/trigger/${workflow.id}`,
      );
    });
  });

  describe("triggerWebhook", () => {
    const rawBody = Buffer.from(JSON.stringify({ data: "value" }));
    const jsonBody = { data: "value" };

    it("throws when workflow not found", async () => {
      await expect(
        engine.triggerWebhook("nonexistent", {
          method: "POST",
          headers: {},
          rawBody,
          jsonBody,
          requestUrl: "http://example.com/hook",
        }),
      ).rejects.toThrow("workflow not found");
    });

    it("throws when workflow has no webhook trigger", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      await expect(
        engine.triggerWebhook(workflow.id, {
          method: "POST",
          headers: {},
          rawBody,
          jsonBody,
          requestUrl: "http://example.com/hook",
        }),
      ).rejects.toThrow("workflow has no webhook trigger");
    });

    it("throws on method mismatch", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_MANIFEST);
      await expect(
        engine.triggerWebhook(workflow.id, {
          method: "GET",
          headers: {},
          rawBody,
          jsonBody,
          requestUrl: "http://example.com/hook",
        }),
      ).rejects.toThrow("webhook method not allowed");
    });

    it("throws on secret mismatch", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_SECRET_MANIFEST);
      await expect(
        engine.triggerWebhook(workflow.id, {
          method: "POST",
          headers: {},
          rawBody,
          jsonBody,
          requestUrl: "http://example.com/hook",
          providedSecret: "wrong-secret",
        }),
      ).rejects.toThrow("webhook secret mismatch");
    });

    it("creates a run when secret matches", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_SECRET_MANIFEST);
      const run = await engine.triggerWebhook(workflow.id, {
        method: "POST",
        headers: {},
        rawBody,
        jsonBody,
        requestUrl: "http://example.com/hook",
        providedSecret: "my-secret",
      });
      expect(run.triggerType).toBe("webhook");
    });

    it("creates a run for webhook without secret", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_MANIFEST);
      const run = await engine.triggerWebhook(workflow.id, {
        method: "POST",
        headers: {},
        rawBody,
        jsonBody,
        requestUrl: "http://example.com/hook",
      });
      expect(run.status).toBe("queued");
      expect(run.input).toEqual(jsonBody);
    });

    it("uses raw body as input when jsonBody is null", async () => {
      const workflow = await engine.saveWorkflow("wf", WEBHOOK_MANIFEST);
      const run = await engine.triggerWebhook(workflow.id, {
        method: "POST",
        headers: {},
        rawBody: Buffer.from("plain text"),
        jsonBody: null,
        requestUrl: "http://example.com/hook",
      });
      expect((run.input as Record<string, unknown>)?.raw).toBe("plain text");
    });

    describe("header verification", () => {
      const headerManifest = {
        triggers: [
          {
            type: "webhook" as const,
            method: "POST",
            verification: {
              mode: "header" as const,
              header_name: "X-Secret-Token",
              header_value: "expected-value",
            },
          },
        ],
        steps: MINIMAL_MANIFEST.steps,
      };

      it("throws when header value is wrong", async () => {
        const workflow = await engine.saveWorkflow("wf", headerManifest);
        await expect(
          engine.triggerWebhook(workflow.id, {
            method: "POST",
            headers: { "x-secret-token": "wrong-value" },
            rawBody,
            jsonBody,
            requestUrl: "http://example.com/hook",
          }),
        ).rejects.toThrow("webhook verification failed");
      });

      it("succeeds with correct header value", async () => {
        const workflow = await engine.saveWorkflow("wf", headerManifest);
        const run = await engine.triggerWebhook(workflow.id, {
          method: "POST",
          headers: { "X-Secret-Token": "expected-value" },
          rawBody,
          jsonBody,
          requestUrl: "http://example.com/hook",
        });
        expect(run.status).toBe("queued");
      });

      it("normalizes header names to lowercase", async () => {
        const workflow = await engine.saveWorkflow("wf", headerManifest);
        const run = await engine.triggerWebhook(workflow.id, {
          method: "POST",
          headers: { "X-SECRET-TOKEN": "expected-value" },
          rawBody,
          jsonBody,
          requestUrl: "http://example.com/hook",
        });
        expect(run.status).toBe("queued");
      });
    });

    describe("hmac verification", () => {
      const secret = "hmac-secret";
      const body = Buffer.from('{"event":"push"}');
      const validSig = createHmac("sha256", secret).update(body).digest("hex");

      const hmacManifest = {
        triggers: [
          {
            type: "webhook" as const,
            method: "POST",
            verification: {
              mode: "hmac" as const,
              signature_header: "X-Hub-Signature-256",
              secret,
              algorithm: "sha256" as const,
            },
          },
        ],
        steps: MINIMAL_MANIFEST.steps,
      };

      const hmacPrefixManifest = {
        triggers: [
          {
            type: "webhook" as const,
            method: "POST",
            verification: {
              mode: "hmac" as const,
              signature_header: "X-Hub-Signature-256",
              secret,
              algorithm: "sha256" as const,
              prefix: "sha256=",
            },
          },
        ],
        steps: MINIMAL_MANIFEST.steps,
      };

      it("throws on invalid hmac signature", async () => {
        const workflow = await engine.saveWorkflow("wf", hmacManifest);
        await expect(
          engine.triggerWebhook(workflow.id, {
            method: "POST",
            headers: { "x-hub-signature-256": "sha256=invalid" },
            rawBody: body,
            jsonBody: null,
            requestUrl: "http://example.com/hook",
          }),
        ).rejects.toThrow("webhook signature mismatch");
      });

      it("succeeds with valid hmac signature", async () => {
        const workflow = await engine.saveWorkflow("wf", hmacManifest);
        const run = await engine.triggerWebhook(workflow.id, {
          method: "POST",
          headers: { "x-hub-signature-256": validSig },
          rawBody: body,
          jsonBody: null,
          requestUrl: "http://example.com/hook",
        });
        expect(run.status).toBe("queued");
      });

      it("supports signature with prefix", async () => {
        const workflow = await engine.saveWorkflow("wf", hmacPrefixManifest);
        const run = await engine.triggerWebhook(workflow.id, {
          method: "POST",
          headers: { "x-hub-signature-256": `sha256=${validSig}` },
          rawBody: body,
          jsonBody: null,
          requestUrl: "http://example.com/hook",
        });
        expect(run.status).toBe("queued");
      });

      it("throws when prefix is present but signature lacks it", async () => {
        const workflow = await engine.saveWorkflow("wf", hmacPrefixManifest);
        await expect(
          engine.triggerWebhook(workflow.id, {
            method: "POST",
            headers: { "x-hub-signature-256": validSig },
            rawBody: body,
            jsonBody: null,
            requestUrl: "http://example.com/hook",
          }),
        ).rejects.toThrow("webhook signature mismatch");
      });
    });
  });

  describe("concurrency enforcement", () => {
    it("allows new run when under max (default allow behavior)", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      const runs = await engine.listRuns(workflow.id);
      expect(runs).toHaveLength(2);
    });

    it("rejects new run when at limit with reject_new", async () => {
      const manifest = {
        ...MINIMAL_MANIFEST,
        settings: {
          concurrency: { max: 1, overflow_behavior: "reject_new" as const },
        },
      };
      const workflow = await engine.saveWorkflow("strict-wf", manifest);
      await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      await expect(
        engine.triggerWorkflow({
          workflowId: workflow.id,
          triggerType: "manual",
        }),
      ).rejects.toThrow(/concurrency limit/);
    });

    it("cancels oldest run with cancel_oldest", async () => {
      const manifest = {
        ...MINIMAL_MANIFEST,
        settings: {
          concurrency: { max: 1, overflow_behavior: "cancel_oldest" as const },
        },
      };
      const workflow = await engine.saveWorkflow("cancel-wf", manifest);
      const first = await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });

      const firstRun = await engine.getRun(first.id);
      expect(firstRun?.status).toBe("cancelled");
    });
  });

  describe("resumeRun", () => {
    it("throws for unknown resume token", async () => {
      await expect(engine.resumeRun("unknown-token", null)).rejects.toThrow(
        "resume token not found",
      );
    });

    it("resumes a waiting run", async () => {
      const workflow = await engine.saveWorkflow("wf", MINIMAL_MANIFEST);
      const run = await engine.triggerWorkflow({
        workflowId: workflow.id,
        triggerType: "manual",
      });
      const token = "test-token";
      await engine.store.updateRun(run.id, {
        status: "waiting",
        waitingFor: "manual",
        resumeToken: token,
        stepRuns: [{ name: "run", type: "command", status: "waiting" }],
      });

      const resumed = await engine.resumeRun(token, { result: "ok" });
      expect(resumed.status).toBe("queued");
      expect(resumed.resumeToken).toBeNull();
      expect(resumed.stepRuns[0].status).toBe("completed");
      expect(resumed.stepRuns[0].output).toEqual({ result: "ok" });
    });
  });
});
