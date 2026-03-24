import * as vscode from "vscode";
import { DesktopManager } from "./app-manager";
import { PanelState, WindowPanel } from "./window-panel";

let manager: DesktopManager | undefined;

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
}

export function deactivate() {
  manager?.dispose();
  manager = undefined;
}
