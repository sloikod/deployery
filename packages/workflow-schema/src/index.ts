import { z } from "zod";

export const WORKFLOW_SCHEMA_URL = "https://deployery.com/workflow.schema.json";

const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([jsonLiteralSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

const envRecordSchema = z.record(z.string(), z.string()).default({});

export const webhookVerificationSchema = z
    .object({
        mode: z.enum(["none", "header", "hmac"]).default("none"),
        header_name: z.string().optional(),
        header_value: z.string().optional(),
        signature_header: z.string().optional(),
        prefix: z.string().optional(),
        algorithm: z.enum(["sha1", "sha256", "sha512"]).default("sha256"),
        secret: z.string().min(1).optional(),
    })
    .strict();

export const manualTriggerSchema = z
    .object({
        type: z.literal("manual"),
    })
    .strict();

export const scheduleTriggerSchema = z
    .object({
        type: z.literal("schedule"),
        cron: z.string().min(1).optional(),
        at: z.string().min(1).optional(),
        timezone: z.string().min(1).optional(),
        enabled: z.boolean().default(true),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (!value.cron && !value.at) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "schedule trigger requires either cron or at",
                path: ["cron"],
            });
        }
    });

export const webhookTriggerSchema = z
    .object({
        type: z.literal("webhook"),
        method: z.string().min(1).default("POST"),
        path: z.string().min(1).optional(),
        secret: z.string().min(1).optional(),
        verification: webhookVerificationSchema.optional(),
    })
    .strict();

export const workflowTriggerSchema = z
    .object({
        type: z.literal("workflow"),
        workflow: z.string().min(1),
    })
    .strict();

export const workflowTriggerUnionSchema = z.discriminatedUnion("type", [
    manualTriggerSchema,
    scheduleTriggerSchema,
    webhookTriggerSchema,
    workflowTriggerSchema,
]);

export const concurrencySettingsSchema = z
    .object({
        max: z.number().int().positive().default(1),
        overflow_behavior: z.enum(["allow", "cancel_oldest", "reject_new"]).default("allow"),
    })
    .strict();

const stepBaseSchema = z.object({
    name: z.string().min(1),
    pinned_input: jsonValueSchema.optional(),
    pinned_output: jsonValueSchema.optional(),
});

export const commandStepSchema = stepBaseSchema
    .extend({
        type: z.literal("command"),
        command: z.string().min(1),
        cwd: z.string().min(1).optional(),
        shell: z.string().min(1).optional(),
        env: envRecordSchema.optional(),
        timeout_seconds: z.number().int().positive().optional(),
    })
    .strict();

export const workflowStepSchema = stepBaseSchema
    .extend({
        type: z.literal("workflow"),
        workflow: z.string().min(1),
        input: jsonValueSchema.optional(),
        timeout_seconds: z.number().int().positive().optional(),
    })
    .strict();

export const waitStepSchema = stepBaseSchema
    .extend({
        type: z.literal("wait"),
        mode: z.enum(["manual", "webhook"]).default("manual"),
        timeout_seconds: z.number().int().positive().optional(),
    })
    .strict();

export const scheduleStepSchema = stepBaseSchema
    .extend({
        type: z.literal("schedule"),
        delay_seconds: z.number().int().positive().optional(),
        at: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (!value.delay_seconds && !value.at) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "schedule step requires either delay_seconds or at",
                path: ["delay_seconds"],
            });
        }
    });

export const webhookStepSchema = stepBaseSchema
    .extend({
        type: z.literal("webhook"),
        url: z.string().url(),
        method: z.string().min(1).default("POST"),
        headers: z.record(z.string(), z.string()).default({}),
        body: jsonValueSchema.optional(),
        timeout_seconds: z.number().int().positive().optional(),
    })
    .strict();

export const workflowStepUnionSchema = z.discriminatedUnion("type", [
    commandStepSchema,
    workflowStepSchema,
    waitStepSchema,
    scheduleStepSchema,
    webhookStepSchema,
]);

export const workflowManifestSchema = z
    .object({
        $schema: z.string().optional(),
        description: z.string().optional(),
        triggers: z.array(workflowTriggerUnionSchema).min(1),
        steps: z.array(workflowStepUnionSchema).min(1),
        settings: z
            .object({
                concurrency: concurrencySettingsSchema.optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export type WorkflowManifest = z.infer<typeof workflowManifestSchema>;
export type WorkflowTrigger = z.infer<typeof workflowTriggerUnionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepUnionSchema>;
export type WebhookTrigger = z.infer<typeof webhookTriggerSchema>;

export function parseWorkflowManifest(input: unknown): WorkflowManifest {
    const manifest = workflowManifestSchema.parse(input);
    return {
        ...manifest,
        $schema: manifest.$schema ?? WORKFLOW_SCHEMA_URL,
    };
}

export function safeParseWorkflowManifest(input: unknown) {
    return workflowManifestSchema.safeParse(input);
}

export function stripWorkflowSchema(manifest: WorkflowManifest): Omit<WorkflowManifest, "$schema"> {
    const { $schema: _schema, ...rest } = manifest;
    return rest;
}

export function normalizeWorkflowName(fileName: string): string {
    return fileName.replace(/\.json$/i, "");
}

export function inferWebhookTrigger(manifest: WorkflowManifest): WebhookTrigger | undefined {
    return manifest.triggers.find((trigger): trigger is WebhookTrigger => trigger.type === "webhook");
}
