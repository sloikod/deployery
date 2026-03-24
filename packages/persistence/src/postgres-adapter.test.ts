import { afterEach, describe, expect, it, vi } from "vitest";

const { endMock, queryMock, poolConfigs } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const endMock = vi.fn();
  const poolConfigs: unknown[] = [];
  return { endMock, queryMock, poolConfigs };
});

vi.mock("pg", () => ({
  Pool: class Pool {
    constructor(config: unknown) {
      poolConfigs.push(config);
    }

    query = queryMock;
    end = endMock;
  },
}));

import { createPersistenceStore } from "./index";
import { parseWorkflowManifest } from "@deployery/workflow-schema";

const MINIMAL_MANIFEST = parseWorkflowManifest({
  triggers: [{ type: "manual" }],
  steps: [{ type: "command", name: "run", command: "echo hi" }],
});

describe("PersistenceStore postgres adapter", () => {
  afterEach(() => {
    queryMock.mockReset();
    endMock.mockReset();
    poolConfigs.length = 0;
  });

  it("builds a pool from a connection string and enables ssl when requested", async () => {
    const store = createPersistenceStore({
      type: "postgres",
      postgres: {
        connectionUrl: "postgres://deployery:test@db.example.com/app",
        sslEnabled: true,
      },
    });

    queryMock.mockResolvedValue({ rows: [] });

    await store.init();

    expect(store.db.type).toBe("postgres");
    expect(poolConfigs[0]).toEqual({
      connectionString: "postgres://deployery:test@db.example.com/app",
      ssl: {
        rejectUnauthorized: false,
      },
    });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS workflows"));
  });

  it("translates sqlite-style placeholders for get/all/run calls", async () => {
    const store = createPersistenceStore({
      type: "postgres",
      postgres: {
        host: "localhost",
        port: 5432,
        database: "deployery",
        user: "deployery",
        password: "secret",
      },
    });

    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "one" }, { id: "two" }] })
      .mockResolvedValueOnce({ rows: [{ id: "first" }] })
      .mockResolvedValueOnce({ rows: [] });

    const rows = await store.db.all(
      "SELECT * FROM things WHERE a = ? AND b = ?",
      ["alpha", "beta"],
    );
    const row = await store.db.get("SELECT * FROM things WHERE id = ?", ["one"]);
    await store.db.run("UPDATE things SET name = ? WHERE id = ?", ["n", "one"]);

    expect(poolConfigs[0]).toEqual({
      host: "localhost",
      port: 5432,
      database: "deployery",
      user: "deployery",
      password: "secret",
    });
    expect(rows).toEqual([{ id: "one" }, { id: "two" }]);
    expect(row).toEqual({ id: "first" });
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      "SELECT * FROM things WHERE a = $1 AND b = $2",
      ["alpha", "beta"],
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      "SELECT * FROM things WHERE id = $1",
      ["one"],
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      "UPDATE things SET name = $1 WHERE id = $2",
      ["n", "one"],
    );
  });

  it("closes the postgres pool", async () => {
    const store = createPersistenceStore({
      type: "postgres",
      postgres: {},
    });

    endMock.mockResolvedValue(undefined);
    await store.close();

    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it("maps bigint and string database values into workflow records", async () => {
    const store = createPersistenceStore({
      type: "postgres",
      postgres: {},
    });

    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "wf-1",
          name: "workflow",
          enabled: "t",
          manifest: JSON.stringify(MINIMAL_MANIFEST),
          createdAt: 10n,
          updatedAt: "20",
        },
      ],
    });

    const workflows = await store.listWorkflows();
    expect(workflows).toEqual([
      {
        id: "wf-1",
        name: "workflow",
        enabled: true,
        manifest: MINIMAL_MANIFEST,
        createdAt: 10,
        updatedAt: 20,
      },
    ]);
  });

  it("treats invalid numeric values as nullish defaults and numeric booleans correctly", async () => {
    const store = createPersistenceStore({
      type: "postgres",
      postgres: {},
    });

    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "wf-2",
          name: "workflow-2",
          enabled: 0,
          manifest: JSON.stringify(MINIMAL_MANIFEST),
          createdAt: "not-a-number",
          updatedAt: "also-bad",
        },
      ],
    });

    const workflow = await store.getWorkflowByName("workflow-2");
    expect(workflow).toEqual({
      id: "wf-2",
      name: "workflow-2",
      enabled: false,
      manifest: MINIMAL_MANIFEST,
      createdAt: 0,
      updatedAt: 0,
    });
  });

  it("preserves boolean enabled values directly", async () => {
    const store = createPersistenceStore({
      type: "postgres",
      postgres: {},
    });

    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "wf-3",
          name: "workflow-3",
          enabled: true,
          manifest: JSON.stringify(MINIMAL_MANIFEST),
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    const workflow = await store.getWorkflowById("wf-3");
    expect(workflow?.enabled).toBe(true);
  });
});
