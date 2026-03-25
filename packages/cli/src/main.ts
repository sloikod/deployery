#!/usr/bin/env node
import fs from "fs";
import path from "path";

import {
  WORKFLOW_SCHEMA_URL,
  normalizeWorkflowName,
  parseWorkflowManifest,
  safeParseWorkflowManifest,
} from "@deployery/workflow-schema";

const BASE_URL = (
  process.env.DEPLOYERY_BASE_URL ?? "http://localhost:3131"
).replace(/\/$/, "");
const API_KEY = process.env.DEPLOYERY_API_KEY;
const WORKFLOWS_DIR = path.join(
  process.env.HOME ?? process.cwd(),
  "Desktop",
  "workflows",
);
const VALID_NAME = /^[a-z][a-z0-9-]*$/;

type StoredWorkflow = {
  id: string;
  name: string;
  manifest: {
    steps: Array<{
      name: string;
      pinned_input?: unknown;
      pinned_output?: unknown;
    }>;
    triggers: unknown[];
    settings?: unknown;
  };
};

type StoredRun = {
  id: string;
  workflowId: string;
  status: string;
  triggerType: string;
  error: string | null;
  stepRuns: Array<{
    name: string;
    status: string;
    error?: string;
    output?: unknown;
    input?: unknown;
    startedAt?: number;
    finishedAt?: number;
  }>;
  startedAt: number;
  finishedAt: number | null;
};

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  return `${(ms / 1_000).toFixed(1)}s`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...options?.headers,
    },
  });

  const body = await response
    .json()
    .catch(() => ({ error: response.statusText }));
  if (!response.ok) {
    die(`Error: ${body.error ?? response.statusText}`);
  }
  return body as T;
}

function readWorkflowManifest(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw) as unknown;
  const parsed = safeParseWorkflowManifest(json);
  if (!parsed.success) {
    die(`Error: "${filePath}" is not a valid workflow manifest`);
  }
  return parseWorkflowManifest(json);
}

function resolveWorkflowFiles(
  filter?: string,
): Array<{
  name: string;
  path: string;
  manifest: ReturnType<typeof parseWorkflowManifest>;
}> {
  const candidates: string[] = [];

  if (filter && fs.existsSync(filter) && fs.statSync(filter).isFile()) {
    candidates.push(path.resolve(filter));
  } else {
    if (fs.existsSync(process.cwd())) {
      for (const fileName of fs.readdirSync(process.cwd())) {
        if (fileName.endsWith(".json")) {
          candidates.push(path.join(process.cwd(), fileName));
        }
      }
    }
    if (fs.existsSync(WORKFLOWS_DIR)) {
      for (const fileName of fs.readdirSync(WORKFLOWS_DIR)) {
        if (fileName.endsWith(".json")) {
          candidates.push(path.join(WORKFLOWS_DIR, fileName));
        }
      }
    }
  }

  const workflows = candidates.flatMap((filePath) => {
    try {
      const manifest = readWorkflowManifest(filePath);
      return [
        {
          name: normalizeWorkflowName(path.basename(filePath)),
          path: filePath,
          manifest,
        },
      ];
    } catch {
      return [];
    }
  });

  if (!filter) {
    return workflows;
  }

  if (fs.existsSync(filter) && fs.statSync(filter).isFile()) {
    return workflows.filter(
      (workflow) => workflow.path === path.resolve(filter),
    );
  }

  const byName = workflows.filter(
    (workflow) =>
      workflow.name === filter || path.basename(workflow.path) === filter,
  );
  if (byName.length === 0) {
    die(
      `Error: No workflow named "${filter}" found in ${process.cwd()} or ${WORKFLOWS_DIR}`,
    );
  }

  return byName;
}

async function listWorkflows(): Promise<StoredWorkflow[]> {
  return apiFetch<StoredWorkflow[]>("/api/v1/workflows");
}

async function getWorkflowByName(
  name: string,
): Promise<StoredWorkflow | undefined> {
  const workflows = await listWorkflows();
  return workflows.find((workflow) => workflow.name === name);
}

async function push(filter?: string) {
  const workflows = resolveWorkflowFiles(filter);
  if (workflows.length === 0) {
    console.log("No workflows found.");
    return;
  }

  for (const workflow of workflows) {
    if (!VALID_NAME.test(workflow.name)) {
      die(
        `Error: "${path.basename(workflow.path)}" must use lowercase kebab-case`,
      );
    }

    const manifest = parseWorkflowManifest(workflow.manifest);
    await apiFetch("/api/v1/workflows", {
      method: "POST",
      body: JSON.stringify({
        name: workflow.name,
        manifest,
      }),
    });
    console.log(`pushed: ${workflow.name}`);
  }
}

async function pull(filter?: string) {
  const workflows = await listWorkflows();
  let selected = workflows;
  let targetPath: string | null = null;

  if (filter && (filter.includes(path.sep) || filter.endsWith(".json"))) {
    targetPath = path.resolve(filter);
    const targetName = normalizeWorkflowName(path.basename(filter));
    selected = workflows.filter((workflow) => workflow.name === targetName);
  } else if (filter) {
    selected = workflows.filter((workflow) => workflow.name === filter);
  }

  if (selected.length === 0) {
    die(`Error: No workflow named "${filter}" found`);
  }

  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

  for (const workflow of selected) {
    const manifest = {
      ...workflow.manifest,
      $schema: WORKFLOW_SCHEMA_URL,
    };
    const filePath =
      targetPath ?? path.join(WORKFLOWS_DIR, `${workflow.name}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `pulled: ${workflow.name} -> ${path.relative(process.cwd(), filePath)}`,
    );
  }
}

async function trigger(name: string, data: string | undefined) {
  const workflow = await getWorkflowByName(name);
  if (!workflow) {
    die(`Error: Workflow "${name}" not found`);
  }

  const response = await apiFetch<StoredRun>(
    `/api/v1/workflows/${workflow.id}/trigger`,
    {
      method: "POST",
      body: JSON.stringify({
        data: data ?? null,
      }),
    },
  );
  console.log(response.id);
}

async function run(name: string, data: string | undefined) {
  const local = resolveWorkflowFiles(name);
  if (local.length === 0) {
    die(`Error: Workflow "${name}" not found locally`);
  }

  await push(local[0].path);
  const workflow = await getWorkflowByName(local[0].name);
  if (!workflow) {
    die(`Error: Workflow "${local[0].name}" was pushed but cannot be loaded`);
  }

  const run = await apiFetch<StoredRun>(
    `/api/v1/workflows/${workflow.id}/trigger`,
    {
      method: "POST",
      body: JSON.stringify({
        data: data ?? null,
      }),
    },
  );
  console.log(`run: ${run.id}`);
  console.log("");

  const totalSteps = workflow.manifest.steps.length;
  const seenStatuses = new Map<number, string>();
  let lastLogTimestamp = 0;

  while (true) {
    await sleep(500);

    const currentRun = await apiFetch<StoredRun>(
      `/api/v1/workflows/runs/${run.id}`,
    );
    currentRun.stepRuns.forEach((step, index) => {
      const previous = seenStatuses.get(index);
      if (previous === step.status) {
        return;
      }

      const label = `[${index + 1}/${totalSteps}] ${step.name.padEnd(20)}`;
      if (step.status === "running") {
        console.log(`${label} running`);
      } else if (step.status === "completed") {
        const duration =
          step.startedAt && step.finishedAt
            ? formatDuration(step.finishedAt - step.startedAt)
            : "-";
        console.log(`${label} done ${duration}`);
      } else if (step.status === "waiting") {
        console.log(`${label} waiting`);
      } else if (step.status === "failed") {
        console.log(`${label} failed ${step.error ?? ""}`.trimEnd());
      }
      seenStatuses.set(index, step.status);
    });

    const logs = await apiFetch<
      Array<{ stream: string; chunk: string; createdAt: number }>
    >(
      `/api/v1/workflows/${workflow.id}/runs/${run.id}/logs${lastLogTimestamp ? `?after=${lastLogTimestamp}` : ""}`,
    );
    for (const log of logs) {
      const prefix = log.stream === "stderr" ? "! " : "> ";
      console.log(`${prefix}${log.chunk}`);
      lastLogTimestamp = Math.max(lastLogTimestamp, log.createdAt);
    }

    if (currentRun.status === "completed") {
      const duration =
        currentRun.finishedAt !== null
          ? formatDuration(currentRun.finishedAt - currentRun.startedAt)
          : "-";
      console.log("");
      console.log(`Run completed in ${duration}`);
      return;
    }

    if (currentRun.status === "failed" || currentRun.status === "cancelled") {
      const duration =
        currentRun.finishedAt !== null
          ? formatDuration(currentRun.finishedAt - currentRun.startedAt)
          : "-";
      die(
        `Run ${currentRun.status} in ${duration}: ${currentRun.error ?? "unknown error"}`,
      );
    }
  }
}

async function listRuns(name?: string) {
  const workflows = await listWorkflows();
  const selected = name
    ? workflows.filter((workflow) => workflow.name === name)
    : workflows;
  if (selected.length === 0) {
    die(`Error: Workflow "${name}" not found`);
  }

  const rows: Array<[string, string, string, string, string, string]> = [];
  for (const workflow of selected) {
    const runs = await apiFetch<StoredRun[]>(
      `/api/v1/workflows/${workflow.id}/runs?limit=10`,
    );
    runs.forEach((run) => {
      rows.push([
        workflow.name,
        run.id.slice(-8),
        run.status,
        formatRelativeTime(run.startedAt),
        run.finishedAt ? formatDuration(run.finishedAt - run.startedAt) : "-",
        run.triggerType,
      ]);
    });
  }

  if (rows.length === 0) {
    console.log("No runs found.");
    return;
  }

  const headers = [
    "WORKFLOW",
    "RUN ID",
    "STATUS",
    "STARTED",
    "DURATION",
    "TRIGGER",
  ];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const formatRow = (row: string[]) =>
    row.map((value, index) => value.padEnd(widths[index])).join("  ");

  console.log(formatRow(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  rows.forEach((row) => console.log(formatRow(row)));
}

async function logs(runId: string, follow: boolean) {
  let after: number | undefined;

  while (true) {
    const run = await apiFetch<StoredRun>(`/api/v1/workflows/runs/${runId}`);
    const query = after !== undefined ? `?after=${after}` : "";
    const logRows = await apiFetch<
      Array<{ stream: string; chunk: string; createdAt: number }>
    >(`/api/v1/workflows/${run.workflowId}/runs/${runId}/logs${query}`);

    if (after === undefined) {
      run.stepRuns.forEach((step, index) => {
        const duration =
          step.startedAt && step.finishedAt
            ? ` (${formatDuration(step.finishedAt - step.startedAt)})`
            : "";
        console.log(
          `[${index + 1}/${run.stepRuns.length}] ${step.name} ${step.status}${duration}`,
        );
        if (step.status === "failed" && step.error) {
          console.log(`    error: ${step.error}`);
        }
      });
      console.log("");
    }

    logRows.forEach((log) => {
      const prefix = log.stream === "stderr" ? "! " : "> ";
      console.log(`${prefix}${log.chunk}`);
    });
    after = logRows.at(-1)?.createdAt ?? after;

    if (!follow || ["completed", "failed", "cancelled"].includes(run.status)) {
      return;
    }

    await sleep(1_000);
    console.log("");
  }
}

async function cancel(runId: string) {
  const run = await apiFetch<StoredRun>(`/api/v1/workflows/runs/${runId}`);
  await apiFetch(`/api/v1/workflows/${run.workflowId}/runs/${runId}/cancel`, {
    method: "POST",
  });
  console.log(`cancelled: ${runId}`);
}

async function webhook(name: string) {
  const workflow = await getWorkflowByName(name);
  if (!workflow) {
    die(`Error: Workflow "${name}" not found`);
  }
  const urls = await apiFetch<{ trigger: string }>(
    `/api/v1/workflows/${workflow.id}/webhook-urls`,
  );
  console.log(urls.trigger);
}

function updatePinnedValue(
  name: string,
  stepName: string,
  side: "input" | "output",
  value: unknown,
) {
  const local = resolveWorkflowFiles(name);
  if (local.length === 0) {
    die(`Error: Workflow "${name}" not found locally`);
  }

  const target = local[0];
  const step = target.manifest.steps.find((entry) => entry.name === stepName);
  if (!step) {
    die(`Error: Step "${stepName}" not found in ${target.path}`);
  }

  if (side === "output") {
    step.pinned_output = value as never;
  } else {
    step.pinned_input = value as never;
  }

  fs.writeFileSync(
    target.path,
    `${JSON.stringify(target.manifest, null, 2)}\n`,
  );
}

async function pin(name: string, stepName: string, side: "input" | "output") {
  const workflow = await getWorkflowByName(name);
  if (!workflow) {
    die(`Error: Workflow "${name}" not found`);
  }
  const runs = await apiFetch<StoredRun[]>(
    `/api/v1/workflows/${workflow.id}/runs?limit=1&status=completed`,
  );
  if (runs.length === 0) {
    die(`Error: No completed runs found for "${name}"`);
  }
  const stepRun = runs[0].stepRuns.find((entry) => entry.name === stepName);
  if (!stepRun) {
    die(`Error: Step "${stepName}" not found in last run`);
  }
  updatePinnedValue(
    name,
    stepName,
    side,
    side === "output" ? stepRun.output : stepRun.input,
  );
  console.log(`pinned: ${stepName}.${side}`);
}

async function unpin(name: string, stepName: string, side: "input" | "output") {
  const local = resolveWorkflowFiles(name);
  if (local.length === 0) {
    die(`Error: Workflow "${name}" not found locally`);
  }

  const target = local[0];
  const step = target.manifest.steps.find((entry) => entry.name === stepName);
  if (!step) {
    die(`Error: Step "${stepName}" not found in ${target.path}`);
  }

  if (side === "output") {
    delete step.pinned_output;
  } else {
    delete step.pinned_input;
  }

  fs.writeFileSync(
    target.path,
    `${JSON.stringify(target.manifest, null, 2)}\n`,
  );
  console.log(`unpinned: ${stepName}.${side}`);
}

function readPipedInput(): string | undefined {
  if (process.stdin.isTTY) {
    return undefined;
  }
  const text = fs.readFileSync(0, "utf8").trim();
  return text.length > 0 ? text : undefined;
}

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "push":
      await push(args[0]);
      return;
    case "pull":
      await pull(args[0]);
      return;
    case "trigger": {
      const name = args[0];
      if (!name) {
        die("Usage: deployery trigger <name> [data]");
      }
      await trigger(name, args[1] ?? readPipedInput());
      return;
    }
    case "run": {
      const name = args[0];
      if (!name) {
        die("Usage: deployery run <name> [data]");
      }
      await run(name, args[1] ?? readPipedInput());
      return;
    }
    case "runs":
      await listRuns(args[0]);
      return;
    case "logs":
      if (!args[0]) {
        die("Usage: deployery logs <runId> [--follow]");
      }
      await logs(args[0], args[1] === "--follow" || args[1] === "-f");
      return;
    case "cancel":
      if (!args[0]) {
        die("Usage: deployery cancel <runId>");
      }
      await cancel(args[0]);
      return;
    case "webhook":
      if (!args[0]) {
        die("Usage: deployery webhook <name>");
      }
      await webhook(args[0]);
      return;
    case "pin":
      if (
        !args[0] ||
        !args[1] ||
        (args[2] !== "input" && args[2] !== "output")
      ) {
        die("Usage: deployery pin <name> <step> <input|output>");
      }
      await pin(args[0], args[1], args[2]);
      return;
    case "unpin":
      if (
        !args[0] ||
        !args[1] ||
        (args[2] !== "input" && args[2] !== "output")
      ) {
        die("Usage: deployery unpin <name> <step> <input|output>");
      }
      await unpin(args[0], args[1], args[2]);
      return;
    default:
      console.log("Usage:");
      console.log("  deployery push [name]");
      console.log("  deployery pull [name]");
      console.log("  deployery trigger <name> [data]");
      console.log("  deployery run <name> [data]");
      console.log("  deployery runs [name]");
      console.log("  deployery logs <runId> [--follow]");
      console.log("  deployery cancel <runId>");
      console.log("  deployery webhook <name>");
      console.log("  deployery pin <name> <step> <input|output>");
      console.log("  deployery unpin <name> <step> <input|output>");
      process.exit(command ? 1 : 0);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
