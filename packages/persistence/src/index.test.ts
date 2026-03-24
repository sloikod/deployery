import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseWorkflowManifest } from "@deployery/workflow-schema";

import {
  PersistenceStore,
  createPersistenceStore,
  getApiKeyPrefix,
  hashApiKey,
  loadPersistenceOptionsFromEnv,
} from "./index";

const MINIMAL_MANIFEST = parseWorkflowManifest({
  triggers: [{ type: "manual" }],
  steps: [{ type: "command", name: "run", command: "echo hi" }],
});

function buildStore(): PersistenceStore {
  return createPersistenceStore(":memory:");
}

describe("hashApiKey", () => {
  it("returns a deterministic sha256 hex string", () => {
    const hash = hashApiKey("my-api-key");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("my-api-key")).toBe(hash);
  });

  it("returns different hashes for different keys", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });
});

describe("getApiKeyPrefix", () => {
  it("returns the first 8 characters", () => {
    expect(getApiKeyPrefix("abcdefghijklmnop")).toBe("abcdefgh");
  });

  it("handles keys shorter than 8 chars", () => {
    expect(getApiKeyPrefix("short")).toBe("short");
  });
});

describe("loadPersistenceOptionsFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to sqlite with provided default path", () => {
    vi.stubEnv("DB_TYPE", "");
    const opts = loadPersistenceOptionsFromEnv("./default.sqlite");
    expect(opts.type).toBe("sqlite");
    expect(opts.sqlitePath).toBe("./default.sqlite");
  });

  it("reads sqlite path from DB_SQLITE_PATH", () => {
    vi.stubEnv("DB_TYPE", "sqlite");
    vi.stubEnv("DB_SQLITE_PATH", "/data/app.sqlite");
    const opts = loadPersistenceOptionsFromEnv();
    expect(opts.type).toBe("sqlite");
    expect(opts.sqlitePath).toBe("/data/app.sqlite");
  });

  it("returns postgres type when DB_TYPE=postgres", () => {
    vi.stubEnv("DB_TYPE", "postgres");
    vi.stubEnv("DB_POSTGRESDB_HOST", "localhost");
    vi.stubEnv("DB_POSTGRESDB_DATABASE", "deployery");
    const opts = loadPersistenceOptionsFromEnv();
    expect(opts.type).toBe("postgres");
    expect(opts.postgres?.host).toBe("localhost");
    expect(opts.postgres?.database).toBe("deployery");
  });

  it("accepts postgresql alias", () => {
    vi.stubEnv("DB_TYPE", "postgresql");
    const opts = loadPersistenceOptionsFromEnv();
    expect(opts.type).toBe("postgres");
  });

  it("throws on unknown DB_TYPE", () => {
    vi.stubEnv("DB_TYPE", "mysql");
    expect(() => loadPersistenceOptionsFromEnv()).toThrow(
      /Unsupported DB_TYPE/,
    );
  });
});

describe("createPersistenceStore", () => {
  it("creates a store from a string path", () => {
    const store = createPersistenceStore(":memory:");
    expect(store).toBeInstanceOf(PersistenceStore);
  });

  it("creates a store from options object", () => {
    const store = createPersistenceStore({
      type: "sqlite",
      sqlitePath: ":memory:",
    });
    expect(store).toBeInstanceOf(PersistenceStore);
  });
});

describe("PersistenceStore (sqlite :memory:)", () => {
  let store: PersistenceStore;

  beforeEach(async () => {
    store = buildStore();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  describe("workflow CRUD", () => {
    it("returns empty list initially", async () => {
      expect(await store.listWorkflows()).toEqual([]);
    });

    it("upserts and retrieves a workflow by id", async () => {
      const workflow = await store.upsertWorkflow(
        "my-workflow",
        MINIMAL_MANIFEST,
      );
      expect(workflow.id).toBeTruthy();
      expect(workflow.name).toBe("my-workflow");
      expect(workflow.enabled).toBe(true);

      const fetched = await store.getWorkflowById(workflow.id);
      expect(fetched?.id).toBe(workflow.id);
      expect(fetched?.name).toBe("my-workflow");
    });

    it("retrieves a workflow by name", async () => {
      const workflow = await store.upsertWorkflow(
        "named-workflow",
        MINIMAL_MANIFEST,
      );
      const fetched = await store.getWorkflowByName("named-workflow");
      expect(fetched?.id).toBe(workflow.id);
    });

    it("returns null for non-existent workflow id", async () => {
      expect(await store.getWorkflowById("nonexistent-id")).toBeNull();
    });

    it("returns null for non-existent workflow name", async () => {
      expect(await store.getWorkflowByName("nonexistent")).toBeNull();
    });

    it("upsert updates existing workflow", async () => {
      await store.upsertWorkflow("workflow", MINIMAL_MANIFEST);
      const updatedManifest = {
        ...MINIMAL_MANIFEST,
        description: "updated",
      };
      const updated = await store.upsertWorkflow("workflow", updatedManifest);
      expect(updated.manifest.description).toBe("updated");
    });

    it("lists workflows sorted by name", async () => {
      await store.upsertWorkflow("zebra", MINIMAL_MANIFEST);
      await store.upsertWorkflow("apple", MINIMAL_MANIFEST);
      await store.upsertWorkflow("mango", MINIMAL_MANIFEST);
      const list = await store.listWorkflows();
      expect(list.map((w) => w.name)).toEqual(["apple", "mango", "zebra"]);
    });
  });

  describe("workflow runs", () => {
    let workflowId: string;

    beforeEach(async () => {
      const workflow = await store.upsertWorkflow(
        "test-workflow",
        MINIMAL_MANIFEST,
      );
      workflowId = workflow.id;
    });

    it("creates a run with queued status", async () => {
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [{ name: "run", type: "command", status: "pending" }],
      });
      expect(run.id).toBeTruthy();
      expect(run.workflowId).toBe(workflowId);
      expect(run.status).toBe("queued");
      expect(run.currentStep).toBe(0);
      expect(run.input).toBeNull();
      expect(run.output).toBeNull();
    });

    it("creates a run with input and trigger source", async () => {
      const run = await store.createRun({
        workflowId,
        triggerType: "webhook",
        triggerSource: "https://hook.example.com",
        input: { key: "value" },
        stepRuns: [],
      });
      expect(run.triggerType).toBe("webhook");
      expect(run.triggerSource).toBe("https://hook.example.com");
      expect(run.input).toEqual({ key: "value" });
    });

    it("retrieves a run by id", async () => {
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const fetched = await store.getRun(run.id);
      expect(fetched?.id).toBe(run.id);
    });

    it("returns null for non-existent run", async () => {
      expect(await store.getRun("nonexistent")).toBeNull();
    });

    it("updates run status and fields", async () => {
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const updated = await store.updateRun(run.id, {
        status: "running",
        currentStep: 1,
      });
      expect(updated.status).toBe("running");
      expect(updated.currentStep).toBe(1);
    });

    it("updates run with output and finishedAt", async () => {
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const now = Date.now();
      const updated = await store.updateRun(run.id, {
        status: "completed",
        output: { result: "done" },
        finishedAt: now,
      });
      expect(updated.status).toBe("completed");
      expect(updated.output).toEqual({ result: "done" });
      expect(updated.finishedAt).toBe(now);
    });

    it("stores and retrieves stepRuns", async () => {
      const stepRuns = [
        { name: "step1", type: "command", status: "pending" as const },
      ];
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns,
      });
      expect(run.stepRuns).toEqual(stepRuns);

      const updated = await store.updateRun(run.id, {
        stepRuns: [{ ...stepRuns[0], status: "completed" }],
      });
      expect(updated.stepRuns[0].status).toBe("completed");
    });

    it("lists runs by workflow", async () => {
      await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      await store.createRun({
        workflowId,
        triggerType: "webhook",
        stepRuns: [],
      });
      const runs = await store.listRunsByWorkflow(workflowId);
      expect(runs).toHaveLength(2);
    });

    it("filters runs by status", async () => {
      await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const run2 = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      await store.updateRun(run2.id, {
        status: "completed",
        finishedAt: Date.now(),
      });

      const queued = await store.listRunsByWorkflow(workflowId, {
        status: "queued",
      });
      expect(queued).toHaveLength(1);
      const completed = await store.listRunsByWorkflow(workflowId, {
        status: "completed",
      });
      expect(completed).toHaveLength(1);
    });

    it("limits runs list", async () => {
      for (let i = 0; i < 5; i++) {
        await store.createRun({
          workflowId,
          triggerType: "manual",
          stepRuns: [],
        });
      }
      const runs = await store.listRunsByWorkflow(workflowId, { limit: 3 });
      expect(runs).toHaveLength(3);
    });

    it("lists active runs by workflow", async () => {
      const run1 = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const run2 = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      await store.updateRun(run1.id, { status: "running" });
      await store.updateRun(run2.id, {
        status: "completed",
        finishedAt: Date.now(),
      });

      const active = await store.listActiveRunsByWorkflow(workflowId);
      expect(active.map((r) => r.id)).toContain(run1.id);
      expect(active.map((r) => r.id)).not.toContain(run2.id);
    });

    it("lists active runs including waiting", async () => {
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      await store.updateRun(run.id, {
        status: "waiting",
        waitingFor: "manual",
      });
      const active = await store.listActiveRunsByWorkflow(workflowId);
      expect(active).toHaveLength(1);
    });

    it("lists recoverable runs (queued, running, waiting)", async () => {
      const r1 = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const r2 = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const r3 = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      await store.updateRun(r1.id, { status: "running" });
      await store.updateRun(r2.id, { status: "waiting" });
      await store.updateRun(r3.id, {
        status: "completed",
        finishedAt: Date.now(),
      });

      const recoverable = await store.listRecoverableRuns();
      const ids = recoverable.map((r) => r.id);
      expect(ids).toContain(r1.id);
      expect(ids).toContain(r2.id);
      expect(ids).not.toContain(r3.id);
    });

    it("retrieves run by resume token", async () => {
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      const token = "test-resume-token";
      await store.updateRun(run.id, { resumeToken: token, status: "waiting" });
      const found = await store.getRunByResumeToken(token);
      expect(found?.id).toBe(run.id);
    });

    it("returns null for unknown resume token", async () => {
      expect(await store.getRunByResumeToken("unknown-token")).toBeNull();
    });
  });

  describe("run logs", () => {
    let workflowId: string;
    let runId: string;

    beforeEach(async () => {
      const workflow = await store.upsertWorkflow(
        "log-workflow",
        MINIMAL_MANIFEST,
      );
      workflowId = workflow.id;
      const run = await store.createRun({
        workflowId,
        triggerType: "manual",
        stepRuns: [],
      });
      runId = run.id;
    });

    it("appends and lists logs", async () => {
      await store.appendRunLog(runId, workflowId, "stdout", "Hello");
      await store.appendRunLog(runId, workflowId, "stderr", "Error");
      const logs = await store.listRunLogs(runId);
      expect(logs).toHaveLength(2);
      expect(logs[0].stream).toBe("stdout");
      expect(logs[0].chunk).toBe("Hello");
      expect(logs[1].stream).toBe("stderr");
    });

    it("filters logs after a given timestamp", async () => {
      await store.appendRunLog(runId, workflowId, "system", "first");
      await new Promise((r) => setTimeout(r, 2));
      const mid = Date.now();
      await new Promise((r) => setTimeout(r, 2));
      await store.appendRunLog(runId, workflowId, "system", "second");
      const logs = await store.listRunLogs(runId, mid);
      expect(logs).toHaveLength(1);
      expect(logs[0].chunk).toBe("second");
    });

    it("returns empty list for run with no logs", async () => {
      expect(await store.listRunLogs(runId)).toEqual([]);
    });
  });

  describe("scheduled triggers", () => {
    let workflowId: string;

    beforeEach(async () => {
      const workflow = await store.upsertWorkflow(
        "sched-workflow",
        MINIMAL_MANIFEST,
      );
      workflowId = workflow.id;
    });

    it("replaces scheduled triggers", async () => {
      await store.replaceScheduledTriggers(workflowId, [
        { workflowId, triggerIndex: 0, cron: "0 * * * *", nextRunAt: 1000 },
      ]);
      const triggers = await store.listScheduledTriggers(workflowId);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].cron).toBe("0 * * * *");
      expect(triggers[0].nextRunAt).toBe(1000);
    });

    it("clearing triggers removes all existing", async () => {
      await store.replaceScheduledTriggers(workflowId, [
        { workflowId, triggerIndex: 0, cron: "0 * * * *" },
      ]);
      await store.replaceScheduledTriggers(workflowId, []);
      expect(await store.listScheduledTriggers(workflowId)).toHaveLength(0);
    });

    it("lists due triggers", async () => {
      const now = Date.now();
      await store.replaceScheduledTriggers(workflowId, [
        {
          workflowId,
          triggerIndex: 0,
          cron: "0 * * * *",
          nextRunAt: now - 1000,
        },
        {
          workflowId,
          triggerIndex: 1,
          cron: "0 0 * * *",
          nextRunAt: now + 1_000_000,
        },
      ]);
      const due = await store.listDueScheduledTriggers(now);
      expect(due).toHaveLength(1);
      expect(due[0].triggerIndex).toBe(0);
    });

    it("updates trigger after fire", async () => {
      await store.replaceScheduledTriggers(workflowId, [
        { workflowId, triggerIndex: 0, cron: "0 * * * *", nextRunAt: 1000 },
      ]);
      const [trigger] = await store.listScheduledTriggers(workflowId);
      const firedAt = Date.now();
      await store.updateScheduledTriggerAfterFire(trigger.id, 5000, firedAt);
      const [updated] = await store.listScheduledTriggers(workflowId);
      expect(updated.nextRunAt).toBe(5000);
      expect(updated.lastRunAt).toBe(firedAt);
    });

    it("handles at-based triggers", async () => {
      await store.replaceScheduledTriggers(workflowId, [
        {
          workflowId,
          triggerIndex: 0,
          at: "2026-01-01T00:00:00Z",
          nextRunAt: 1735689600000,
        },
      ]);
      const [trigger] = await store.listScheduledTriggers(workflowId);
      expect(trigger.at).toBe("2026-01-01T00:00:00Z");
      expect(trigger.cron).toBeNull();
    });
  });

  describe("API keys", () => {
    it("creates and verifies an API key", async () => {
      const key = "test-api-key-12345";
      await store.createApiKey("my-key", key);
      expect(await store.verifyApiKey(key)).toBe(true);
    });

    it("rejects unknown API key", async () => {
      expect(await store.verifyApiKey("unknown-key")).toBe(false);
    });

    it("counts active API keys", async () => {
      expect(await store.asyncKeyCount()).toBe(0);
      await store.createApiKey("key1", "abc12345xyz");
      await store.createApiKey("key2", "def67890xyz");
      expect(await store.asyncKeyCount()).toBe(2);
    });

    it("createApiKey returns id, name, and prefix", async () => {
      const result = await store.createApiKey("my-key", "abcdefghijklmnop");
      expect(result.id).toBeTruthy();
      expect(result.name).toBe("my-key");
      expect(result.prefix).toBe("abcdefgh");
    });
  });

  describe("settings", () => {
    it("returns null for unknown key", async () => {
      expect(await store.getSetting("unknown")).toBeNull();
    });

    it("sets and gets a setting", async () => {
      await store.setSetting("my-key", "my-value");
      expect(await store.getSetting("my-key")).toBe("my-value");
    });

    it("updates existing setting", async () => {
      await store.setSetting("key", "old");
      await store.setSetting("key", "new");
      expect(await store.getSetting("key")).toBe("new");
    });
  });
});
