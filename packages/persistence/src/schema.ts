import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sandboxSettingsTable = sqliteTable("sandbox_settings", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
});

export const apiKeysTable = sqliteTable(
    "api_keys",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        keyHash: text("key_hash").notNull(),
        prefix: text("prefix").notNull(),
        createdAt: integer("created_at").notNull(),
        revokedAt: integer("revoked_at"),
    },
    (table) => ({
        keyHashIndex: uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    })
);

export const workflowsTable = sqliteTable(
    "workflows",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
        manifest: text("manifest").notNull(),
        createdAt: integer("created_at").notNull(),
        updatedAt: integer("updated_at").notNull(),
    },
    (table) => ({
        workflowNameIndex: uniqueIndex("workflows_name_idx").on(table.name),
    })
);

export const scheduledTriggersTable = sqliteTable("scheduled_triggers", {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    triggerIndex: integer("trigger_index").notNull(),
    cron: text("cron"),
    at: text("at"),
    timezone: text("timezone"),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
});

export const workflowRunsTable = sqliteTable("workflow_runs", {
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
    resumeAt: integer("resume_at"),
    stepRuns: text("step_runs").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    updatedAt: integer("updated_at").notNull(),
});

export const workflowRunLogsTable = sqliteTable("workflow_run_logs", {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id").notNull(),
    stream: text("stream").notNull(),
    chunk: text("chunk").notNull(),
    createdAt: integer("created_at").notNull(),
});
