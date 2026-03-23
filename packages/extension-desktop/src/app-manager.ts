import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import { SwaySession, SwaySessionListener, WindowInfo } from "./app-session";
import { PanelState, WindowPanel } from "./window-panel";
import { run, runSilent, sleep, AUDIO_WS_PORT, PULSE_TCP_PORT, PULSE_RUNTIME, SAMPLE_RATE } from "./utils";

export class DesktopManager implements vscode.Disposable {
    private session: SwaySession | null = null;
    /** Panels keyed by Sway con_id - one panel per window. */
    private readonly panels = new Map<number, WindowPanel>();
    /**
     * Webview panel shells handed back by VS Code's WebviewPanelSerializer during
     * pause/resume. Keyed by conId. openPanel() picks them up once the session has
     * reconstructed the window tree and we know the correct wsPort.
     */
    private readonly pendingRestorePanels = new Map<number, vscode.WebviewPanel>();
    private websockifyProcess: ChildProcess | undefined;
    private audioStarted = false;
    private audioMuted = false;
    private readonly statusBar: vscode.StatusBarItem;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly log: vscode.LogOutputChannel,
    ) {
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
        vscode.commands.executeCommand("setContext", "deployery-desktop.audioMuted", false);

        this.startAudioPipeline().catch((e) => this.log.warn(`Audio pipeline: ${e}`));
        this.startSession().catch((e) => this.log.error(`Sway session failed: ${e}`));
        this.log.info("DesktopManager started");
    }

    // --- Sway session ---

    private async startSession() {
        const listener = this.makeListener();
        this.session = new SwaySession(this.log, listener);
        await this.session.start();
        // Any shells still in pendingRestorePanels were not matched by
        // reconstructWindowsFromTree (0 windows found despite retries). Register them
        // anyway so they sit in panels[] with a stale wsPort. If the window re-appears
        // (Sway re-delivers a mapped event or Chrome reconnects), openPanel will call
        // updateStream and the correct port will be used. The user can close them
        // manually if the app is genuinely gone.
        for (const shell of this.pendingRestorePanels.values()) shell.dispose();
        this.pendingRestorePanels.clear();
    }

    private makeListener(): SwaySessionListener {
        return {
            onWindowMapped: (_session, win) => this.openPanel(win),
            onWindowClosed: (_session, conId) => {
                const panel = this.panels.get(conId);
                if (panel) {
                    // Remove from map BEFORE dispose so onDidDispose finds it gone
                    // and does not attempt to kill an already-closed window.
                    this.panels.delete(conId);
                    panel.dispose();
                    this.updateStatusBar();
                }
            },
            onWindowNonResizable: (_session, conId, width, height) => {
                this.panels.get(conId)?.setNonResizable(width, height);
            },
        };
    }

    // --- Panel management ---

    private openPanel(win: WindowInfo) {
        const existing = this.panels.get(win.conId);
        if (existing) {
            // Reuse path: stream restarted, possibly on a different port.
            this.log.info(`Reconnecting panel con_id=${win.conId} wsPort=${win.wsPort}`);
            existing.updateStream(win.wsPort);
            return;
        }
        // Use the restore shell from WebviewPanelSerializer if available so we avoid
        // an intermediate render with a stale wsPort before the correct one is known.
        const shell = this.pendingRestorePanels.get(win.conId);
        this.pendingRestorePanels.delete(win.conId);

        const title = win.title || win.appId || "window";
        this.registerPanel(
            new WindowPanel(win.conId, title, win.wsPort, this.extensionUri, this.log, !this.audioMuted, shell),
            win.conId,
        );
    }

    /**
     * Called by WebviewPanelSerializer with the panel shell VS Code hands back on
     * pause/resume. We store it until openPanel fires with the correct wsPort, then
     * pass it to the WindowPanel constructor to avoid a blank-then-reconnect flash.
     */
    restorePanel(shell: vscode.WebviewPanel, state: PanelState) {
        if (this.panels.has(state.conId)) {
            // Session already opened a fresh panel for this window - discard the shell.
            shell.dispose();
            return;
        }
        this.pendingRestorePanels.set(state.conId, shell);
    }

    private registerPanel(panel: WindowPanel, conId: number) {
        panel.onDidDispose(() => {
            // Map.delete returns true only if the entry was still present.
            // When onWindowClosed removes it first, delete returns false and we skip kill.
            // When the user closes the VS Code panel, delete returns true and we kill.
            const owned = this.panels.delete(conId);
            if (owned) this.session?.killWindow(conId);
            this.updateStatusBar();
        });

        panel.onDidPanelResize((width, height) => {
            this.session?.resizeWindow(conId, width, height).catch(e =>
                this.log.warn(`Resize failed con_id=${conId}: ${e}`)
            );
        });

        panel.onDidBgColor((color) => {
            this.session?.setOutputBackground(conId, color);
        });

        this.panels.set(conId, panel);
        this.updateStatusBar();
    }

    // --- Audio ---

    private async startAudioPipeline() {
        if (this.audioStarted) return;
        this.audioStarted = true;
        try {
            await runSilent(`mkdir -p ${PULSE_RUNTIME}`);
            // pulseaudio daemonizes - expected to succeed or already be running.
            await runSilent(`XDG_RUNTIME_DIR=${PULSE_RUNTIME} pulseaudio --daemonize=yes --exit-idle-time=-1`);
            await sleep(500);
            await run(`XDG_RUNTIME_DIR=${PULSE_RUNTIME} pactl load-module module-null-sink sink_name=virtual_sink`);
            await run(`XDG_RUNTIME_DIR=${PULSE_RUNTIME} pactl set-default-sink virtual_sink`);
            await run(`XDG_RUNTIME_DIR=${PULSE_RUNTIME} pactl load-module module-simple-protocol-tcp port=${PULSE_TCP_PORT} source=virtual_sink.monitor record=true playback=false rate=${SAMPLE_RATE} channels=1 format=s16le`);
        } catch (e) {
            this.log.warn(`Audio pipeline setup failed: ${e}`);
            return;
        }
        this.websockifyProcess = spawn("websockify", ["0.0.0.0:" + AUDIO_WS_PORT, `127.0.0.1:${PULSE_TCP_PORT}`], {
            stdio: "ignore",
        });
        this.websockifyProcess.on("exit", (code) => {
            if (code !== null) this.log.warn(`Audio websockify exited code=${code}`);
        });
        this.log.info("Audio pipeline started (PulseAudio -> websockify)");
    }

    enableAudio() {
        if (!this.audioMuted) return;
        for (const panel of this.panels.values()) panel.toggleAudio();
        this.audioMuted = false;
        vscode.commands.executeCommand("setContext", "deployery-desktop.audioMuted", false);
    }

    disableAudio() {
        if (this.audioMuted) return;
        for (const panel of this.panels.values()) panel.toggleAudio();
        this.audioMuted = true;
        vscode.commands.executeCommand("setContext", "deployery-desktop.audioMuted", true);
    }

    // --- Status bar ---

    private updateStatusBar() {
        const count = this.panels.size;
        if (count === 0) {
            this.statusBar.hide();
        } else {
            this.statusBar.text = `$(vm) ${count} window${count === 1 ? "" : "s"}`;
            this.statusBar.tooltip = "GUI windows streamed via wayvnc";
            this.statusBar.show();
        }
    }

    dispose() {
        this.websockifyProcess?.kill();
        runSilent("pkill -f pulseaudio");
        // Clear map before disposing panels so onDidDispose callbacks find it empty
        // and do not attempt to kill windows (session teardown handles that).
        const panels = [...this.panels.values()];
        this.panels.clear();
        for (const panel of panels) panel.dispose();
        for (const shell of this.pendingRestorePanels.values()) shell.dispose();
        this.pendingRestorePanels.clear();
        this.session?.dispose();
        this.statusBar.dispose();
    }
}
