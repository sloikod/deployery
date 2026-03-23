import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import BetterSqlite3 from "better-sqlite3";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { JsonValue, WorkflowManifest } from "@deployery/workflow-schema";
import { parseWorkflowManifest } from "@deployery/workflow-schema";

import {
    apiKeysTable,
    sandboxSettingsTable,
    scheduledTriggersTable,
    workflowRunLogsTable,
    workflowRunsTable,
    workflowsTable,
} from "./schema";

export type WorkflowRunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type WorkflowLogStream = "stdout" | "stderr" | "system";

export interface StoredStepRun {
    name: string;
    type: string;
    status: WorkflowRunStatus | "pending";
    input?: JsonValue;
    output?: JsonValue;
    error?: string;
    startedAt?: number;
    finishedAt?: number;
}

export interface WorkflowRecord {
    id: string;
    name: string;
    enabled: boolean;
    manifest: WorkflowManifest;
    createdAt: number;
    updatedAt: number;
}

export interface ScheduledTriggerRecord {
    id: string;
    workflowId: string;
    triggerIndex: number;
    cron: string | null;
    at: string | null;
    timezone: string | null;
    nextRunAt: number | null;
    lastRunAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface WorkflowRunRecord {
    id: string;
    workflowId: string;
    status: WorkflowRunStatus;
    triggerType: string;
    triggerSource: string | null;
    input: JsonValue | null;
    output: JsonValue | null;
    error: string | null;
    currentStep: number;
    waitingFor: string | null;
    resumeToken: string | null;
    resumeAt: number | null;
    stepRuns: StoredStepRun[];
    createdAt: number;
    startedAt: number;
    finishedAt: number | null;
    updatedAt: number;
}

export interface WorkflowRunLogRecord {
    id: string;
    workflowId: string;
    runId: string;
    stream: WorkflowLogStream;
    chunk: string;
    createdAt: number;
}

export interface CreateRunInput {
    workflowId: string;
    triggerType: string;
    triggerSource?: string | null;
    input?: JsonValue | null;
    stepRuns: StoredStepRun[];
}

export interface UpdateRunInput {
    status?: WorkflowRunStatus;
    output?: JsonValue | null;
    error?: string | null;
    currentStep?: number;
    waitingFor?: string | null;
    resumeToken?: string | null;
    resumeAt?: number | null;
    stepRuns?: StoredStepRun[];
    finishedAt?: number | null;
}

export interface ListRunsOptions {
    limit?: number;
    status?: WorkflowRunStatus;
}

export interface CreateScheduledTriggerInput {
    workflowId: string;
    triggerIndex: number;
    cron?: string;
    at?: string;
    timezone?: string;
    nextRunAt?: number | null;
}

function parseJsonValue(value: string | null): JsonValue | null {
    if (!value) {
        return null;
    }

    return JSON.parse(value) as JsonValue;
}

function parseStepRuns(value: string): StoredStepRun[] {
    const parsed = JSON.parse(value) as StoredStepRun[];
    return Array.isArray(parsed) ? parsed : [];
}

function serializeJsonValue(value: JsonValue | null | undefined): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    return JSON.stringify(value);
}

function serializeStepRuns(stepRuns: StoredStepRun[]): string {
    return JSON.stringify(stepRuns);
}

function now(): number {
    return Date.now();
}

export function hashApiKey(apiKey: string): string {
    return createHash("sha256").update(apiKey).digest("hex");
}

export function getApiKeyPrefix(apiKey: string): string {
    return apiKey.slice(0, 8);
}

export class PersistenceStore {
    private readonly sqlite: any;
    readonly db: ReturnType<typeof drizzle>;

    constructor(sqlitePath: string) {
        fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
        this.sqlite = new BetterSqlite3(sqlitePath);
        this.sqlite.pragma("journal_mode = WAL");
        this.sqlite.pragma("foreign_keys = OFF");
        this.db = drizzle(this.sqlite);
        this.migrate();
    }

    close(): void {
        this.sqlite.close();
    }

    private migrate(): void {
        this.sqlite.exec(`
            CREATE TABLE IF NOT EXISTS sandbox_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS api_keys (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                key_hash TEXT NOT NULL UNIQUE,
                prefix TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                revoked_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1,
                manifest TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scheduled_triggers (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                trigger_index INTEGER NOT NULL,
                cron TEXT,
                at TEXT,
                timezone TEXT,
                next_run_at INTEGER,
                last_run_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflow_runs (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                status TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                trigger_source TEXT,
                input TEXT,
                output TEXT,
                error TEXT,
                current_step INTEGER NOT NULL DEFAULT 0,
                waiting_for TEXT,
                resume_token TEXT,
                resume_at INTEGER,
                step_runs TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflow_run_logs (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                stream TEXT NOT NULL,
                chunk TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
        `);
    }

    private mapWorkflow(row: typeof workflowsTable.$inferSelect): WorkflowRecord {
        return {
            id: row.id,
            name: row.name,
            enabled: row.enabled,
            manifest: parseWorkflowManifest(JSON.parse(row.manifest)),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private mapScheduledTrigger(row: typeof scheduledTriggersTable.$inferSelect): ScheduledTriggerRecord {
        return {
            id: row.id,
            workflowId: row.workflowId,
            triggerIndex: row.triggerIndex,
            cron: row.cron,
            at: row.at,
            timezone: row.timezone,
            nextRunAt: row.nextRunAt,
            lastRunAt: row.lastRunAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private mapRun(row: typeof workflowRunsTable.$inferSelect): WorkflowRunRecord {
        return {
            id: row.id,
            workflowId: row.workflowId,
            status: row.status as WorkflowRunStatus,
            triggerType: row.triggerType,
            triggerSource: row.triggerSource,
            input: parseJsonValue(row.input),
            output: parseJsonValue(row.output),
            error: row.error,
            currentStep: row.currentStep,
            waitingFor: row.waitingFor,
            resumeToken: row.resumeToken,
            resumeAt: row.resumeAt,
            stepRuns: parseStepRuns(row.stepRuns),
            createdAt: row.createdAt,
            startedAt: row.startedAt,
            finishedAt: row.finishedAt,
            updatedAt: row.updatedAt,
        };
    }

    listWorkflows(): WorkflowRecord[] {
        return this.db.select().from(workflowsTable).orderBy(asc(workflowsTable.name)).all().map((row) => this.mapWorkflow(row));
    }

    getWorkflowById(workflowId: string): WorkflowRecord | null {
        const row = this.db.select().from(workflowsTable).where(eq(workflowsTable.id, workflowId)).get();
        return row ? this.mapWorkflow(row) : null;
    }

    getWorkflowByName(name: string): WorkflowRecord | null {
        const row = this.db.select().from(workflowsTable).where(eq(workflowsTable.name, name)).get();
        return row ? this.mapWorkflow(row) : null;
    }

    upsertWorkflow(name: string, manifest: WorkflowManifest): WorkflowRecord {
        const existing = this.getWorkflowByName(name);
        const timestamp = now();

        if (existing) {
            this.db
                .update(workflowsTable)
                .set({
                    manifest: JSON.stringify(manifest),
                    enabled: true,
                    updatedAt: timestamp,
                })
                .where(eq(workflowsTable.id, existing.id))
                .run();

            return this.getWorkflowById(existing.id)!;
        }

        const workflowId = randomUUID();
        this.db
            .insert(workflowsTable)
            .values({
                id: workflowId,
                name,
                enabled: true,
                manifest: JSON.stringify(manifest),
                createdAt: timestamp,
                updatedAt: timestamp,
            })
            .run();

        return this.getWorkflowById(workflowId)!;
    }

    replaceScheduledTriggers(workflowId: string, triggers: CreateScheduledTriggerInput[]): ScheduledTriggerRecord[] {
        this.db.delete(scheduledTriggersTable).where(eq(scheduledTriggersTable.workflowId, workflowId)).run();

        const timestamp = now();
        for (const trigger of triggers) {
            this.db
                .insert(scheduledTriggersTable)
                .values({
                    id: randomUUID(),
                    workflowId,
                    triggerIndex: trigger.triggerIndex,
                    cron: trigger.cron ?? null,
                    at: trigger.at ?? null,
                    timezone: trigger.timezone ?? null,
                    nextRunAt: trigger.nextRunAt ?? null,
                    lastRunAt: null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                })
                .run();
        }

        return this.listScheduledTriggers(workflowId);
    }

    listScheduledTriggers(workflowId: string): ScheduledTriggerRecord[] {
        return this.db
            .select()
            .from(scheduledTriggersTable)
            .where(eq(scheduledTriggersTable.workflowId, workflowId))
            .orderBy(asc(scheduledTriggersTable.triggerIndex))
            .all()
            .map((row) => this.mapScheduledTrigger(row));
    }

    listDueScheduledTriggers(timestamp: number): ScheduledTriggerRecord[] {
        return this.db
            .select()
            .from(scheduledTriggersTable)
            .where(and(sql`${scheduledTriggersTable.nextRunAt} IS NOT NULL`, lte(scheduledTriggersTable.nextRunAt, timestamp)))
            .orderBy(asc(scheduledTriggersTable.nextRunAt))
            .all()
            .map((row) => this.mapScheduledTrigger(row));
    }

    updateScheduledTriggerAfterFire(id: string, nextRunAt: number | null, firedAt: number): void {
        this.db
            .update(scheduledTriggersTable)
            .set({
                nextRunAt,
                lastRunAt: firedAt,
                updatedAt: firedAt,
            })
            .where(eq(scheduledTriggersTable.id, id))
            .run();
    }

    createRun(input: CreateRunInput): WorkflowRunRecord {
        const timestamp = now();
        const runId = randomUUID();

        this.db
            .insert(workflowRunsTable)
            .values({
                id: runId,
                workflowId: input.workflowId,
                status: "queued",
                triggerType: input.triggerType,
                triggerSource: input.triggerSource ?? null,
                input: serializeJsonValue(input.input),
                output: null,
                error: null,
                currentStep: 0,
                waitingFor: null,
                resumeToken: null,
                resumeAt: null,
                stepRuns: serializeStepRuns(input.stepRuns),
                createdAt: timestamp,
                startedAt: timestamp,
                finishedAt: null,
                updatedAt: timestamp,
            })
            .run();

        return this.getRun(runId)!;
    }

    getRun(runId: string): WorkflowRunRecord | null {
        const row = this.db.select().from(workflowRunsTable).where(eq(workflowRunsTable.id, runId)).get();
        return row ? this.mapRun(row) : null;
    }

    getRunByResumeToken(resumeToken: string): WorkflowRunRecord | null {
        const row = this.db.select().from(workflowRunsTable).where(eq(workflowRunsTable.resumeToken, resumeToken)).get();
        return row ? this.mapRun(row) : null;
    }

    listRunsByWorkflow(workflowId: string, options: ListRunsOptions = {}): WorkflowRunRecord[] {
        const condition = options.status
            ? and(eq(workflowRunsTable.workflowId, workflowId), eq(workflowRunsTable.status, options.status))
            : eq(workflowRunsTable.workflowId, workflowId);

        const query = this.db
            .select()
            .from(workflowRunsTable)
            .where(condition)
            .orderBy(desc(workflowRunsTable.createdAt));

        const rows = options.limit ? query.limit(options.limit).all() : query.all();
        return rows.map((row) => this.mapRun(row));
    }

    listActiveRunsByWorkflow(workflowId: string): WorkflowRunRecord[] {
        return this.db
            .select()
            .from(workflowRunsTable)
            .where(
                and(
                    eq(workflowRunsTable.workflowId, workflowId),
                    inArray(workflowRunsTable.status, ["queued", "running", "waiting"])
                )
            )
            .orderBy(asc(workflowRunsTable.createdAt))
            .all()
            .map((row) => this.mapRun(row));
    }

    listRecoverableRuns(): WorkflowRunRecord[] {
        return this.db
            .select()
            .from(workflowRunsTable)
            .where(inArray(workflowRunsTable.status, ["queued", "running", "waiting"]))
            .orderBy(asc(workflowRunsTable.createdAt))
            .all()
            .map((row) => this.mapRun(row));
    }

    updateRun(runId: string, input: UpdateRunInput): WorkflowRunRecord {
        const timestamp = now();
        this.db
            .update(workflowRunsTable)
            .set({
                status: input.status,
                output: input.output === undefined ? undefined : serializeJsonValue(input.output),
                error: input.error,
                currentStep: input.currentStep,
                waitingFor: input.waitingFor,
                resumeToken: input.resumeToken,
                resumeAt: input.resumeAt,
                stepRuns: input.stepRuns ? serializeStepRuns(input.stepRuns) : undefined,
                finishedAt: input.finishedAt === undefined ? undefined : input.finishedAt,
                updatedAt: timestamp,
            })
            .where(eq(workflowRunsTable.id, runId))
            .run();

        return this.getRun(runId)!;
    }

    appendRunLog(runId: string, workflowId: string, stream: WorkflowLogStream, chunk: string): WorkflowRunLogRecord {
        const record: WorkflowRunLogRecord = {
            id: randomUUID(),
            workflowId,
            runId,
            stream,
            chunk,
            createdAt: now(),
        };

        this.db.insert(workflowRunLogsTable).values(record).run();
        return record;
    }

    listRunLogs(runId: string, after?: number): WorkflowRunLogRecord[] {
        const condition =
            after !== undefined
                ? and(eq(workflowRunLogsTable.runId, runId), sql`${workflowRunLogsTable.createdAt} > ${after}`)
                : eq(workflowRunLogsTable.runId, runId);

        return this.db
            .select()
            .from(workflowRunLogsTable)
            .where(condition)
            .orderBy(asc(workflowRunLogsTable.createdAt))
            .all()
            .map((row) => ({
                ...row,
                stream: row.stream as WorkflowLogStream,
            }));
    }

    asyncKeyCount(): number {
        const row = this.db.select({ count: sql<number>`count(*)` }).from(apiKeysTable).get();
        return Number(row?.count ?? 0);
    }

    verifyApiKey(apiKey: string): boolean {
        const keyHash = hashApiKey(apiKey);
        const row = this.db
            .select()
            .from(apiKeysTable)
            .where(and(eq(apiKeysTable.keyHash, keyHash), sql`${apiKeysTable.revokedAt} IS NULL`))
            .get();
        return Boolean(row);
    }

    createApiKey(name: string, apiKey: string): { id: string; name: string; prefix: string } {
        const timestamp = now();
        const record = {
            id: randomUUID(),
            name,
            keyHash: hashApiKey(apiKey),
            prefix: getApiKeyPrefix(apiKey),
            createdAt: timestamp,
            revokedAt: null,
        };

        this.db.insert(apiKeysTable).values(record).run();
        return {
            id: record.id,
            name: record.name,
            prefix: record.prefix,
        };
    }

    getSetting(key: string): string | null {
        const row = this.db.select().from(sandboxSettingsTable).where(eq(sandboxSettingsTable.key, key)).get();
        return row?.value ?? null;
    }

    setSetting(key: string, value: string): void {
        const timestamp = now();
        const existing = this.getSetting(key);

        if (existing === null) {
            this.db
                .insert(sandboxSettingsTable)
                .values({
                    key,
                    value,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                })
                .run();
            return;
        }

        this.db
            .update(sandboxSettingsTable)
            .set({
                value,
                updatedAt: timestamp,
            })
            .where(eq(sandboxSettingsTable.key, key))
            .run();
    }
}

export function createPersistenceStore(sqlitePath: string): PersistenceStore {
    return new PersistenceStore(sqlitePath);
}
