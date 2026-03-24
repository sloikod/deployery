import { afterEach, describe, expect, it, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  exec: execMock,
}));

import {
  AUDIO_WS_PORT,
  getAudioProxyPath,
  getVncProxyPath,
  run,
  runSilent,
  sleep,
} from "./utils";

describe("extension desktop utils", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("run resolves trimmed stdout", async () => {
    execMock.mockImplementation((_cmd, _options, callback) => {
      callback(null, "  hello world  \n", "");
    });

    await expect(run("echo hi")).resolves.toBe("hello world");
  });

  it("run rejects with stderr when the command fails", async () => {
    execMock.mockImplementation((_cmd, _options, callback) => {
      callback(new Error("spawn failed"), "", "kaboom");
    });

    await expect(run("bad")).rejects.toThrow("kaboom");
  });

  it("run falls back to the process error message", async () => {
    execMock.mockImplementation((_cmd, _options, callback) => {
      callback(new Error("spawn failed"), "", "");
    });

    await expect(run("bad")).rejects.toThrow("spawn failed");
  });

  it("runSilent always resolves trimmed stdout", async () => {
    execMock.mockImplementation((_cmd, _options, callback) => {
      callback(new Error("ignored"), "  partial output \n", "");
    });

    await expect(runSilent("bad")).resolves.toBe("partial output");
  });

  it("sleep resolves after at least the requested delay", async () => {
    const startedAt = Date.now();
    await sleep(5);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4);
  });

  it("resolves proxy paths from the VS Code proxy template", () => {
    vi.stubEnv("VSCODE_PROXY_URI", "./proxy/{{port}}");
    expect(getVncProxyPath(5901)).toBe("/proxy/5901");
    expect(getAudioProxyPath()).toBe(`/proxy/${AUDIO_WS_PORT}`);
  });

  it("normalizes absolute and bare proxy templates", () => {
    vi.stubEnv("VSCODE_PROXY_URI", "/ports/{{port}}");
    expect(getVncProxyPath(8080)).toBe("/ports/8080");

    vi.stubEnv("VSCODE_PROXY_URI", "ports/{{port}}");
    expect(getVncProxyPath(8081)).toBe("/ports/8081");
  });
});
