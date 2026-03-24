import { EventEmitter } from "events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";

import { WorkflowEngine } from "./index";

const mockedSpawn = vi.mocked(spawn);

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function createEngine() {
  return new WorkflowEngine({
    sandboxRootfsPath: "/sandbox",
    sandboxHomePath: "/home/deployery",
    persistence: { type: "sqlite", sqlitePath: ":memory:" },
    logger: silentLogger(),
    baseUrl: "https://deployery.example.com",
  });
}

function makeChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

async function waitForRunStatus(
  engine: WorkflowEngine,
  runId: string,
  status: string,
) {
  for (let index = 0; index < 100; index += 1) {
    const run = await engine.getRun(runId);
    if (run?.status === status) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Timed out waiting for run ${runId} to reach ${status}`);
}

describe("WorkflowEngine runtime behavior", () => {
  let engine: WorkflowEngine;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockedSpawn.mockReset();
    engine = createEngine();
    await engine.store.init();
  });

  afterEach(async () => {
    await engine.store.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("completes runs that use pinned output without invoking the shell", async () => {
    const workflow = await engine.saveWorkflow("pinned", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "command",
          name: "run",
          command: "echo ignored",
          pinned_output: { ok: true },
        },
      ],
    });

    const run = await engine.triggerWorkflow({
      workflowId: workflow.id,
      triggerType: "manual",
      input: { hello: "world" },
    });

    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(completed.output).toEqual({ ok: true });
    expect(completed.stepRuns[0]).toMatchObject({
      status: "completed",
      input: { hello: "world" },
      output: { ok: true },
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("executes command steps, captures logs, and returns stdout and stderr", async () => {
    mockedSpawn.mockImplementation(() => {
      const child = makeChildProcess();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("hello\n"));
        child.stderr.emit("data", Buffer.from("warn\n"));
        child.emit("exit", 0);
      });
      return child as never;
    });

    const workflow = await engine.saveWorkflow("command-run", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "command",
          name: "run",
          command: "printf hi",
          cwd: "/workspace",
          shell: "/bin/sh",
          timeout_seconds: 2,
        },
      ],
    });

    const run = await engine.triggerWorkflow({
      workflowId: workflow.id,
      triggerType: "manual",
      input: { value: 1 },
    });

    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(completed.output).toEqual({
      stdout: "hello",
      stderr: "warn",
      exit_code: 0,
    });
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedSpawn.mock.calls[0]?.[0]).toBe("chroot");
    expect(mockedSpawn.mock.calls[0]?.[1]).toEqual([
      "--userspec=deployery:deployery",
      "/sandbox",
      "/bin/sh",
      "-lc",
      'cd "/workspace" && printf hi',
    ]);
    expect(mockedSpawn.mock.calls[0]?.[2]).toMatchObject({
      env: expect.objectContaining({
        HOME: "/home/deployery",
        INPUT: '{"value":1}',
        DEPLOYERY_WORKFLOW_ID: workflow.id,
      }),
    });

    const logs = await engine.listRunLogs(run.id);
    expect(logs.map((entry) => [entry.stream, entry.chunk])).toEqual(
      expect.arrayContaining([
        ["stdout", "hello"],
        ["stderr", "warn"],
      ]),
    );
  });

  it("marks runs as failed when a command step exits non-zero", async () => {
    mockedSpawn.mockImplementation(() => {
      const child = makeChildProcess();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("boom"));
        child.emit("exit", 12);
      });
      return child as never;
    });

    const workflow = await engine.saveWorkflow("command-fail", {
      triggers: [{ type: "manual" }],
      steps: [{ type: "command", name: "run", command: "exit 12" }],
    });

    const run = await engine.triggerWorkflow({
      workflowId: workflow.id,
      triggerType: "manual",
    });

    const failed = await waitForRunStatus(engine, run.id, "failed");
    expect(failed.error).toBe("boom");
    expect(failed.stepRuns[0]).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });

  it("times out command steps and terminates the child process", async () => {
    vi.useFakeTimers();
    const child = makeChildProcess();
    mockedSpawn.mockReturnValue(child as never);

    const executeCommandStep = (
      engine as unknown as {
        executeCommandStep(run: unknown, step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeCommandStep.bind(engine);

    const promise = executeCommandStep(
      { id: "run-timeout", workflowId: "wf-timeout" },
      {
        type: "command",
        name: "slow",
        command: "sleep 10",
        timeout_seconds: 1,
      },
      null,
    );
    const expectation = expect(promise).rejects.toThrow(
      "Command timed out after 1s",
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects command steps when the child process emits an error", async () => {
    mockedSpawn.mockImplementation(() => {
      const child = makeChildProcess();
      queueMicrotask(() => {
        child.emit("error", new Error("spawn failed"));
      });
      return child as never;
    });

    const executeCommandStep = (
      engine as unknown as {
        executeCommandStep(run: unknown, step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeCommandStep.bind(engine);

    await expect(
      executeCommandStep(
        { id: "run-error", workflowId: "wf-error" },
        {
          type: "command",
          name: "broken",
          command: "bad-command",
          timeout_seconds: 2,
        },
        null,
      ),
    ).rejects.toThrow("spawn failed");
  });

  it("warns when persisting streamed command logs fails", async () => {
    const warn = vi.fn();
    (engine as unknown as { logger: { warn(message: string): void } }).logger = {
      warn,
    };

    mockedSpawn.mockImplementation(() => {
      const child = makeChildProcess();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("hello\n"));
        child.emit("exit", 0);
      });
      return child as never;
    });

    const appendRunLog = vi
      .spyOn(engine.store, "appendRunLog")
      .mockRejectedValueOnce(new Error("disk full"));

    const executeCommandStep = (
      engine as unknown as {
        executeCommandStep(run: unknown, step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeCommandStep.bind(engine);

    await expect(
      executeCommandStep(
        { id: "run-log", workflowId: "wf-log" },
        {
          type: "command",
          name: "loggy",
          command: "echo hello",
        },
        null,
      ),
    ).resolves.toEqual({
      stdout: "hello",
      stderr: "",
      exit_code: 0,
    });

    await Promise.resolve();
    expect(appendRunLog).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Failed to persist stdout log chunk for run run-log: disk full",
    );
  });

  it("ignores empty streamed log chunks", async () => {
    const appendRunLog = vi.spyOn(engine.store, "appendRunLog");
    mockedSpawn.mockImplementation(() => {
      const child = makeChildProcess();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(""));
        child.stderr.emit("data", Buffer.from(""));
        child.emit("exit", 0);
      });
      return child as never;
    });

    const executeCommandStep = (
      engine as unknown as {
        executeCommandStep(run: unknown, step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeCommandStep.bind(engine);

    await expect(
      executeCommandStep(
        { id: "run-empty", workflowId: "wf-empty" },
        { type: "command", name: "empty", command: "echo -n ''" },
        null,
      ),
    ).resolves.toEqual({
      stdout: "",
      stderr: "",
      exit_code: 0,
    });

    expect(appendRunLog).not.toHaveBeenCalled();
  });

  it("wait steps pause the run and resume to completion", async () => {
    const workflow = await engine.saveWorkflow("manual-wait", {
      triggers: [{ type: "manual" }],
      steps: [{ type: "wait", name: "approve", mode: "manual" }],
    });

    const run = await engine.triggerWorkflow({
      workflowId: workflow.id,
      triggerType: "manual",
    });

    const waiting = await waitForRunStatus(engine, run.id, "waiting");
    expect(waiting.waitingFor).toBe("manual");
    expect(waiting.stepRuns[0].output).toMatchObject({
      resume_token: waiting.resumeToken,
    });

    await engine.resumeRun(waiting.resumeToken!, { approved: true });
    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(completed.output).toBeNull();
    expect(completed.stepRuns[0].output).toEqual({ approved: true });
  });

  it("schedule steps resume when the scheduler ticks past resumeAt", async () => {
    const workflow = await engine.saveWorkflow("schedule-wait", {
      triggers: [{ type: "manual" }],
      steps: [{ type: "schedule", name: "later", delay_seconds: 1 }],
    });

    const run = await engine.triggerWorkflow({
      workflowId: workflow.id,
      triggerType: "manual",
    });

    const waiting = await waitForRunStatus(engine, run.id, "waiting");
    expect(waiting.waitingFor).toBe("schedule");
    await engine.store.updateRun(run.id, { resumeAt: Date.now() - 1 });
    await (engine as unknown as { tickScheduler(): Promise<void> }).tickScheduler();
    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(completed.output).toBeNull();
    expect(completed.stepRuns[0].output).toMatchObject({
      resumed_at: expect.any(Number),
    });
  });

  it("workflow steps propagate nested workflow output", async () => {
    await engine.saveWorkflow("child-workflow", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "command",
          name: "child",
          command: "echo ignored",
          pinned_output: { nested: true },
        },
      ],
    });

    const parent = await engine.saveWorkflow("parent-workflow", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "workflow",
          name: "run-child",
          workflow: "child-workflow",
        },
      ],
    });

    const run = await engine.triggerWorkflow({
      workflowId: parent.id,
      triggerType: "manual",
    });

    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(completed.output).toEqual({ nested: true });
  });

  it("start recovers running runs by re-queueing them", async () => {
    const workflow = await engine.saveWorkflow("recoverable", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "command",
          name: "recover",
          command: "echo ignored",
          pinned_output: { recovered: true },
        },
      ],
    });
    const run = await engine.store.createRun({
      workflowId: workflow.id,
      triggerType: "manual",
      stepRuns: [{ name: "recover", type: "command", status: "pending" }],
    });
    await engine.store.updateRun(run.id, {
      status: "running",
      error: "interrupted",
    });

    await engine.start();

    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(completed.error).toBe("interrupted");
    expect(completed.output).toEqual({ recovered: true });
  });

  it("fails a run when its workflow record disappears before execution", async () => {
    const updateRun = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(engine.store, "getRun").mockResolvedValue({
      id: "run-1",
      workflowId: "workflow-1",
      status: "queued",
    } as never);
    vi.spyOn(engine.store, "getWorkflowById").mockResolvedValue(null);
    vi.spyOn(engine.store, "updateRun").mockImplementation(updateRun);

    await (engine as unknown as { executeRun(runId: string): Promise<void> }).executeRun("run-1");

    expect(updateRun).toHaveBeenCalledWith("run-1", {
      status: "failed",
      error: "workflow not found",
      finishedAt: expect.any(Number),
    });
  });

  it("validates misconfigured webhook verification helpers", () => {
    const verifyWebhookTrigger = (
      engine as unknown as {
        verifyWebhookTrigger(trigger: unknown, context: unknown): void;
      }
    ).verifyWebhookTrigger.bind(engine);

    expect(() =>
      verifyWebhookTrigger(
        {
          method: "POST",
          verification: {
            mode: "header",
          },
        },
        {
          method: "POST",
          headers: {},
          rawBody: Buffer.from(""),
        },
      ),
    ).toThrow("header verification is not configured correctly");

    expect(() =>
      verifyWebhookTrigger(
        {
          method: "POST",
          verification: {
            mode: "hmac",
            signature_header: "X-Signature",
          },
        },
        {
          method: "POST",
          headers: {},
          rawBody: Buffer.from(""),
        },
      ),
    ).toThrow("hmac verification is not configured correctly");
  });

  it("accepts header verification values provided as arrays", async () => {
    const workflow = await engine.saveWorkflow("header-array", {
      triggers: [
        {
          type: "webhook",
          method: "POST",
          verification: {
            mode: "header",
            header_name: "X-Secret-Token",
            header_value: "expected-value",
          },
        },
      ],
      steps: [{ type: "command", name: "run", command: "echo hi", pinned_output: { ok: true } }],
    });

    const run = await engine.triggerWebhook(workflow.id, {
      method: "POST",
      headers: { "x-secret-token": ["expected-value", "ignored"] },
      rawBody: Buffer.from("{}"),
      jsonBody: {},
      requestUrl: "https://example.com/hook",
    });

    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(completed.output).toEqual({ ok: true });
  });

  it("uses workflow step input instead of previous output during execution", async () => {
    await engine.saveWorkflow("child-workflow", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "command",
          name: "child",
          command: "echo hi",
          pinned_output: { child: true },
        },
      ],
    });
    const parent = await engine.saveWorkflow("workflow-input-parent", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "command",
          name: "seed",
          command: "echo hi",
          pinned_output: { previous: true },
        },
        {
          type: "workflow",
          name: "child",
          workflow: "child-workflow",
          input: { forced: "input" },
        },
      ],
    });
    const triggerWorkflow = vi.spyOn(engine, "triggerWorkflow");
    const run = await engine.triggerWorkflow({
      workflowId: parent.id,
      triggerType: "manual",
    });
    await waitForRunStatus(engine, run.id, "completed");

    expect(triggerWorkflow).toHaveBeenNthCalledWith(2, {
      workflowName: "child-workflow",
      triggerType: "workflow",
      input: { forced: "input" },
    });
  });

  it("reports nested workflow cancellation", async () => {
    vi.useFakeTimers();
    const executeWorkflowStep = (
      engine as unknown as {
        executeWorkflowStep(step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeWorkflowStep.bind(engine);

    vi.spyOn(engine, "triggerWorkflow").mockResolvedValue({ id: "child-run" } as never);
    vi.spyOn(engine.store, "getRun").mockResolvedValue({
      id: "child-run",
      status: "cancelled",
      error: null,
    } as never);

    const promise = executeWorkflowStep(
      { type: "workflow", name: "child", workflow: "child-workflow" },
      null,
    );
    const expectation = expect(promise).rejects.toThrow(
      "Nested workflow child-workflow did not complete",
    );
    await vi.advanceTimersByTimeAsync(500);
    await expectation;
  });

  it("reports nested workflow failure messages", async () => {
    vi.useFakeTimers();
    const executeWorkflowStep = (
      engine as unknown as {
        executeWorkflowStep(step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeWorkflowStep.bind(engine);

    vi.spyOn(engine, "triggerWorkflow").mockResolvedValue({ id: "child-run" } as never);
    vi.spyOn(engine.store, "getRun").mockResolvedValue({
      id: "child-run",
      status: "failed",
      error: "child exploded",
    } as never);

    const promise = executeWorkflowStep(
      { type: "workflow", name: "child", workflow: "child-workflow" },
      null,
    );
    const expectation = expect(promise).rejects.toThrow("child exploded");
    await vi.advanceTimersByTimeAsync(500);
    await expectation;
  });

  it("reports nested workflow disappearance", async () => {
    vi.useFakeTimers();
    const executeWorkflowStep = (
      engine as unknown as {
        executeWorkflowStep(step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeWorkflowStep.bind(engine);

    vi.spyOn(engine, "triggerWorkflow").mockResolvedValue({ id: "missing-run" } as never);
    vi.spyOn(engine.store, "getRun").mockResolvedValue(null);

    const promise = executeWorkflowStep(
      { type: "workflow", name: "child", workflow: "child-workflow" },
      null,
    );
    const expectation = expect(promise).rejects.toThrow(
      "nested workflow run disappeared",
    );
    await vi.advanceTimersByTimeAsync(500);
    await expectation;
  });

  it("reports nested workflow timeout", async () => {
    vi.useFakeTimers();
    const executeWorkflowStep = (
      engine as unknown as {
        executeWorkflowStep(step: unknown, input: unknown): Promise<unknown>;
      }
    ).executeWorkflowStep.bind(engine);

    vi.spyOn(engine, "triggerWorkflow").mockResolvedValue({ id: "slow-run" } as never);
    vi.spyOn(engine.store, "getRun").mockResolvedValue({
      id: "slow-run",
      status: "running",
    } as never);

    const promise = executeWorkflowStep(
      {
        type: "workflow",
        name: "child",
        workflow: "child-workflow",
        timeout_seconds: 1,
      },
      null,
    );
    const expectation = expect(promise).rejects.toThrow(
      "Nested workflow child-workflow timed out",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
  });

  it("rejects schedule steps with invalid absolute times", async () => {
    const executeScheduleStep = (
      engine as unknown as {
        executeScheduleStep(run: unknown, stepIndex: number, step: unknown): Promise<unknown>;
      }
    ).executeScheduleStep.bind(engine);

    await expect(
      executeScheduleStep(
        {
          id: "run-1",
          workflowId: "wf-1",
          stepRuns: [{ name: "later", type: "schedule", status: "pending" }],
        },
        0,
        {
          type: "schedule",
          name: "later",
          at: "not-a-date",
        },
      ),
    ).rejects.toThrow("invalid schedule step time");
  });

  it("throws for unsupported step types", async () => {
    const executeStep = (
      engine as unknown as {
        executeStep(
          workflow: unknown,
          run: unknown,
          step: unknown,
          stepIndex: number,
          input: unknown,
        ): Promise<unknown>;
      }
    ).executeStep.bind(engine);

    await expect(
      executeStep(
        { id: "wf", name: "wf", manifest: { steps: [] } },
        { id: "run", workflowId: "wf" },
        { type: "mystery", name: "???", command: "noop" },
        0,
        null,
      ),
    ).rejects.toThrow("Unsupported step type mystery");
  });

  it("webhook steps send JSON and persist the HTTP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      text: vi.fn().mockResolvedValue("accepted"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const workflow = await engine.saveWorkflow("webhook-step", {
      triggers: [{ type: "manual" }],
      steps: [
        {
          type: "webhook",
          name: "notify",
          url: "https://hooks.example.com/deploy",
          method: "POST",
          headers: { "x-custom": "1" },
        },
      ],
    });

    const run = await engine.triggerWorkflow({
      workflowId: workflow.id,
      triggerType: "manual",
      input: { hello: "world" },
    });

    const completed = await waitForRunStatus(engine, run.id, "completed");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.com/deploy",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-custom": "1",
        },
        body: '{"hello":"world"}',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(completed.output).toEqual({
      status: 201,
      ok: true,
      body: "accepted",
    });
  });
});
