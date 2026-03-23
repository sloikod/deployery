import { bigint, boolean, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const sandboxSettingsTable = pgTable("sandbox_settings", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const apiKeysTable = pgTable(
    "api_keys",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        keyHash: text("key_hash").notNull(),
        prefix: text("prefix").notNull(),
        createdAt: bigint("created_at", { mode: "number" }).notNull(),
        revokedAt: bigint("revoked_at", { mode: "number" }),
    },
    (table) => ({
        keyHashIndex: uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    })
);

export const workflowsTable = pgTable(
    "workflows",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        enabled: boolean("enabled").notNull().default(true),
        manifest: text("manifest").notNull(),
        createdAt: bigint("created_at", { mode: "number" }).notNull(),
        updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    },
    (table) => ({
        workflowNameIndex: uniqueIndex("workflows_name_idx").on(table.name),
    })
);

export const scheduledTriggersTable = pgTable("scheduled_triggers", {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    triggerIndex: integer("trigger_index").notNull(),
    cron: text("cron"),
    at: text("at"),
    timezone: text("timezone"),
    nextRunAt: bigint("next_run_at", { mode: "number" }),
    lastRunAt: bigint("last_run_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const workflowRunsTable = pgTable("workflow_runs", {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    status: text("status").notNull(),
    triggerType: text("trigger_type").notNull(),
    triggerSource: text("trigger_source"),
    input: text("input"),
    output: text("output"),
    error: text("error"),
    currentStep: integer("current_step").notNull().default(0),
    waitingFor: text("waiting_for"),
    resumeToken: text("resume_token"),
    resumeAt: bigint("resume_at", { mode: "number" }),
    stepRuns: text("step_runs").notNull().default("[]"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    finishedAt: bigint("finished_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const workflowRunLogsTable = pgTable("workflow_run_logs", {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id").notNull(),
    stream: text("stream").notNull(),
    chunk: text("chunk").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
