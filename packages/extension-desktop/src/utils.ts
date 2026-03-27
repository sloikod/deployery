import { exec, spawn } from "child_process";

export const SWAY_RUNTIME_DIR = "/tmp/sway-runtime";
export const SWAY_CONFIG_PATH = "/tmp/sway-config";
export const DEPLOYERY_ENV_FILE = "/home/user/.config/deployery/env";

export const AUDIO_WS_PORT = 8765;
export const PULSE_TCP_PORT = 8766;
export const PULSE_RUNTIME = "/tmp/pulse-runtime";
export const SAMPLE_RATE = 48000;

export function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export function runSilent(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10_000 }, (_err, stdout) => {
      resolve((stdout ?? "").trim());
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function launchUrlInDefaultBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("xdg-open", [url], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        HOME: process.env.HOME ?? "/home/user",
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? "/home/user/.config",
        XDG_DATA_HOME:
          process.env.XDG_DATA_HOME ?? "/home/user/.local/share",
      },
    });
    child.once("error", reject);
    child.unref();
    resolve();
  });
}

function resolveProxyPath(port: number): string {
  const template = process.env.VSCODE_PROXY_URI ?? "./proxy/{{port}}";
  const replaced = template.replace("{{port}}", String(port));
  if (replaced.startsWith("./")) {
    return `/${replaced.slice(2)}`;
  }
  if (replaced.startsWith("/")) {
    return replaced;
  }
  return `/${replaced}`;
}

export function getVncProxyPath(port: number): string {
  return resolveProxyPath(port);
}

export function getAudioProxyPath(): string {
  return resolveProxyPath(AUDIO_WS_PORT);
}
