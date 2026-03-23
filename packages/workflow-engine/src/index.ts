import { createHmac, randomUUID } from "crypto";
import { spawn } from "child_process";

import { CronosExpression } from "cronosjs";

import {
    type JsonValue,
    type WebhookTrigger,
    type WorkflowManifest,
    type WorkflowStep,
    type WorkflowTrigger,
    inferWebhookTrigger,
    parseWorkflowManifest,
} from "@deployery/workflow-schema";
import {
    type CreateScheduledTriggerInput,
    type PersistenceStore,
    type ScheduledTriggerRecord,
    type StoredStepRun,
    type WorkflowLogStream,
    type WorkflowRecord,
    type WorkflowRunRecord,
    createPersistenceStore,
} from "@deployery/persistence";

export interface EngineLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface WorkflowEngineOptions {
    sqlitePath: string;
    sandboxRootfsPath: string;
    sandboxHomePath?: string;
    baseUrl?: string;
    schedulerIntervalMs?: number;
    shell?: string;
    logger?: EngineLogger;
}

export interface TriggerWorkflowInput {
    workflowId?: string;
    workflowName?: string;
    triggerType: string;
    input?: JsonValue | null;
    triggerSource?: string | null;
}

export interface WebhookRequestContext {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
    jsonBody: JsonValue | null;
    requestUrl: string;
    providedSecret?: string | null;
}

export interface WorkflowSummary {
    id: string;
    name: string;
    enabled: boolean;
    manifest: WorkflowManifest;
    createdAt: number;
    updatedAt: number;
}

function defaultLogger(): EngineLogger {
    return {
        info(message) {
            console.log(message);
        },
        warn(message) {
            console.warn(message);
        },
        error(message) {
            console.error(message);
        },
    };
}

function asJsonValue(value: unknown): JsonValue {
    return value as JsonValue;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildInitialStepRuns(manifest: WorkflowManifest): StoredStepRun[] {
    return manifest.steps.map((step) => ({
        name: step.name,
        type: step.type,
        status: "pending",
    }));
}

function getConcurrencySettings(manifest: WorkflowManifest) {
    return manifest.settings?.concurrency ?? {
        max: 1,
        overflow_behavior: "allow" as const,
    };
}

function computeNextRunAt(trigger: WorkflowTrigger, from: Date): number | null {
    if (trigger.type !== "schedule") {
        return null;
    }

    if (trigger.at) {
        const atTimestamp = new Date(trigger.at).getTime();
        return Number.isFinite(atTimestamp) && atTimestamp > from.getTime() ? atTimestamp : null;
    }

    if (!trigger.cron) {
        return null;
    }

    try {
        const expression = CronosExpression.parse(trigger.cron, {
            timezone: trigger.timezone,
        });
        const nextDate = expression.nextDate(from);
        return nextDate ? nextDate.getTime() : null;
    } catch {
        return null;
    }
}

function resolveStepInput(step: WorkflowStep, previousOutput: JsonValue | null): JsonValue | null {
    if ("pinned_input" in step && step.pinned_input !== undefined) {
        return step.pinned_input;
    }

    if (step.type === "workflow" && step.input !== undefined) {
        return step.input;
    }

    return previousOutput;
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") {
            normalized[key.toLowerCase()] = value;
        } else if (Array.isArray(value) && value.length > 0) {
            normalized[key.toLowerCase()] = value[0];
        }
    }
    return normalized;
}

function constantTimeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return Buffer.compare(leftBuffer, rightBuffer) === 0;
}

export class WorkflowEngine {
    readonly store: PersistenceStore;

    private readonly logger: EngineLogger;
    private readonly sandboxRootfsPath: string;
    private readonly sandboxHomePath: string;
    private readonly shell: string;
    private readonly schedulerIntervalMs: number;
    private readonly baseUrl: string | undefined;
    private readonly activeRuns = new Set<string>();
    private schedulerTimer: NodeJS.Timeout | null = null;

    constructor(options: WorkflowEngineOptions) {
        this.store = createPersistenceStore(options.sqlitePath);
        this.logger = options.logger ?? defaultLogger();
        this.sandboxRootfsPath = options.sandboxRootfsPath;
        this.sandboxHomePath = options.sandboxHomePath ?? "/home/deployery";
        this.shell = options.shell ?? "/bin/bash";
        this.schedulerIntervalMs = options.schedulerIntervalMs ?? 1_000;
        this.baseUrl = options.baseUrl;
    }

    async start(): Promise<void> {
        for (const run of this.store.listRecoverableRuns()) {
            if (run.status === "running") {
                this.store.updateRun(run.id, {
                    status: "queued",
                    error: run.error,
                });
            }

            if (run.status === "queued") {
                this.scheduleRun(run.id);
            }
        }

        this.schedulerTimer = setInterval(() => {
            void this.tickScheduler();
        }, this.schedulerIntervalMs);

        await this.tickScheduler();
    }

    stop(): void {
        if (this.schedulerTimer) {
            clearInterval(this.schedulerTimer);
            this.schedulerTimer = null;
        }
        this.store.close();
    }

    listWorkflows(): WorkflowSummary[] {
        return this.store.listWorkflows();
    }

    getWorkflow(workflowId: string): WorkflowSummary | null {
        return this.store.getWorkflowById(workflowId);
    }

    getWorkflowByName(workflowName: string): WorkflowSummary | null {
        return this.store.getWorkflowByName(workflowName);
    }

    saveWorkflow(name: string, manifestInput: unknown): WorkflowSummary {
        const manifest = parseWorkflowManifest(manifestInput);
        const workflow = this.store.upsertWorkflow(name, manifest);
        const scheduledTriggers = this.computeScheduledTriggers(workflow);
        this.store.replaceScheduledTriggers(workflow.id, scheduledTriggers);
        return workflow;
    }

    listRuns(workflowId: string, limit?: number, status?: WorkflowRunRecord["status"]): WorkflowRunRecord[] {
        return this.store.listRunsByWorkflow(workflowId, { limit, status });
    }

    getRun(runId: string): WorkflowRunRecord | null {
        return this.store.getRun(runId);
    }

    listRunLogs(runId: string, after?: number) {
        return this.store.listRunLogs(runId, after);
    }

    async triggerWorkflow(input: TriggerWorkflowInput): Promise<WorkflowRunRecord> {
        const workflow =
            input.workflowId !== undefined
                ? this.store.getWorkflowById(input.workflowId)
                : input.workflowName
                  ? this.store.getWorkflowByName(input.workflowName)
                  : null;

        if (!workflow) {
            throw new Error("workflow not found");
        }

        if (!workflow.enabled) {
            throw new Error("workflow is disabled");
        }

        await this.enforceConcurrency(workflow);

        const run = this.store.createRun({
            workflowId: workflow.id,
            triggerType: input.triggerType,
            triggerSource: input.triggerSource ?? null,
            input: input.input ?? null,
            stepRuns: buildInitialStepRuns(workflow.manifest),
        });
        this.scheduleRun(run.id);
        return run;
    }

    async cancelRun(runId: string): Promise<WorkflowRunRecord> {
        const run = this.store.getRun(runId);
        if (!run) {
            throw new Error("run not found");
        }

        const updated = this.store.updateRun(run.id, {
            status: "cancelled",
            error: run.error ?? "cancelled by user",
            finishedAt: Date.now(),
            waitingFor: null,
            resumeToken: null,
            resumeAt: null,
        });
        this.store.appendRunLog(updated.id, updated.workflowId, "system", "Run cancelled.");
        return updated;
    }

    async resumeRun(resumeToken: string, payload: JsonValue | null): Promise<WorkflowRunRecord> {
        const run = this.store.getRunByResumeToken(resumeToken);
        if (!run) {
            throw new Error("resume token not found");
        }

        const stepIndex = run.currentStep;
        const stepRuns = [...run.stepRuns];
        const stepRun = stepRuns[stepIndex];
        if (!stepRun) {
            throw new Error("run step not found");
        }

        const now = Date.now();
        stepRuns[stepIndex] = {
            ...stepRun,
            status: "completed",
            output: payload ?? null,
            finishedAt: now,
        };

        const updated = this.store.updateRun(run.id, {
            status: "queued",
            currentStep: stepIndex + 1,
            waitingFor: null,
            resumeToken: null,
            resumeAt: null,
            stepRuns,
        });
        this.store.appendRunLog(updated.id, updated.workflowId, "system", `Resumed run from token ${resumeToken}.`);
        this.scheduleRun(updated.id);
        return updated;
    }

    async triggerWebhook(workflowId: string, context: WebhookRequestContext): Promise<WorkflowRunRecord> {
        const workflow = this.store.getWorkflowById(workflowId);
        if (!workflow) {
            throw new Error("workflow not found");
        }

        const trigger = inferWebhookTrigger(workflow.manifest);
        if (!trigger) {
            throw new Error("workflow has no webhook trigger");
        }

        this.verifyWebhookTrigger(trigger, context);

        const payload = context.jsonBody ?? asJsonValue({
            raw: context.rawBody.toString("utf8"),
        });

        return this.triggerWorkflow({
            workflowId,
            triggerType: "webhook",
            triggerSource: context.requestUrl,
            input: payload,
        });
    }

    getWebhookUrls(workflowId: string, requestOrigin?: string): { trigger: string; resumeTemplate: string } {
        const workflow = this.store.getWorkflowById(workflowId);
        if (!workflow) {
            throw new Error("workflow not found");
        }

        const base = (this.baseUrl ?? requestOrigin ?? "http://localhost:3131").replace(/\/$/, "");
        const webhookTrigger = inferWebhookTrigger(workflow.manifest);
        const secretSegment = webhookTrigger?.secret ? `/${encodeURIComponent(webhookTrigger.secret)}` : "";

        return {
            trigger: `${base}/webhook/trigger/${workflow.id}${secretSegment}`,
            resumeTemplate: `${base}/webhook/resume/{resumeToken}`,
        };
    }

    private computeScheduledTriggers(workflow: WorkflowRecord): CreateScheduledTriggerInput[] {
        const nowDate = new Date();
        const triggers: CreateScheduledTriggerInput[] = [];

        workflow.manifest.triggers.forEach((trigger, triggerIndex) => {
            if (trigger.type !== "schedule") {
                return;
            }

            if (trigger.enabled === false) {
                return;
            }

            triggers.push({
                workflowId: workflow.id,
                triggerIndex,
                cron: trigger.cron,
                at: trigger.at,
                timezone: trigger.timezone,
                nextRunAt: computeNextRunAt(trigger, nowDate),
            });
        });

        return triggers;
    }

    private async tickScheduler(): Promise<void> {
        const nowValue = Date.now();
        for (const scheduledTrigger of this.store.listDueScheduledTriggers(nowValue)) {
            const workflow = this.store.getWorkflowById(scheduledTrigger.workflowId);
            if (!workflow) {
                continue;
            }

            const trigger = workflow.manifest.triggers[scheduledTrigger.triggerIndex];
            if (!trigger || trigger.type !== "schedule") {
                continue;
            }

            const nextRunAt = computeNextRunAt(trigger, new Date(nowValue + 1_000));
            this.store.updateScheduledTriggerAfterFire(scheduledTrigger.id, nextRunAt, nowValue);

            try {
                await this.triggerWorkflow({
                    workflowId: workflow.id,
                    triggerType: "schedule",
                    triggerSource: scheduledTrigger.id,
                    input: asJsonValue({
                        scheduled_trigger_id: scheduledTrigger.id,
                        fired_at: nowValue,
                    }),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Scheduled trigger ${scheduledTrigger.id} failed: ${message}`);
            }
        }

        for (const run of this.store.listRecoverableRuns()) {
            if (run.status === "waiting" && run.waitingFor === "schedule" && run.resumeAt !== null && run.resumeAt <= nowValue) {
                const stepRuns = [...run.stepRuns];
                const current = stepRuns[run.currentStep];
                if (current) {
                    stepRuns[run.currentStep] = {
                        ...current,
                        status: "completed",
                        output: asJsonValue({
                            resumed_at: nowValue,
                        }),
                        finishedAt: nowValue,
                    };
                    this.store.updateRun(run.id, {
                        status: "queued",
                        currentStep: run.currentStep + 1,
                        waitingFor: null,
                        resumeAt: null,
                        stepRuns,
                    });
                    this.scheduleRun(run.id);
                }
            }
        }
    }

    private scheduleRun(runId: string): void {
        if (this.activeRuns.has(runId)) {
            return;
        }

        this.activeRuns.add(runId);
        setImmediate(() => {
            void this.executeRun(runId).finally(() => {
                this.activeRuns.delete(runId);
            });
        });
    }

    private async executeRun(runId: string): Promise<void> {
        let run = this.store.getRun(runId);
        if (!run) {
            return;
        }

        const workflow = this.store.getWorkflowById(run.workflowId);
        if (!workflow) {
            this.store.updateRun(runId, {
                status: "failed",
                error: "workflow not found",
                finishedAt: Date.now(),
            });
            return;
        }

        if (run.status === "cancelled" || run.status === "completed" || run.status === "failed") {
            return;
        }

        run = this.store.updateRun(run.id, {
            status: "running",
        });
        this.store.appendRunLog(run.id, run.workflowId, "system", `Run started for workflow "${workflow.name}".`);

        let previousOutput = run.input;
        for (let stepIndex = run.currentStep; stepIndex < workflow.manifest.steps.length; stepIndex += 1) {
            const freshRun = this.store.getRun(run.id);
            if (!freshRun || freshRun.status === "cancelled") {
                return;
            }

            const step = workflow.manifest.steps[stepIndex];
            const stepRuns = [...freshRun.stepRuns];
            const existingStepRun = stepRuns[stepIndex] ?? {
                name: step.name,
                type: step.type,
                status: "pending" as const,
            };
            const startedAt = Date.now();
            const resolvedInput = resolveStepInput(step, previousOutput);

            if ("pinned_output" in step && step.pinned_output !== undefined) {
                stepRuns[stepIndex] = {
                    ...existingStepRun,
                    status: "completed",
                    input: resolvedInput ?? null,
                    output: step.pinned_output,
                    startedAt,
                    finishedAt: Date.now(),
                };
                this.store.updateRun(run.id, {
                    currentStep: stepIndex + 1,
                    stepRuns,
                });
                this.store.appendRunLog(run.id, run.workflowId, "system", `Step "${step.name}" used pinned output.`);
                previousOutput = step.pinned_output;
                continue;
            }

            stepRuns[stepIndex] = {
                ...existingStepRun,
                status: "running",
                input: resolvedInput ?? null,
                error: undefined,
                startedAt,
            };
            this.store.updateRun(run.id, {
                currentStep: stepIndex,
                stepRuns,
            });

            try {
                const output = await this.executeStep(workflow, freshRun, step, stepIndex, resolvedInput);
                const currentRun = this.store.getRun(run.id);
                if (currentRun?.status === "waiting") {
                    return;
                }

                const finishedAt = Date.now();
                const nextStepRuns = [...(currentRun?.stepRuns ?? stepRuns)];
                nextStepRuns[stepIndex] = {
                    ...nextStepRuns[stepIndex],
                    status: "completed",
                    output,
                    finishedAt,
                };

                const updated = this.store.updateRun(run.id, {
                    currentStep: stepIndex + 1,
                    stepRuns: nextStepRuns,
                });
                previousOutput = output;

                if (updated.status === "waiting") {
                    return;
                }

                run = updated;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const failedAt = Date.now();
                const failedStepRuns = [...(this.store.getRun(run.id)?.stepRuns ?? stepRuns)];
                failedStepRuns[stepIndex] = {
                    ...failedStepRuns[stepIndex],
                    status: "failed",
                    error: message,
                    finishedAt: failedAt,
                };
                this.store.appendRunLog(run.id, run.workflowId, "system", `Step "${step.name}" failed: ${message}`);
                this.store.updateRun(run.id, {
                    status: "failed",
                    error: message,
                    finishedAt: failedAt,
                    stepRuns: failedStepRuns,
                });
                return;
            }
        }

        const finalRun = this.store.getRun(run.id);
        if (!finalRun || finalRun.status === "waiting") {
            return;
        }

        this.store.updateRun(run.id, {
            status: "completed",
            output: previousOutput,
            finishedAt: Date.now(),
        });
        this.store.appendRunLog(run.id, run.workflowId, "system", `Run completed for workflow "${workflow.name}".`);
    }

    private async executeStep(
        workflow: WorkflowRecord,
        run: WorkflowRunRecord,
        step: WorkflowStep,
        stepIndex: number,
        input: JsonValue | null
    ): Promise<JsonValue | null> {
        switch (step.type) {
            case "command":
                return this.executeCommandStep(run, step, input);
            case "workflow":
                return this.executeWorkflowStep(step, input);
            case "wait":
                return this.executeWaitStep(run, stepIndex, step, input);
            case "schedule":
                return this.executeScheduleStep(run, stepIndex, step);
            case "webhook":
                return this.executeOutgoingWebhookStep(run, step, input);
        }

        throw new Error(`Unsupported step type ${(step as WorkflowStep).type}`);
    }

    private async executeCommandStep(
        run: WorkflowRunRecord,
        step: Extract<WorkflowStep, { type: "command" }>,
        input: JsonValue | null
    ): Promise<JsonValue> {
        const timeoutMs = step.timeout_seconds ? step.timeout_seconds * 1_000 : 0;
        const env = {
            ...process.env,
            HOME: this.sandboxHomePath,
            INPUT: input === null ? "" : typeof input === "string" ? input : JSON.stringify(input),
            DEPLOYERY_RUN_ID: run.id,
            DEPLOYERY_WORKFLOW_ID: run.workflowId,
        };
        const cwd = step.cwd ?? this.sandboxHomePath;
        const shell = step.shell ?? this.shell;

        return new Promise<JsonValue>((resolve, reject) => {
            const child = spawn(
                "proot",
                [
                    "-0",
                    "-r",
                    this.sandboxRootfsPath,
                    "-b",
                    "/dev",
                    "-b",
                    "/proc",
                    "-b",
                    "/sys",
                    "-b",
                    "/tmp",
                    "-b",
                    "/run",
                    "-b",
                    `${this.sandboxRootfsPath}/tmp:/tmp`,
                    shell,
                    "-lc",
                    `cd ${JSON.stringify(cwd)} && ${step.command}`,
                ],
                {
                    env,
                }
            );

            let stdout = "";
            let stderr = "";
            let timer: NodeJS.Timeout | undefined;

            const appendLog = (stream: WorkflowLogStream, chunk: string) => {
                if (chunk.length === 0) {
                    return;
                }
                this.store.appendRunLog(run.id, run.workflowId, stream, chunk);
            };

            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    child.kill("SIGTERM");
                    reject(new Error(`Command timed out after ${step.timeout_seconds}s`));
                }, timeoutMs);
            }

            child.stdout.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8");
                stdout += text;
                appendLog("stdout", text.trimEnd());
            });

            child.stderr.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8");
                stderr += text;
                appendLog("stderr", text.trimEnd());
            });

            child.on("error", (error) => {
                if (timer) {
                    clearTimeout(timer);
                }
                reject(error);
            });

            child.on("exit", (code) => {
                if (timer) {
                    clearTimeout(timer);
                }

                if (code === 0) {
                    resolve(
                        asJsonValue({
                            stdout: stdout.trim(),
                            stderr: stderr.trim(),
                            exit_code: code,
                        })
                    );
                    return;
                }

                reject(new Error(stderr.trim() || `Command exited with code ${code}`));
            });
        });
    }

    private async executeWorkflowStep(
        step: Extract<WorkflowStep, { type: "workflow" }>,
        input: JsonValue | null
    ): Promise<JsonValue | null> {
        const childRun = await this.triggerWorkflow({
            workflowName: step.workflow,
            triggerType: "workflow",
            input,
        });

        const timeoutAt = step.timeout_seconds ? Date.now() + step.timeout_seconds * 1_000 : null;
        while (true) {
            await sleep(500);
            const run = this.store.getRun(childRun.id);
            if (!run) {
                throw new Error("nested workflow run disappeared");
            }
            if (run.status === "completed") {
                return run.output;
            }
            if (run.status === "failed" || run.status === "cancelled") {
                throw new Error(run.error ?? `Nested workflow ${step.workflow} did not complete`);
            }
            if (timeoutAt !== null && Date.now() >= timeoutAt) {
                throw new Error(`Nested workflow ${step.workflow} timed out`);
            }
        }
    }

    private executeWaitStep(
        run: WorkflowRunRecord,
        stepIndex: number,
        step: Extract<WorkflowStep, { type: "wait" }>,
        input: JsonValue | null
    ): JsonValue {
        const resumeToken = randomUUID();
        const stepRuns = [...(this.store.getRun(run.id)?.stepRuns ?? run.stepRuns)];
        stepRuns[stepIndex] = {
            ...stepRuns[stepIndex],
            status: "waiting",
            input,
            output: asJsonValue({
                resume_token: resumeToken,
            }),
        };
        this.store.updateRun(run.id, {
            status: "waiting",
            waitingFor: step.mode,
            resumeToken,
            stepRuns,
        });
        this.store.appendRunLog(run.id, run.workflowId, "system", `Run is waiting for ${step.mode} resume.`);

        const urls = this.getWebhookUrls(run.workflowId);
        return asJsonValue({
            resume_token: resumeToken,
            resume_url: urls.resumeTemplate.replace("{resumeToken}", resumeToken),
        });
    }

    private executeScheduleStep(
        run: WorkflowRunRecord,
        stepIndex: number,
        step: Extract<WorkflowStep, { type: "schedule" }>
    ): JsonValue {
        const resumeAt =
            step.at !== undefined ? new Date(step.at).getTime() : Date.now() + (step.delay_seconds ?? 0) * 1_000;

        if (!Number.isFinite(resumeAt)) {
            throw new Error("invalid schedule step time");
        }

        const stepRuns = [...(this.store.getRun(run.id)?.stepRuns ?? run.stepRuns)];
        stepRuns[stepIndex] = {
            ...stepRuns[stepIndex],
            status: "waiting",
            output: asJsonValue({
                resume_at: resumeAt,
            }),
        };

        this.store.updateRun(run.id, {
            status: "waiting",
            waitingFor: "schedule",
            resumeAt,
            stepRuns,
        });
        this.store.appendRunLog(run.id, run.workflowId, "system", `Run scheduled to resume at ${new Date(resumeAt).toISOString()}.`);

        return asJsonValue({
            resume_at: resumeAt,
        });
    }

    private async executeOutgoingWebhookStep(
        run: WorkflowRunRecord,
        step: Extract<WorkflowStep, { type: "webhook" }>,
        input: JsonValue | null
    ): Promise<JsonValue> {
        const controller = new AbortController();
        const timeoutMs = step.timeout_seconds ? step.timeout_seconds * 1_000 : 30_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(step.url, {
                method: step.method,
                headers: {
                    "content-type": "application/json",
                    ...step.headers,
                },
                body: JSON.stringify(step.body ?? input ?? {}),
                signal: controller.signal,
            });
            const text = await response.text();
            this.store.appendRunLog(run.id, run.workflowId, "system", `Webhook step "${step.name}" returned ${response.status}.`);
            return asJsonValue({
                status: response.status,
                ok: response.ok,
                body: text,
            });
        } finally {
            clearTimeout(timer);
        }
    }

    private async enforceConcurrency(workflow: WorkflowRecord): Promise<void> {
        const concurrency = getConcurrencySettings(workflow.manifest);
        const activeRuns = this.store.listActiveRunsByWorkflow(workflow.id);

        if (activeRuns.length < concurrency.max) {
            return;
        }

        switch (concurrency.overflow_behavior) {
            case "allow":
                return;
            case "reject_new":
                throw new Error(`workflow "${workflow.name}" is at concurrency limit`);
            case "cancel_oldest":
                if (activeRuns.length > 0) {
                    await this.cancelRun(activeRuns[0].id);
                }
                return;
        }
    }

    private verifyWebhookTrigger(trigger: WebhookTrigger, context: WebhookRequestContext): void {
        if (trigger.method && trigger.method.toUpperCase() !== context.method.toUpperCase()) {
            throw new Error("webhook method not allowed");
        }

        if (trigger.secret && context.providedSecret !== trigger.secret) {
            throw new Error("webhook secret mismatch");
        }

        if (!trigger.verification || trigger.verification.mode === "none") {
            return;
        }

        const headers = normalizeHeaders(context.headers);
        if (trigger.verification.mode === "header") {
            const headerName = trigger.verification.header_name?.toLowerCase();
            const expectedValue = trigger.verification.header_value;
            if (!headerName || !expectedValue) {
                throw new Error("header verification is not configured correctly");
            }
            if (!constantTimeEqual(headers[headerName] ?? "", expectedValue)) {
                throw new Error("webhook verification failed");
            }
            return;
        }

        if (trigger.verification.mode === "hmac") {
            const signatureHeader = trigger.verification.signature_header?.toLowerCase();
            const secret = trigger.verification.secret ?? trigger.secret;
            if (!signatureHeader || !secret) {
                throw new Error("hmac verification is not configured correctly");
            }
            const algorithm = trigger.verification.algorithm ?? "sha256";
            const signature = headers[signatureHeader] ?? "";
            const expectedSignature = createHmac(algorithm, secret).update(context.rawBody).digest("hex");
            const prefixedExpected = trigger.verification.prefix ? `${trigger.verification.prefix}${expectedSignature}` : expectedSignature;
            if (!constantTimeEqual(signature, prefixedExpected)) {
                throw new Error("webhook signature mismatch");
            }
        }
    }
}

export { createPersistenceStore };
