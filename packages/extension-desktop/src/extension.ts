import * as vscode from "vscode";
import { DesktopManager } from "./app-manager";
import { PanelState, WindowPanel } from "./window-panel";

let manager: DesktopManager | undefined;

const ExternalUriOpenerPriority = {
  None: 0,
  Option: 1,
  Default: 2,
  Preferred: 3,
} as const;

type ExternalUriOpenerPriorityValue =
  (typeof ExternalUriOpenerPriority)[keyof typeof ExternalUriOpenerPriority];

interface ExternalUriOpenerContext {
  readonly sourceUri: vscode.Uri;
}

interface ExternalUriOpener {
  canOpenExternalUri(
    uri: vscode.Uri,
    token: vscode.CancellationToken,
  ):
    | ExternalUriOpenerPriorityValue
    | Thenable<ExternalUriOpenerPriorityValue>;
  openExternalUri(
    resolvedUri: vscode.Uri,
    ctx: ExternalUriOpenerContext,
    token: vscode.CancellationToken,
  ): Thenable<void> | void;
}

interface ExternalUriOpenerMetadata {
  readonly schemes: readonly string[];
  readonly label: string;
}

type WindowWithExternalUriOpener = typeof vscode.window & {
  registerExternalUriOpener?: (
    id: string,
    opener: ExternalUriOpener,
    metadata: ExternalUriOpenerMetadata,
  ) => vscode.Disposable;
};

type EnvWithOpenExternalOptions = typeof vscode.env & {
  openExternal: (
    target: vscode.Uri,
    options?: { allowContributedOpeners?: boolean | string },
  ) => Thenable<boolean>;
};

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.startsWith("127.") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0"
  );
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hasLoopbackCallback(url: URL): boolean {
  const callbackParamNames = [
    "redirect_uri",
    "redirect_url",
    "redirectUrl",
    "callback",
    "callback_url",
    "callbackUrl",
  ];

  for (const key of callbackParamNames) {
    const value = url.searchParams.get(key);
    if (!value) {
      continue;
    }
    const parsed = parseHttpUrl(value);
    if (parsed && isLoopbackHost(parsed.hostname)) {
      return true;
    }
  }

  return false;
}

function shouldOpenInsideSandbox(
  resolvedUri: vscode.Uri,
  ctx: ExternalUriOpenerContext,
): boolean {
  const source = parseHttpUrl((ctx.sourceUri ?? resolvedUri).toString());
  if (!source) {
    return false;
  }

  if (isLoopbackHost(source.hostname)) {
    return true;
  }

  return hasLoopbackCallback(source);
}

async function openOutsideSandbox(uri: vscode.Uri): Promise<void> {
  await (vscode.env as EnvWithOpenExternalOptions).openExternal(uri, {
    allowContributedOpeners: "default",
  });
}

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("Deployery Desktop", {
    log: true,
  });

  manager = new DesktopManager(context.extensionUri, log);
  context.subscriptions.push(manager, log);

  context.subscriptions.push(
    // Restore panels after pause/resume: VS Code calls this for each persisted
    // webview whose viewType matches. The state was written by vscode.setState()
    // inside the webview so conId/wsPort survive the sandbox freeze.
    vscode.window.registerWebviewPanelSerializer(WindowPanel.VIEW_TYPE, {
      async deserializeWebviewPanel(
        panel: vscode.WebviewPanel,
        state: unknown,
      ) {
        const s = state as PanelState | null;
        if (!s?.conId || !s?.wsPort) {
          panel.dispose();
          return;
        }
        manager?.restorePanel(panel, s);
      },
    }),
    vscode.commands.registerCommand("deployery-desktop.enableAudio", () => {
      manager?.enableAudio();
    }),
    vscode.commands.registerCommand("deployery-desktop.disableAudio", () => {
      manager?.disableAudio();
    }),
  );

  const windowWithExternalUriOpener =
    vscode.window as WindowWithExternalUriOpener;
  if (typeof windowWithExternalUriOpener.registerExternalUriOpener === "function") {
    context.subscriptions.push(
      windowWithExternalUriOpener.registerExternalUriOpener(
        "deployery.defaultSandboxBrowser",
        {
          canOpenExternalUri() {
            return ExternalUriOpenerPriority.Preferred;
          },
          async openExternalUri(resolvedUri, ctx) {
            if (shouldOpenInsideSandbox(resolvedUri, ctx)) {
              const target = ctx.sourceUri ?? resolvedUri;
              await manager?.openExternalUrl(target.toString());
              return;
            }

            await openOutsideSandbox(resolvedUri);
          },
        },
        {
          schemes: ["http", "https"],
          label: "Open external links with Deployery",
        },
      ),
    );
  } else {
    log.warn("registerExternalUriOpener is unavailable in this runtime");
  }
}

export function deactivate() {
  manager?.dispose();
  manager = undefined;
}
