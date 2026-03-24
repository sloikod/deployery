import { describe, expect, it } from "vitest";

import {
  WORKFLOW_SCHEMA_URL,
  commandStepSchema,
  concurrencySettingsSchema,
  inferWebhookTrigger,
  jsonValueSchema,
  manualTriggerSchema,
  normalizeWorkflowName,
  parseWorkflowManifest,
  safeParseWorkflowManifest,
  scheduleTriggerSchema,
  scheduleStepSchema,
  stripWorkflowSchema,
  waitStepSchema,
  webhookStepSchema,
  webhookTriggerSchema,
  webhookVerificationSchema,
  workflowManifestSchema,
  workflowStepSchema,
  workflowTriggerSchema,
} from "./index";

const MINIMAL_MANIFEST = {
  triggers: [{ type: "manual" }],
  steps: [{ type: "command", name: "run", command: "echo hi" }],
} as const;

describe("jsonValueSchema", () => {
  it("accepts primitives", () => {
    expect(jsonValueSchema.parse("hello")).toBe("hello");
    expect(jsonValueSchema.parse(42)).toBe(42);
    expect(jsonValueSchema.parse(true)).toBe(true);
    expect(jsonValueSchema.parse(null)).toBe(null);
  });

  it("accepts arrays and objects", () => {
    expect(jsonValueSchema.parse([1, "two", false])).toEqual([1, "two", false]);
    expect(jsonValueSchema.parse({ a: 1, b: [2, 3] })).toEqual({
      a: 1,
      b: [2, 3],
    });
  });

  it("accepts deeply nested values", () => {
    const nested = { a: { b: { c: [1, { d: "deep" }] } } };
    expect(jsonValueSchema.parse(nested)).toEqual(nested);
  });

  it("rejects undefined", () => {
    expect(() => jsonValueSchema.parse(undefined)).toThrow();
  });
});

describe("webhookVerificationSchema", () => {
  it("defaults mode to none, algorithm to sha256", () => {
    const result = webhookVerificationSchema.parse({});
    expect(result.mode).toBe("none");
    expect(result.algorithm).toBe("sha256");
  });

  it("accepts header mode with name and value", () => {
    const result = webhookVerificationSchema.parse({
      mode: "header",
      header_name: "X-Secret",
      header_value: "abc",
    });
    expect(result.mode).toBe("header");
    expect(result.header_name).toBe("X-Secret");
    expect(result.header_value).toBe("abc");
  });

  it("accepts hmac mode with all fields", () => {
    const result = webhookVerificationSchema.parse({
      mode: "hmac",
      signature_header: "X-Hub-Signature-256",
      secret: "mysecret",
      algorithm: "sha256",
      prefix: "sha256=",
    });
    expect(result.mode).toBe("hmac");
    expect(result.signature_header).toBe("X-Hub-Signature-256");
    expect(result.secret).toBe("mysecret");
    expect(result.prefix).toBe("sha256=");
  });

  it("rejects unknown algorithm", () => {
    expect(() =>
      webhookVerificationSchema.parse({ mode: "hmac", algorithm: "md5" }),
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      webhookVerificationSchema.parse({ mode: "none", unknown: true }),
    ).toThrow();
  });
});

describe("manualTriggerSchema", () => {
  it("accepts valid manual trigger", () => {
    expect(manualTriggerSchema.parse({ type: "manual" })).toEqual({
      type: "manual",
    });
  });

  it("rejects wrong type", () => {
    expect(() => manualTriggerSchema.parse({ type: "schedule" })).toThrow();
  });

  it("rejects extra fields", () => {
    expect(() =>
      manualTriggerSchema.parse({ type: "manual", extra: true }),
    ).toThrow();
  });
});

describe("scheduleTriggerSchema", () => {
  it("accepts trigger with cron", () => {
    const result = scheduleTriggerSchema.parse({
      type: "schedule",
      cron: "0 * * * *",
    });
    expect(result.type).toBe("schedule");
    expect(result.cron).toBe("0 * * * *");
    expect(result.enabled).toBe(true);
  });

  it("accepts trigger with at", () => {
    const result = scheduleTriggerSchema.parse({
      type: "schedule",
      at: "2026-01-01T00:00:00Z",
    });
    expect(result.at).toBe("2026-01-01T00:00:00Z");
  });

  it("accepts optional timezone", () => {
    const result = scheduleTriggerSchema.parse({
      type: "schedule",
      cron: "0 * * * *",
      timezone: "America/New_York",
    });
    expect(result.timezone).toBe("America/New_York");
  });

  it("defaults enabled to true", () => {
    const result = scheduleTriggerSchema.parse({
      type: "schedule",
      cron: "0 * * * *",
    });
    expect(result.enabled).toBe(true);
  });

  it("rejects when neither cron nor at provided", () => {
    expect(() => scheduleTriggerSchema.parse({ type: "schedule" })).toThrow();
  });

  it("accepts enabled: false", () => {
    const result = scheduleTriggerSchema.parse({
      type: "schedule",
      cron: "0 * * * *",
      enabled: false,
    });
    expect(result.enabled).toBe(false);
  });
});

describe("webhookTriggerSchema", () => {
  it("accepts minimal trigger", () => {
    const result = webhookTriggerSchema.parse({ type: "webhook" });
    expect(result.type).toBe("webhook");
    expect(result.method).toBe("POST");
  });

  it("accepts trigger with all fields", () => {
    const result = webhookTriggerSchema.parse({
      type: "webhook",
      method: "GET",
      path: "/my-hook",
      secret: "abc123",
      verification: { mode: "none" },
    });
    expect(result.method).toBe("GET");
    expect(result.path).toBe("/my-hook");
    expect(result.secret).toBe("abc123");
  });

  it("rejects extra fields", () => {
    expect(() =>
      webhookTriggerSchema.parse({ type: "webhook", extra: true }),
    ).toThrow();
  });
});

describe("workflowTriggerSchema", () => {
  it("accepts valid trigger", () => {
    const result = workflowTriggerSchema.parse({
      type: "workflow",
      workflow: "other-workflow",
    });
    expect(result.type).toBe("workflow");
    expect(result.workflow).toBe("other-workflow");
  });

  it("rejects empty workflow name", () => {
    expect(() =>
      workflowTriggerSchema.parse({ type: "workflow", workflow: "" }),
    ).toThrow();
  });
});

describe("concurrencySettingsSchema", () => {
  it("defaults max to 1, overflow_behavior to allow", () => {
    const result = concurrencySettingsSchema.parse({});
    expect(result.max).toBe(1);
    expect(result.overflow_behavior).toBe("allow");
  });

  it("accepts custom values", () => {
    const result = concurrencySettingsSchema.parse({
      max: 5,
      overflow_behavior: "reject_new",
    });
    expect(result.max).toBe(5);
    expect(result.overflow_behavior).toBe("reject_new");
  });

  it("rejects max = 0", () => {
    expect(() => concurrencySettingsSchema.parse({ max: 0 })).toThrow();
  });

  it("accepts cancel_oldest", () => {
    const result = concurrencySettingsSchema.parse({
      overflow_behavior: "cancel_oldest",
    });
    expect(result.overflow_behavior).toBe("cancel_oldest");
  });
});

describe("commandStepSchema", () => {
  it("accepts minimal step", () => {
    const result = commandStepSchema.parse({
      type: "command",
      name: "step1",
      command: "echo hi",
    });
    expect(result.type).toBe("command");
    expect(result.name).toBe("step1");
    expect(result.command).toBe("echo hi");
  });

  it("accepts all optional fields", () => {
    const result = commandStepSchema.parse({
      type: "command",
      name: "step1",
      command: "echo hi",
      cwd: "/tmp",
      shell: "/bin/sh",
      env: { FOO: "bar" },
      timeout_seconds: 30,
      pinned_input: "value",
      pinned_output: { key: "val" },
    });
    expect(result.cwd).toBe("/tmp");
    expect(result.shell).toBe("/bin/sh");
    expect(result.env).toEqual({ FOO: "bar" });
    expect(result.timeout_seconds).toBe(30);
  });

  it("rejects empty command", () => {
    expect(() =>
      commandStepSchema.parse({ type: "command", name: "s", command: "" }),
    ).toThrow();
  });

  it("rejects extra fields", () => {
    expect(() =>
      commandStepSchema.parse({
        type: "command",
        name: "s",
        command: "x",
        extra: 1,
      }),
    ).toThrow();
  });
});

describe("workflowStepSchema", () => {
  it("accepts valid step", () => {
    const result = workflowStepSchema.parse({
      type: "workflow",
      name: "step1",
      workflow: "child",
    });
    expect(result.type).toBe("workflow");
    expect(result.workflow).toBe("child");
  });

  it("accepts optional input and timeout", () => {
    const result = workflowStepSchema.parse({
      type: "workflow",
      name: "s",
      workflow: "child",
      input: { key: "val" },
      timeout_seconds: 60,
    });
    expect(result.input).toEqual({ key: "val" });
    expect(result.timeout_seconds).toBe(60);
  });
});

describe("waitStepSchema", () => {
  it("defaults mode to manual", () => {
    const result = waitStepSchema.parse({ type: "wait", name: "step1" });
    expect(result.mode).toBe("manual");
  });

  it("accepts webhook mode", () => {
    const result = waitStepSchema.parse({
      type: "wait",
      name: "step1",
      mode: "webhook",
    });
    expect(result.mode).toBe("webhook");
  });
});

describe("scheduleStepSchema", () => {
  it("accepts step with delay_seconds", () => {
    const result = scheduleStepSchema.parse({
      type: "schedule",
      name: "step1",
      delay_seconds: 60,
    });
    expect(result.delay_seconds).toBe(60);
  });

  it("accepts step with at", () => {
    const result = scheduleStepSchema.parse({
      type: "schedule",
      name: "step1",
      at: "2026-01-01T00:00:00Z",
    });
    expect(result.at).toBe("2026-01-01T00:00:00Z");
  });

  it("rejects when neither delay_seconds nor at provided", () => {
    expect(() =>
      scheduleStepSchema.parse({ type: "schedule", name: "step1" }),
    ).toThrow();
  });
});

describe("webhookStepSchema", () => {
  it("accepts valid step", () => {
    const result = webhookStepSchema.parse({
      type: "webhook",
      name: "step1",
      url: "https://example.com/hook",
    });
    expect(result.method).toBe("POST");
    expect(result.headers).toEqual({});
  });

  it("rejects invalid URL", () => {
    expect(() =>
      webhookStepSchema.parse({ type: "webhook", name: "s", url: "not-a-url" }),
    ).toThrow();
  });

  it("accepts all fields", () => {
    const result = webhookStepSchema.parse({
      type: "webhook",
      name: "s",
      url: "https://example.com",
      method: "PUT",
      headers: { Authorization: "Bearer token" },
      body: { payload: "data" },
      timeout_seconds: 10,
    });
    expect(result.method).toBe("PUT");
    expect(result.headers).toEqual({ Authorization: "Bearer token" });
  });
});

describe("workflowManifestSchema", () => {
  it("accepts minimal valid manifest", () => {
    const result = workflowManifestSchema.parse(MINIMAL_MANIFEST);
    expect(result.triggers).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
  });

  it("rejects empty triggers", () => {
    expect(() =>
      workflowManifestSchema.parse({
        triggers: [],
        steps: MINIMAL_MANIFEST.steps,
      }),
    ).toThrow();
  });

  it("rejects empty steps", () => {
    expect(() =>
      workflowManifestSchema.parse({
        triggers: MINIMAL_MANIFEST.triggers,
        steps: [],
      }),
    ).toThrow();
  });

  it("accepts optional description and settings", () => {
    const result = workflowManifestSchema.parse({
      ...MINIMAL_MANIFEST,
      description: "My workflow",
      settings: { concurrency: { max: 3 } },
    });
    expect(result.description).toBe("My workflow");
    expect(result.settings?.concurrency?.max).toBe(3);
  });

  it("rejects extra top-level fields (strict)", () => {
    expect(() =>
      workflowManifestSchema.parse({ ...MINIMAL_MANIFEST, unknown: true }),
    ).toThrow();
  });
});

describe("parseWorkflowManifest", () => {
  it("injects schema URL when $schema is absent", () => {
    const result = parseWorkflowManifest(MINIMAL_MANIFEST);
    expect(result.$schema).toBe(WORKFLOW_SCHEMA_URL);
  });

  it("preserves existing $schema", () => {
    const result = parseWorkflowManifest({
      ...MINIMAL_MANIFEST,
      $schema: "https://custom.schema",
    });
    expect(result.$schema).toBe("https://custom.schema");
  });

  it("throws on invalid input", () => {
    expect(() => parseWorkflowManifest({ triggers: [], steps: [] })).toThrow();
  });

  it("returns parsed manifest with defaults applied", () => {
    const result = parseWorkflowManifest({
      triggers: [{ type: "webhook" }],
      steps: [{ type: "wait", name: "w" }],
    });
    const trigger = result.triggers[0];
    if (trigger.type === "webhook") {
      expect(trigger.method).toBe("POST");
    }
  });
});

describe("safeParseWorkflowManifest", () => {
  it("returns success true for valid input", () => {
    const result = safeParseWorkflowManifest(MINIMAL_MANIFEST);
    expect(result.success).toBe(true);
  });

  it("returns success false for invalid input", () => {
    const result = safeParseWorkflowManifest({ triggers: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("stripWorkflowSchema", () => {
  it("removes $schema field", () => {
    const manifest = parseWorkflowManifest(MINIMAL_MANIFEST);
    const stripped = stripWorkflowSchema(manifest);
    expect("$schema" in stripped).toBe(false);
  });

  it("preserves all other fields", () => {
    const manifest = parseWorkflowManifest(MINIMAL_MANIFEST);
    const stripped = stripWorkflowSchema(manifest);
    expect(stripped.triggers).toEqual(manifest.triggers);
    expect(stripped.steps).toEqual(manifest.steps);
  });
});

describe("normalizeWorkflowName", () => {
  it("removes .json extension", () => {
    expect(normalizeWorkflowName("my-workflow.json")).toBe("my-workflow");
  });

  it("removes .JSON extension (case-insensitive)", () => {
    expect(normalizeWorkflowName("my-workflow.JSON")).toBe("my-workflow");
  });

  it("returns name unchanged when no .json extension", () => {
    expect(normalizeWorkflowName("my-workflow")).toBe("my-workflow");
  });

  it("handles names with dots", () => {
    expect(normalizeWorkflowName("my.workflow.json")).toBe("my.workflow");
  });
});

describe("inferWebhookTrigger", () => {
  it("returns undefined when no webhook trigger", () => {
    const manifest = parseWorkflowManifest(MINIMAL_MANIFEST);
    expect(inferWebhookTrigger(manifest)).toBeUndefined();
  });

  it("returns the webhook trigger when present", () => {
    const manifest = parseWorkflowManifest({
      triggers: [{ type: "manual" }, { type: "webhook" }],
      steps: MINIMAL_MANIFEST.steps,
    });
    const trigger = inferWebhookTrigger(manifest);
    expect(trigger?.type).toBe("webhook");
  });

  it("returns the first webhook trigger", () => {
    const manifest = parseWorkflowManifest({
      triggers: [
        { type: "webhook", secret: "first" },
        { type: "webhook", secret: "second" },
      ],
      steps: MINIMAL_MANIFEST.steps,
    });
    const trigger = inferWebhookTrigger(manifest);
    expect(trigger?.secret).toBe("first");
  });
});
