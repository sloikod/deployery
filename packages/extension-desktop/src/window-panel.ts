import * as vscode from "vscode";

import { AUDIO_WS_PORT, SAMPLE_RATE } from "./utils";

export interface PanelState {
  conId: number;
  wsPort: number;
  title: string;
}

export class WindowPanel implements vscode.Disposable {
  static readonly VIEW_TYPE = "deployery-window";

  private readonly panel: vscode.WebviewPanel;
  private onDisposeCallback: (() => void) | undefined;
  private onResizeCallback:
    | ((width: number, height: number) => void)
    | undefined;
  private onBgColorCallback: ((color: string) => void) | undefined;

  constructor(
    readonly conId: number,
    initialTitle: string,
    private wsPort: number,
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
    private readonly audioEnabled = false,
    existingPanel?: vscode.WebviewPanel,
  ) {
    if (existingPanel) {
      this.panel = existingPanel;
      this.panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      };
    } else {
      this.panel = vscode.window.createWebviewPanel(
        WindowPanel.VIEW_TYPE,
        initialTitle,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
        },
      );
    }

    this.panel.onDidDispose(() => {
      this.log.info(`Panel closed: con_id=${conId}`);
      this.onDisposeCallback?.();
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "log") {
        this.log.info(`[con:${conId}] ${message.text}`);
      }
      if (message.type === "panel-resize") {
        this.onResizeCallback?.(message.width, message.height);
      }
      if (message.type === "bg-color") {
        this.onBgColorCallback?.(message.color);
      }
    });

    this.panel.webview.html = this.buildLoadingHtml();
    void this.initializeWebview();
  }

  onDidDispose(callback: () => void) {
    this.onDisposeCallback = callback;
  }

  onDidPanelResize(callback: (width: number, height: number) => void) {
    this.onResizeCallback = callback;
  }

  onDidBgColor(callback: (color: string) => void) {
    this.onBgColorCallback = callback;
  }

  reveal() {
    this.panel.reveal(undefined, true);
  }

  toggleAudio() {
    this.panel.webview.postMessage({ type: "toggle-audio" });
  }

  setNonResizable(width: number, height: number) {
    this.panel.webview.postMessage({
      type: "set-non-resizable",
      width,
      height,
    });
  }

  updateStream(wsPort: number, forceReconnect = false): void {
    if (wsPort === this.wsPort && !forceReconnect) {
      return;
    }

    this.wsPort = wsPort;
    void this.postReconnectMessage(wsPort);
  }

  dispose() {
    this.panel.dispose();
  }

  private async initializeWebview(): Promise<void> {
    this.panel.webview.html = await this.buildHtml();
  }

  private async postReconnectMessage(wsPort: number): Promise<void> {
    const vncProxyUri = await this.resolveProxyUri(wsPort);
    this.log.info(
      `Panel reconnect: con_id=${this.conId} wsPort=${wsPort} proxy=${vncProxyUri}`,
    );
    this.panel.webview.postMessage({
      type: "reconnect",
      wsPort,
      vncProxyUri,
    });
  }

  private async resolveProxyUri(port: number): Promise<string> {
    const externalUri = await vscode.env.asExternalUri(
      vscode.Uri.parse(`http://127.0.0.1:${port}`),
    );
    this.log.info(`Resolved external URI: port=${port} uri=${externalUri}`);
    return externalUri.toString();
  }

  private buildLoadingHtml(): string {
    const csp = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html style="height:100%;margin:0"><head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src 'unsafe-inline';
                 script-src ${csp} 'unsafe-inline';">
    <style>
        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
        }
    </style>
</head>
<body>Loading window stream...</body>
</html>`;
  }

  private async buildHtml(): Promise<string> {
    const rfbJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "novnc-rfb.js"),
    );
    const windowJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "window.js"),
    );
    const csp = this.panel.webview.cspSource;
    const vncProxyUri = await this.resolveProxyUri(this.wsPort);
    const audioProxyUri = await this.resolveProxyUri(AUDIO_WS_PORT);
    this.log.info(
      `Initializing panel: con_id=${this.conId} wsPort=${this.wsPort} vncProxy=${vncProxyUri} audioProxy=${audioProxyUri}`,
    );

    const cfg = JSON.stringify({
      conId: this.conId,
      wsPort: this.wsPort,
      title: this.panel.title,
      rfbUri: rfbJs.toString(),
      vncProxyUri,
      audioProxyUri,
      sampleRate: SAMPLE_RATE,
      audioEnabled: this.audioEnabled,
    });

    return `<!DOCTYPE html>
<html style="height:100%;margin:0"><head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src ${csp} 'unsafe-inline';
                 style-src 'unsafe-inline';
                 connect-src ws: wss:;
                 img-src data:;">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
        #screen { position: relative; width: 100%; height: 100%; overflow: hidden; cursor: none; }
        #screen canvas { position: absolute !important; left: 0 !important; top: 0 !important; }
        #status {
            position: absolute; inset: 0; display: flex;
            align-items: center; justify-content: center;
            color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 12px;
        }
    </style>
</head>
<body>
    <div id="status"></div>
    <div id="screen"></div>
    <script id="cfg" type="application/json">${cfg}</script>
    <script type="module" src="${windowJs}"></script>
</body>
</html>`;
  }
}
