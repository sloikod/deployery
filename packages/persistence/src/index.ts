import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import BetterSqlite3 from "better-sqlite3";
import { Pool, type PoolConfig, type QueryResultRow } from "pg";

import { type JsonValue, type WorkflowManifest, parseWorkflowManifest } from "@deployery/workflow-schema";

export type WorkflowRunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type WorkflowLogStream = "stdout" | "stderr" | "system";
export type PersistenceDatabaseType = "sqlite" | "postgres";

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

export interface PostgresPersistenceConfig {
    connectionUrl?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    sslEnabled?: boolean;
}

export interface PersistenceStoreOptions {
    type?: PersistenceDatabaseType;
    sqlitePath?: string;
    postgres?: PostgresPersistenceConfig;
}

type QueryParams = readonly unknown[];

interface DatabaseAdapter {
    readonly type: PersistenceDatabaseType;
    init(): Promise<void>;
    close(): Promise<void>;
    exec(sql: string): Promise<void>;
    all<T extends QueryResultRow>(sql: string, params?: QueryParams): Promise<T[]>;
    get<T extends QueryResultRow>(sql: string, params?: QueryParams): Promise<T | undefined>;
    run(sql: string, params?: QueryParams): Promise<void>;
}

interface WorkflowRow extends QueryResultRow {
    id: string;
    name: string;
    enabled: boolean | number | string;
    manifest: string;
    createdAt: number | string | bigint;
    updatedAt: number | string | bigint;
}

interface ScheduledTriggerRow extends QueryResultRow {
    id: string;
    workflowId: string;
    triggerIndex: number | string | bigint;
    cron: string | null;
    at: string | null;
    timezone: string | null;
    nextRunAt: number | string | bigint | null;
    lastRunAt: number | string | bigint | null;
    createdAt: number | string | bigint;
    updatedAt: number | string | bigint;
}

interface RunRow extends QueryResultRow {
    id: string;
    workflowId: string;
    status: WorkflowRunStatus;
    triggerType: string;
    triggerSource: string | null;
    input: string | null;
    output: string | null;
    error: string | null;
    currentStep: number | string | bigint;
    waitingFor: string | null;
    resumeToken: string | null;
    resumeAt: number | string | bigint | null;
    stepRuns: string;
    createdAt: number | string | bigint;
    startedAt: number | string | bigint;
    finishedAt: number | string | bigint | null;
    updatedAt: number | string | bigint;
}

interface RunLogRow extends QueryResultRow {
    id: string;
    workflowId: string;
    runId: string;
    stream: string;
    chunk: string;
    createdAt: number | string | bigint;
}

function parseJsonValue(value: string | null): JsonValue | null {
    if (!value) {
        return null;
    }
    return JSON.parse(value) as JsonValue;
}

function parseStepRuns(value: string): StoredStepRun[] {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredStepRun[]) : [];
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

function asNumber(value: number | string | bigint | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: boolean | number | string): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    return value === "true" || value === "1" || value.toLowerCase() === "t";
}

function readEnv(name: string): string | undefined {
    const inline = process.env[name];
    if (inline !== undefined) {
        return inline;
    }

    const filePath = process.env[`${name}_FILE`];
    if (!filePath) {
        return undefined;
    }

    return fs.readFileSync(filePath, "utf8").trim();
}

function resolveDatabaseType(raw: string | undefined): PersistenceDatabaseType {
    const normalized = raw?.trim().toLowerCase();
    if (!normalized || normalized === "sqlite" || normalized === "sqlitedb") {
        return "sqlite";
    }
    if (normalized === "postgres" || normalized === "postgresql" || normalized === "postgresdb") {
        return "postgres";
    }
    throw new Error(`Unsupported DB_TYPE "${raw}"`);
}

export function loadPersistenceOptionsFromEnv(defaultSqlitePath = "./deployery.sqlite"): PersistenceStoreOptions {
    const type = resolveDatabaseType(readEnv("DB_TYPE"));
    if (type === "sqlite") {
        return {
            type,
            sqlitePath: readEnv("DB_SQLITE_PATH") ?? readEnv("DEPLOYERY_SQLITE_PATH") ?? defaultSqlitePath,
        };
    }

    return {
        type,
        postgres: {
            connectionUrl: readEnv("DB_POSTGRESDB_CONNECTION_URL"),
            host: readEnv("DB_POSTGRESDB_HOST"),
            port: (() => {
                const port = readEnv("DB_POSTGRESDB_PORT");
                return port ? Number.parseInt(port, 10) : undefined;
            })(),
            database: readEnv("DB_POSTGRESDB_DATABASE"),
            user: readEnv("DB_POSTGRESDB_USER"),
            password: readEnv("DB_POSTGRESDB_PASSWORD"),
            sslEnabled: readEnv("DB_POSTGRESDB_SSL_ENABLED") === "true",
        },
    };
}

function normalizeOptions(optionsOrPath: PersistenceStoreOptions | string): PersistenceStoreOptions {
    if (typeof optionsOrPath === "string") {
        return {
            type: "sqlite",
            sqlitePath: optionsOrPath,
        };
    }

    const type = optionsOrPath.type ?? "sqlite";
    if (type === "sqlite") {
        return {
            type,
            sqlitePath: optionsOrPath.sqlitePath ?? "./deployery.sqlite",
        };
    }

    return {
        type,
        postgres: optionsOrPath.postgres ?? {},
    };
}

function toPostgresSql(sql: string): string {
    let index = 0;
    return sql.replace(/\?/g, () => {
        index += 1;
        return `$${index}`;
    });
}

function createSqliteMigrations(): string {
    return `
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

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
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
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
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workflow_run_logs (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            stream TEXT NOT NULL,
            chunk TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS scheduled_triggers_workflow_id_idx ON scheduled_triggers(workflow_id);
        CREATE INDEX IF NOT EXISTS scheduled_triggers_next_run_at_idx ON scheduled_triggers(next_run_at);
        CREATE INDEX IF NOT EXISTS workflow_runs_workflow_id_created_at_idx ON workflow_runs(workflow_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS workflow_runs_status_idx ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS workflow_runs_resume_token_idx ON workflow_runs(resume_token);
        CREATE INDEX IF NOT EXISTS workflow_run_logs_run_id_created_at_idx ON workflow_run_logs(run_id, created_at);
    `;
}

function createPostgresMigrations(): string {
    return `
        CREATE TABLE IF NOT EXISTS sandbox_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            prefix TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            revoked_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            manifest TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scheduled_triggers (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            trigger_index INTEGER NOT NULL,
            cron TEXT,
            at TEXT,
            timezone TEXT,
            next_run_at BIGINT,
            last_run_at BIGINT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflow_runs (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            trigger_source TEXT,
            input TEXT,
            output TEXT,
            error TEXT,
            current_step INTEGER NOT NULL DEFAULT 0,
            waiting_for TEXT,
            resume_token TEXT,
            resume_at BIGINT,
            step_runs TEXT NOT NULL DEFAULT '[]',
            created_at BIGINT NOT NULL,
            started_at BIGINT NOT NULL,
            finished_at BIGINT,
            updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflow_run_logs (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
            stream TEXT NOT NULL,
            chunk TEXT NOT NULL,
            created_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS scheduled_triggers_workflow_id_idx ON scheduled_triggers(workflow_id);
        CREATE INDEX IF NOT EXISTS scheduled_triggers_next_run_at_idx ON scheduled_triggers(next_run_at);
        CREATE INDEX IF NOT EXISTS workflow_runs_workflow_id_created_at_idx ON workflow_runs(workflow_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS workflow_runs_status_idx ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS workflow_runs_resume_token_idx ON workflow_runs(resume_token);
        CREATE INDEX IF NOT EXISTS workflow_run_logs_run_id_created_at_idx ON workflow_run_logs(run_id, created_at);
    `;
}

class SqliteAdapter implements DatabaseAdapter {
    readonly type = "sqlite" as const;
    private readonly sqlite: InstanceType<typeof BetterSqlite3>;

    constructor(private readonly sqlitePath: string) {
        fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
        this.sqlite = new BetterSqlite3(sqlitePath);
    }

    async init(): Promise<void> {
        await this.exec(createSqliteMigrations());
    }

    async close(): Promise<void> {
        this.sqlite.close();
    }

    async exec(sql: string): Promise<void> {
        this.sqlite.exec(sql);
    }

    async all<T extends QueryResultRow>(sql: string, params: QueryParams = []): Promise<T[]> {
        return this.sqlite.prepare(sql).all(...params) as T[];
    }

    async get<T extends QueryResultRow>(sql: string, params: QueryParams = []): Promise<T | undefined> {
        return this.sqlite.prepare(sql).get(...params) as T | undefined;
    }

    async run(sql: string, params: QueryParams = []): Promise<void> {
        this.sqlite.prepare(sql).run(...params);
    }
}

class PostgresAdapter implements DatabaseAdapter {
    readonly type = "postgres" as const;
    private readonly pool: Pool;

    constructor(config: PostgresPersistenceConfig) {
        const poolConfig: PoolConfig = config.connectionUrl
            ? {
                  connectionString: config.connectionUrl,
              }
            : {
                  host: config.host,
                  port: config.port,
                  database: config.database,
                  user: config.user,
                  password: config.password,
              };

        if (config.sslEnabled) {
            poolConfig.ssl = {
                rejectUnauthorized: false,
            };
        }

        this.pool = new Pool(poolConfig);
    }

    async init(): Promise<void> {
        await this.exec(createPostgresMigrations());
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    async exec(sql: string): Promise<void> {
        await this.pool.query(sql);
    }

    async all<T extends QueryResultRow>(sql: string, params: QueryParams = []): Promise<T[]> {
        const result = await this.pool.query<T>(toPostgresSql(sql), [...params]);
        return result.rows;
    }

    async get<T extends QueryResultRow>(sql: string, params: QueryParams = []): Promise<T | undefined> {
        const result = await this.pool.query<T>(toPostgresSql(sql), [...params]);
        return result.rows[0];
    }

    async run(sql: string, params: QueryParams = []): Promise<void> {
        await this.pool.query(toPostgresSql(sql), [...params]);
    }
}

export function hashApiKey(apiKey: string): string {
    return createHash("sha256").update(apiKey).digest("hex");
}

export function getApiKeyPrefix(apiKey: string): string {
    return apiKey.slice(0, 8);
}

export class PersistenceStore {
    readonly db: DatabaseAdapter;

    constructor(private readonly options: PersistenceStoreOptions) {
        if (options.type === "postgres") {
            this.db = new PostgresAdapter(options.postgres ?? {});
            return;
        }

        this.db = new SqliteAdapter(options.sqlitePath ?? "./deployery.sqlite");
    }

    async init(): Promise<void> {
        await this.db.init();
    }

    async close(): Promise<void> {
        await this.db.close();
    }

    private mapWorkflow(row: WorkflowRow): WorkflowRecord {
        return {
            id: row.id,
            name: row.name,
            enabled: asBoolean(row.enabled),
            manifest: parseWorkflowManifest(JSON.parse(row.manifest) as unknown),
            createdAt: asNumber(row.createdAt) ?? 0,
            updatedAt: asNumber(row.updatedAt) ?? 0,
        };
    }

    private mapScheduledTrigger(row: ScheduledTriggerRow): ScheduledTriggerRecord {
        return {
            id: row.id,
            workflowId: row.workflowId,
            triggerIndex: asNumber(row.triggerIndex) ?? 0,
            cron: row.cron,
            at: row.at,
            timezone: row.timezone,
            nextRunAt: asNumber(row.nextRunAt),
            lastRunAt: asNumber(row.lastRunAt),
            createdAt: asNumber(row.createdAt) ?? 0,
            updatedAt: asNumber(row.updatedAt) ?? 0,
        };
    }

    private mapRun(row: RunRow): WorkflowRunRecord {
        return {
            id: row.id,
            workflowId: row.workflowId,
            status: row.status,
            triggerType: row.triggerType,
            triggerSource: row.triggerSource,
            input: parseJsonValue(row.input),
            output: parseJsonValue(row.output),
            error: row.error,
            currentStep: asNumber(row.currentStep) ?? 0,
            waitingFor: row.waitingFor,
            resumeToken: row.resumeToken,
            resumeAt: asNumber(row.resumeAt),
            stepRuns: parseStepRuns(row.stepRuns),
            createdAt: asNumber(row.createdAt) ?? 0,
            startedAt: asNumber(row.startedAt) ?? 0,
            finishedAt: asNumber(row.finishedAt),
            updatedAt: asNumber(row.updatedAt) ?? 0,
        };
    }

    private mapRunLog(row: RunLogRow): WorkflowRunLogRecord {
        return {
            id: row.id,
            workflowId: row.workflowId,
            runId: row.runId,
            stream: row.stream as WorkflowLogStream,
            chunk: row.chunk,
            createdAt: asNumber(row.createdAt) ?? 0,
        };
    }

    async listWorkflows(): Promise<WorkflowRecord[]> {
        const rows = await this.db.all<WorkflowRow>(
            `SELECT id, name, enabled, manifest, created_at AS "createdAt", updated_at AS "updatedAt"
             FROM workflows
             ORDER BY name ASC`
        );
        return rows.map((row) => this.mapWorkflow(row));
    }

    async getWorkflowById(workflowId: string): Promise<WorkflowRecord | null> {
        const row = await this.db.get<WorkflowRow>(
            `SELECT id, name, enabled, manifest, created_at AS "createdAt", updated_at AS "updatedAt"
             FROM workflows
             WHERE id = ?`,
            [workflowId]
        );
        return row ? this.mapWorkflow(row) : null;
    }

    async getWorkflowByName(name: string): Promise<WorkflowRecord | null> {
        const row = await this.db.get<WorkflowRow>(
            `SELECT id, name, enabled, manifest, created_at AS "createdAt", updated_at AS "updatedAt"
             FROM workflows
             WHERE name = ?`,
            [name]
        );
        return row ? this.mapWorkflow(row) : null;
    }

    async upsertWorkflow(name: string, manifest: WorkflowManifest): Promise<WorkflowRecord> {
        const existing = await this.getWorkflowByName(name);
        const timestamp = now();

        if (existing) {
            await this.db.run(
                `UPDATE workflows
                 SET manifest = ?, enabled = ?, updated_at = ?
                 WHERE id = ?`,
                [JSON.stringify(manifest), true, timestamp, existing.id]
            );
            return (await this.getWorkflowById(existing.id)) as WorkflowRecord;
        }

        const workflowId = randomUUID();
        await this.db.run(
            `INSERT INTO workflows (id, name, enabled, manifest, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [workflowId, name, true, JSON.stringify(manifest), timestamp, timestamp]
        );
        return (await this.getWorkflowById(workflowId)) as WorkflowRecord;
    }

    async replaceScheduledTriggers(workflowId: string, triggers: CreateScheduledTriggerInput[]): Promise<ScheduledTriggerRecord[]> {
        await this.db.run(`DELETE FROM scheduled_triggers WHERE workflow_id = ?`, [workflowId]);

        const timestamp = now();
        for (const trigger of triggers) {
            await this.db.run(
                `INSERT INTO scheduled_triggers (
                    id, workflow_id, trigger_index, cron, at, timezone, next_run_at, last_run_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    randomUUID(),
                    workflowId,
                    trigger.triggerIndex,
                    trigger.cron ?? null,
                    trigger.at ?? null,
                    trigger.timezone ?? null,
                    trigger.nextRunAt ?? null,
                    null,
                    timestamp,
                    timestamp,
                ]
            );
        }

        return this.listScheduledTriggers(workflowId);
    }

    async listScheduledTriggers(workflowId: string): Promise<ScheduledTriggerRecord[]> {
        const rows = await this.db.all<ScheduledTriggerRow>(
            `SELECT
                id,
                workflow_id AS "workflowId",
                trigger_index AS "triggerIndex",
                cron,
                at,
                timezone,
                next_run_at AS "nextRunAt",
                last_run_at AS "lastRunAt",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
             FROM scheduled_triggers
             WHERE workflow_id = ?
             ORDER BY trigger_index ASC`,
            [workflowId]
        );
        return rows.map((row) => this.mapScheduledTrigger(row));
    }

    async listDueScheduledTriggers(timestamp: number): Promise<ScheduledTriggerRecord[]> {
        const rows = await this.db.all<ScheduledTriggerRow>(
            `SELECT
                id,
                workflow_id AS "workflowId",
                trigger_index AS "triggerIndex",
                cron,
                at,
                timezone,
                next_run_at AS "nextRunAt",
                last_run_at AS "lastRunAt",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
             FROM scheduled_triggers
             WHERE next_run_at IS NOT NULL AND next_run_at <= ?
             ORDER BY next_run_at ASC`,
            [timestamp]
        );
        return rows.map((row) => this.mapScheduledTrigger(row));
    }

    async updateScheduledTriggerAfterFire(id: string, nextRunAt: number | null, firedAt: number): Promise<void> {
        await this.db.run(
            `UPDATE scheduled_triggers
             SET next_run_at = ?, last_run_at = ?, updated_at = ?
             WHERE id = ?`,
            [nextRunAt, firedAt, firedAt, id]
        );
    }

    async createRun(input: CreateRunInput): Promise<WorkflowRunRecord> {
        const timestamp = now();
        const runId = randomUUID();

        await this.db.run(
            `INSERT INTO workflow_runs (
                id, workflow_id, status, trigger_type, trigger_source, input, output, error, current_step, waiting_for,
                resume_token, resume_at, step_runs, created_at, started_at, finished_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                runId,
                input.workflowId,
                "queued",
                input.triggerType,
                input.triggerSource ?? null,
                serializeJsonValue(input.input),
                null,
                null,
                0,
                null,
                null,
                null,
                serializeStepRuns(input.stepRuns),
                timestamp,
                timestamp,
                null,
                timestamp,
            ]
        );

        return (await this.getRun(runId)) as WorkflowRunRecord;
    }

    async getRun(runId: string): Promise<WorkflowRunRecord | null> {
        const row = await this.db.get<RunRow>(
            `SELECT
                id,
                workflow_id AS "workflowId",
                status,
                trigger_type AS "triggerType",
                trigger_source AS "triggerSource",
                input,
                output,
                error,
                current_step AS "currentStep",
                waiting_for AS "waitingFor",
                resume_token AS "resumeToken",
                resume_at AS "resumeAt",
                step_runs AS "stepRuns",
                created_at AS "createdAt",
                started_at AS "startedAt",
                finished_at AS "finishedAt",
                updated_at AS "updatedAt"
             FROM workflow_runs
             WHERE id = ?`,
            [runId]
        );
        return row ? this.mapRun(row) : null;
    }

    async getRunByResumeToken(resumeToken: string): Promise<WorkflowRunRecord | null> {
        const row = await this.db.get<RunRow>(
            `SELECT
                id,
                workflow_id AS "workflowId",
                status,
                trigger_type AS "triggerType",
                trigger_source AS "triggerSource",
                input,
                output,
                error,
                current_step AS "currentStep",
                waiting_for AS "waitingFor",
                resume_token AS "resumeToken",
                resume_at AS "resumeAt",
                step_runs AS "stepRuns",
                created_at AS "createdAt",
                started_at AS "startedAt",
                finished_at AS "finishedAt",
                updated_at AS "updatedAt"
             FROM workflow_runs
             WHERE resume_token = ?`,
            [resumeToken]
        );
        return row ? this.mapRun(row) : null;
    }

    async listRunsByWorkflow(workflowId: string, options: ListRunsOptions = {}): Promise<WorkflowRunRecord[]> {
        const params: unknown[] = [workflowId];
        const predicates = [`workflow_id = ?`];

        if (options.status) {
            predicates.push(`status = ?`);
            params.push(options.status);
        }

        let sql = `SELECT
            id,
            workflow_id AS "workflowId",
            status,
            trigger_type AS "triggerType",
            trigger_source AS "triggerSource",
            input,
            output,
            error,
            current_step AS "currentStep",
            waiting_for AS "waitingFor",
            resume_token AS "resumeToken",
            resume_at AS "resumeAt",
            step_runs AS "stepRuns",
            created_at AS "createdAt",
            started_at AS "startedAt",
            finished_at AS "finishedAt",
            updated_at AS "updatedAt"
         FROM workflow_runs
         WHERE ${predicates.join(" AND ")}
         ORDER BY created_at DESC`;

        if (options.limit) {
            sql += ` LIMIT ?`;
            params.push(options.limit);
        }

        const rows = await this.db.all<RunRow>(sql, params);
        return rows.map((row) => this.mapRun(row));
    }

    async listActiveRunsByWorkflow(workflowId: string): Promise<WorkflowRunRecord[]> {
        const rows = await this.db.all<RunRow>(
            `SELECT
                id,
                workflow_id AS "workflowId",
                status,
                trigger_type AS "triggerType",
                trigger_source AS "triggerSource",
                input,
                output,
                error,
                current_step AS "currentStep",
                waiting_for AS "waitingFor",
                resume_token AS "resumeToken",
                resume_at AS "resumeAt",
                step_runs AS "stepRuns",
                created_at AS "createdAt",
                started_at AS "startedAt",
                finished_at AS "finishedAt",
                updated_at AS "updatedAt"
             FROM workflow_runs
             WHERE workflow_id = ? AND status IN (?, ?, ?)
             ORDER BY created_at ASC`,
            [workflowId, "queued", "running", "waiting"]
        );
        return rows.map((row) => this.mapRun(row));
    }

    async listRecoverableRuns(): Promise<WorkflowRunRecord[]> {
        const rows = await this.db.all<RunRow>(
            `SELECT
                id,
                workflow_id AS "workflowId",
                status,
                trigger_type AS "triggerType",
                trigger_source AS "triggerSource",
                input,
                output,
                error,
                current_step AS "currentStep",
                waiting_for AS "waitingFor",
                resume_token AS "resumeToken",
                resume_at AS "resumeAt",
                step_runs AS "stepRuns",
                created_at AS "createdAt",
                started_at AS "startedAt",
                finished_at AS "finishedAt",
                updated_at AS "updatedAt"
             FROM workflow_runs
             WHERE status IN (?, ?, ?)
             ORDER BY created_at ASC`,
            ["queued", "running", "waiting"]
        );
        return rows.map((row) => this.mapRun(row));
    }

    async updateRun(runId: string, input: UpdateRunInput): Promise<WorkflowRunRecord> {
        const timestamp = now();
        const assignments: string[] = [];
        const params: unknown[] = [];

        if (input.status !== undefined) {
            assignments.push(`status = ?`);
            params.push(input.status);
        }
        if (input.output !== undefined) {
            assignments.push(`output = ?`);
            params.push(serializeJsonValue(input.output));
        }
        if (input.error !== undefined) {
            assignments.push(`error = ?`);
            params.push(input.error);
        }
        if (input.currentStep !== undefined) {
            assignments.push(`current_step = ?`);
            params.push(input.currentStep);
        }
        if (input.waitingFor !== undefined) {
            assignments.push(`waiting_for = ?`);
            params.push(input.waitingFor);
        }
        if (input.resumeToken !== undefined) {
            assignments.push(`resume_token = ?`);
            params.push(input.resumeToken);
        }
        if (input.resumeAt !== undefined) {
            assignments.push(`resume_at = ?`);
            params.push(input.resumeAt);
        }
        if (input.stepRuns !== undefined) {
            assignments.push(`step_runs = ?`);
            params.push(serializeStepRuns(input.stepRuns));
        }
        if (input.finishedAt !== undefined) {
            assignments.push(`finished_at = ?`);
            params.push(input.finishedAt);
        }

        assignments.push(`updated_at = ?`);
        params.push(timestamp, runId);

        await this.db.run(
            `UPDATE workflow_runs
             SET ${assignments.join(", ")}
             WHERE id = ?`,
            params
        );

        return (await this.getRun(runId)) as WorkflowRunRecord;
    }

    async appendRunLog(runId: string, workflowId: string, stream: WorkflowLogStream, chunk: string): Promise<WorkflowRunLogRecord> {
        const record: WorkflowRunLogRecord = {
            id: randomUUID(),
            workflowId,
            runId,
            stream,
            chunk,
            createdAt: now(),
        };

        await this.db.run(
            `INSERT INTO workflow_run_logs (id, workflow_id, run_id, stream, chunk, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [record.id, record.workflowId, record.runId, record.stream, record.chunk, record.createdAt]
        );

        return record;
    }

    async listRunLogs(runId: string, after?: number): Promise<WorkflowRunLogRecord[]> {
        const params: unknown[] = [runId];
        let sql = `SELECT
            id,
            workflow_id AS "workflowId",
            run_id AS "runId",
            stream,
            chunk,
            created_at AS "createdAt"
         FROM workflow_run_logs
         WHERE run_id = ?`;

        if (after !== undefined) {
            sql += ` AND created_at > ?`;
            params.push(after);
        }

        sql += ` ORDER BY created_at ASC`;

        const rows = await this.db.all<RunLogRow>(sql, params);
        return rows.map((row) => this.mapRunLog(row));
    }

    async asyncKeyCount(): Promise<number> {
        const row = await this.db.get<{ count: number | string | bigint }>(
            `SELECT COUNT(*) AS count FROM api_keys WHERE revoked_at IS NULL`
        );
        return asNumber(row?.count) ?? 0;
    }

    async verifyApiKey(apiKey: string): Promise<boolean> {
        const keyHash = hashApiKey(apiKey);
        const row = await this.db.get<{ id: string }>(
            `SELECT id
             FROM api_keys
             WHERE key_hash = ? AND revoked_at IS NULL`,
            [keyHash]
        );
        return Boolean(row);
    }

    async createApiKey(name: string, apiKey: string): Promise<{ id: string; name: string; prefix: string }> {
        const timestamp = now();
        const record = {
            id: randomUUID(),
            name,
            keyHash: hashApiKey(apiKey),
            prefix: getApiKeyPrefix(apiKey),
            createdAt: timestamp,
            revokedAt: null,
        };

        await this.db.run(
            `INSERT INTO api_keys (id, name, key_hash, prefix, created_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [record.id, record.name, record.keyHash, record.prefix, record.createdAt, record.revokedAt]
        );

        return {
            id: record.id,
            name: record.name,
            prefix: record.prefix,
        };
    }

    async getSetting(key: string): Promise<string | null> {
        const row = await this.db.get<{ value: string }>(
            `SELECT value
             FROM sandbox_settings
             WHERE key = ?`,
            [key]
        );
        return row?.value ?? null;
    }

    async setSetting(key: string, value: string): Promise<void> {
        const timestamp = now();
        const existing = await this.getSetting(key);

        if (existing === null) {
            await this.db.run(
                `INSERT INTO sandbox_settings (key, value, created_at, updated_at)
                 VALUES (?, ?, ?, ?)`,
                [key, value, timestamp, timestamp]
            );
            return;
        }

        await this.db.run(
            `UPDATE sandbox_settings
             SET value = ?, updated_at = ?
             WHERE key = ?`,
            [value, timestamp, key]
        );
    }
}

export function createPersistenceStore(optionsOrPath: PersistenceStoreOptions | string): PersistenceStore {
    return new PersistenceStore(normalizeOptions(optionsOrPath));
}
