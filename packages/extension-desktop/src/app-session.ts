import * as vscode from "vscode";
import * as fs from "fs";
import { ChildProcess, spawn } from "child_process";
import { run, runSilent, sleep, SWAY_RUNTIME_DIR, SWAY_CONFIG_PATH, DEPLOYERY_ENV_FILE, VIRTUAL_POINTER_PATH } from "./utils";

/**
 * Concept hierarchy for the Deployery desktop extension:
 *
 *   Session (SwaySession)  — Wayland compositor (Sway), one per extension lifetime.
 *   Output                 — Virtual display in Sway assigned to exactly one Window.
 *   Stream (WindowStream)  — wayvnc + websockify pipeline capturing one Output.
 *   Window (WindowInfo)    — A mapped Sway window. Tiled windows fill their Output and
 *                            respond to panel resize. Floating windows (dialogs, popups)
 *                            keep their natural size; the Output is sized to fit them.
 *
 * See app-manager.ts / window-panel.ts for the VS Code side:
 *   Panel (WindowPanel)    — VS Code WebviewPanel + noVNC client rendering one Stream.
 *   Manager (DesktopManager) — Ties Session + Panels together; owns the audio pipeline.
 */

/** VNC ports for wayvnc (one per window). */
const VNC_PORT_BASE = 7000;
/** WebSocket ports for websockify bridging noVNC → wayvnc. */
const WS_PORT_BASE = 7500;

/** Minimal Sway IPC types — only the fields this code reads. */
interface SwayNode {
    id: number;
    pid?: number;
    app_id?: string;
    name?: string;
    type?: string;
    floating?: string;
    fullscreen_mode?: number;
    rect?: { x: number; y: number; width: number; height: number };
    window_rect?: { x: number; y: number; width: number; height: number };
    nodes?: SwayNode[];
    floating_nodes?: SwayNode[];
    window_properties?: { class?: string; window_type?: string };
}
interface SwayOutput {
    name: string;
    current_mode?: { width: number; height: number; refresh: number };
    scale?: number;
    rect?: { x: number; y: number };
    active?: boolean;
    dpms?: boolean;
}
interface SwayWindowEvent {
    change: string;
    container: SwayNode;
}

/**
 * Collect all leaf app-window nodes from the Sway tree, paired with their output name.
 * Skips workspace/container nodes; only returns nodes with app_id or window_properties.class.
 */
function collectWindowsWithOutput(
    node: SwayNode,
    outputName?: string,
): Array<{ outputName: string; win: SwayNode }> {
    const out = node.type === "output" ? node.name : outputName;
    const isLeaf =
        out &&
        (node.type === "con" || node.type === "floating_con") &&
        (node.pid ?? 0) > 0 &&   // pid > 0 reliably identifies app windows vs layout containers
        !node.nodes?.length &&
        !node.floating_nodes?.length;
    if (isLeaf) return [{ outputName: out!, win: node }];
    return [
        ...(node.nodes ?? []).flatMap(c => collectWindowsWithOutput(c, out)),
        ...(node.floating_nodes ?? []).flatMap(c => collectWindowsWithOutput(c, out)),
    ];
}

/** Recursively find a sway tree node by con_id. */
function findNodeById(node: SwayNode, id: number): SwayNode | null {
    if (node.id === id) return node;
    for (const child of node.nodes ?? []) {
        const found = findNodeById(child, id);
        if (found) return found;
    }
    for (const child of node.floating_nodes ?? []) {
        const found = findNodeById(child, id);
        if (found) return found;
    }
    return null;
}

const SWAY_CONFIG = `\
xwayland enable
default_border none
default_floating_border none
focus_on_window_activation none
gaps inner 0
gaps outer 0
bar {
    mode invisible
    tray_output none
}
output * bg #000000 solid_color
output * scale 1
# Transparent cursor theme: wlroots headless bakes the software cursor into screencopy
# frames unconditionally (no separate cursor plane). A transparent theme makes the
# baked-in cursor invisible. noVNC renders a smooth client-side dot via showDotCursor.
seat * xcursor_theme transparent-cursor 24
`;

interface WindowStream {
    outputName: string;
    wayvnc: ChildProcess;
    websockify: ChildProcess;
    vncPort: number;
    wsPort: number;
    width: number;
    height: number;
}

export interface WindowInfo {
    conId: number;
    wsPort: number;
    title: string;
    appId: string;
}

export interface SwaySessionListener {
    onWindowMapped(session: SwaySession, win: WindowInfo): void;
    onWindowClosed(session: SwaySession, conId: number): void;
    onWindowNonResizable(session: SwaySession, conId: number, width: number, height: number): void;
}

/** Tiled window waiting for its first panel-resize before wayvnc starts. */
interface PendingWindow {
    outputName: string;
    vncPort: number;
    wsPort: number;
}

export class SwaySession implements vscode.Disposable {
    private sway: ChildProcess | null = null;
    private eventSub: ChildProcess | null = null;
    private virtualPointer: ChildProcess | null = null;
    private disposed = false;
    /** Sequential port offset — incremented for each new window. Instance field so
     *  multiple SwaySession instances (across extension host restarts) don't share state. */
    private nextPortOffset = 0;

    /** con_id → running stream state. */
    private readonly windows = new Map<number, WindowStream>();

    /** con_id → tiled windows awaiting their first panel-resize to start wayvnc. */
    private readonly pendingWindows = new Map<number, PendingWindow>();

    /** con_ids currently being promoted (async). Prevents double-promotion. */
    private readonly pending = new Set<number>();

    /** con_ids confirmed non-resizable (window didn't fill the panel-sized output). */
    private readonly nonResizable = new Set<number>();

    /** Pending bg colors received before stream started. */
    private readonly pendingBgColors = new Map<number, string>();

    constructor(
        private readonly log: vscode.LogOutputChannel,
        private readonly listener: SwaySessionListener,
    ) {}

    async start(): Promise<void> {
        await runSilent(`mkdir -p ${SWAY_RUNTIME_DIR}`);
        fs.writeFileSync(SWAY_CONFIG_PATH, SWAY_CONFIG);

        // Start a D-Bus session bus so Chrome file choosers, notifications, and
        // desktop portals work. Must run before Sway so all children inherit the address.
        const dbusAddress = await new Promise<string>((resolve) => {
            const dbus = spawn("dbus-daemon", ["--session", "--fork", "--print-address"], {
                stdio: ["ignore", "pipe", "ignore"],
            });
            let addr = "";
            dbus.stdout?.on("data", (d: Buffer) => { addr += d.toString(); });
            dbus.on("close", () => resolve(addr.trim()));
        });
        if (dbusAddress) {
            process.env.DBUS_SESSION_BUS_ADDRESS = dbusAddress;
            // Also export into the shell env file so terminals and apps launched
            // from the terminal inherit the same D-Bus address.
            fs.appendFileSync(DEPLOYERY_ENV_FILE, `export DBUS_SESSION_BUS_ADDRESS="${dbusAddress}"\n`);
            this.log.info(`D-Bus session started: ${dbusAddress}`);
        } else {
            this.log.warn("D-Bus session daemon failed to start");
        }

        // Reuse existing Sway if alive (E2B pause/resume preserves all processes).
        const existing = await this.findExistingSwaySocket();
        if (existing) {
            process.env.SWAYSOCK = existing.socketPath;
            process.env.XDG_RUNTIME_DIR = SWAY_RUNTIME_DIR;
            process.env.WAYLAND_DISPLAY = existing.waylandSocket;
            this.log.info(`Reusing Sway session: ${existing.socketPath}`);
            // Kill stale VNC/WS streams so the port range is free for clean reassignment.
            // Pattern 'websockify [7]' matches VNC bridges (args: "7500 localhost:7000")
            // but not the audio bridge (args: "0.0.0.0:8765 127.0.0.1:8766").
            await runSilent("pkill -x wayvnc; pkill -f 'websockify [7]'");
            await sleep(300);
            await this.detectXWaylandDisplay();
            await this.spawnVirtualPointer();
            // Subscribe before get_tree so any window events that fire while the
            // snapshot runs are captured rather than missed.
            this.subscribeToEvents();
            await this.reconstructWindowsFromTree();
            return;
        }

        this.sway = spawn("sway", ["--config", SWAY_CONFIG_PATH], {
            env: {
                ...process.env,
                WLR_BACKENDS: "headless",
                WLR_RENDERER: "pixman",
                WLR_LIBINPUT_NO_DEVICES: "1",
                LIBSEAT_BACKEND: "noop",
                XDG_RUNTIME_DIR: SWAY_RUNTIME_DIR,
                // Cursor theme: required for wayvnc's cursor-shape RFB events.
                // .bashrc exports aren't inherited by extension-spawned processes.
                XCURSOR_THEME: "transparent-cursor",
                XCURSOR_SIZE: "24",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });

        const stderrLines: string[] = [];
        this.sway.stderr?.on("data", (d: Buffer) => {
            const msg = d.toString().trim();
            if (!msg) return;
            this.log.trace(`[sway] ${msg}`);
            stderrLines.push(...msg.split("\n"));
            if (stderrLines.length > 50) stderrLines.splice(0, stderrLines.length - 50);
        });

        this.sway.on("exit", (code) => {
            this.log.warn(`Sway exited code=${code} disposed=${this.disposed}`);
        });

        try {
            await this.waitForSocket();
        } catch {
            const tail = stderrLines.slice(-10).join("\n");
            throw new Error(`Sway IPC socket did not appear in 10s\n${tail}`);
        }

        const files = fs.readdirSync(SWAY_RUNTIME_DIR);
        const swaySocket = files.find(f => f.startsWith("sway-ipc."));
        const waylandSocket = files.find(f => f.startsWith("wayland-"));

        if (!swaySocket || !waylandSocket) {
            throw new Error(`Sway sockets not found in ${SWAY_RUNTIME_DIR}: ${files.join(", ")}`);
        }

        process.env.SWAYSOCK = `${SWAY_RUNTIME_DIR}/${swaySocket}`;
        process.env.XDG_RUNTIME_DIR = SWAY_RUNTIME_DIR;
        process.env.WAYLAND_DISPLAY = waylandSocket;

        await this.detectXWaylandDisplay();

        this.log.info(`Sway compositor started (WAYLAND_DISPLAY=${waylandSocket})`);

        await this.spawnVirtualPointer();
        this.subscribeToEvents();
    }

    /**
     * Check if a Sway session from a previous extension run is still alive
     * (e.g. after E2B pause/resume which preserves all processes).
     */
    private async findExistingSwaySocket(): Promise<{ socketPath: string; waylandSocket: string } | null> {
        try {
            const files = fs.readdirSync(SWAY_RUNTIME_DIR);
            const swayFile = files.find(f => f.startsWith("sway-ipc."));
            const waylandFile = files.find(f => f.startsWith("wayland-"));
            if (!swayFile || !waylandFile) return null;
            const socketPath = `${SWAY_RUNTIME_DIR}/${swayFile}`;
            await run(`SWAYSOCK=${socketPath} swaymsg -t get_version`);
            return { socketPath, waylandSocket: waylandFile };
        } catch {
            return null;
        }
    }

    /**
     * After reattaching to an existing Sway session, rebuild the windows map by
     * walking get_tree and firing onWindowMapped for each app window found.
     * Ports are re-assigned from offset 0 — same order → same ports as before.
     *
     * Retries up to 3 times with a 1s delay when the tree is empty: after E2B
     * resume, Chrome (and other Wayland clients) may take a moment to re-register
     * their surfaces with the unfrozen Sway compositor before appearing in get_tree.
     */
    private async reconstructWindowsFromTree(): Promise<void> {
        let entries: Array<{ outputName: string; win: SwayNode }> = [];
        let tree: SwayNode | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const raw = await run("swaymsg -t get_tree -r");
            tree = JSON.parse(raw) as SwayNode;
            entries = collectWindowsWithOutput(tree);
            if (entries.length > 0 || attempt === 2) break;
            this.log.info(`get_tree returned 0 windows on attempt ${attempt}, retrying in 500ms`);
            await sleep(500);
            if (this.disposed) return;
        }
        // Log the tree structure to diagnose empty-tree cases (crash vs race).
        const outputSummary = (tree?.nodes ?? [])
            .filter(n => n.type === "output")
            .map(n => `${n.name}(${collectWindowsWithOutput(n).length}w)`)
            .join(", ");
        this.log.info(`Reconstructing ${entries.length} window(s) — outputs: [${outputSummary || "none"}]`);
        for (const { outputName, win } of entries) {
            if (this.disposed) return;
            const offset = this.nextPortOffset++;
            const vncPort = VNC_PORT_BASE + offset;
            const wsPort = WS_PORT_BASE + offset;
            const appId = win.app_id ?? win.window_properties?.class ?? "app";
            const title = win.name ?? appId;
            this.pendingWindows.set(win.id, { outputName, vncPort, wsPort });
            this.log.info(`Reconstructed: con_id=${win.id} output=${outputName} wsPort=${wsPort}`);
            this.listener.onWindowMapped(this, { conId: win.id, wsPort, title, appId });
        }
    }

    private async spawnVirtualPointer(): Promise<void> {
        // Kill any stale instance and wait for the kernel uinput device to be released
        // before creating a new one — otherwise the new instance may fail silently,
        // leaving the Wayland seat without pointer capability (clicks dropped).
        await runSilent("pkill -f virtual-pointer.py");
        await sleep(300);
        this.virtualPointer = spawn("python3", [VIRTUAL_POINTER_PATH], {
            env: { ...process.env, XDG_RUNTIME_DIR: SWAY_RUNTIME_DIR },
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.virtualPointer.stderr?.on("data", (d: Buffer) => {
            const text = d.toString().trim();
            if (text) this.log.warn(`[virtual-pointer] ${text}`);
        });
        this.virtualPointer.on("exit", (code) => {
            if (!this.disposed) this.log.warn(`virtual-pointer exited unexpectedly code=${code}`);
        });
        // Wait up to 2s for the device to register before proceeding.
        await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            this.virtualPointer!.stdout?.once("data", finish);
            this.virtualPointer!.once("exit", finish);
            setTimeout(finish, 2000);
        });
        this.log.info("Virtual pointer ready");
    }

    private async waitForSocket(): Promise<void> {
        for (let i = 0; i < 100; i++) {
            if (this.disposed) return;
            try {
                const files = fs.readdirSync(SWAY_RUNTIME_DIR);
                if (files.some(f => f.startsWith("sway-ipc."))) return;
            } catch { /* dir might not exist yet */ }
            await sleep(100);
        }
        throw new Error("timeout");
    }

    /**
     * Force XWayland to start (Sway starts it lazily) then capture the DISPLAY
     * it claimed so child processes spawned by the extension can find it.
     */
    private async detectXWaylandDisplay(): Promise<void> {
        const trigger = spawn("bash", ["-c", "DISPLAY=:0 xdpyinfo >/dev/null 2>&1"], {
            stdio: "ignore",
            detached: true,
        });
        trigger.unref();

        for (let i = 0; i < 25; i++) {
            try {
                const files = fs.readdirSync("/tmp/.X11-unix");
                const xSocket = files.find(f => /^X\d+$/.test(f));
                if (xSocket) {
                    process.env.DISPLAY = `:${xSocket.slice(1)}`;
                    this.log.info(`XWayland ready: DISPLAY=${process.env.DISPLAY}`);
                    return;
                }
            } catch { /* /tmp/.X11-unix not yet created */ }
            await sleep(200);
        }
        this.log.warn("XWayland did not start in 5s — X11 apps will not work");
    }

    // --- Sway IPC event subscription ---

    private subscribeToEvents(): void {
        this.log.info("Subscribing to sway window events");
        this.eventSub = spawn("swaymsg", ["-t", "subscribe", "-m", '["window"]'], {
            stdio: ["ignore", "pipe", "pipe"],
        });

        let buf = "";
        this.eventSub.stdout!.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
                if (line.trim()) this.handleEvent(line.trim());
            }
        });

        this.eventSub.stderr?.on("data", (d: Buffer) => {
            this.log.warn(`[sway-sub] ${d.toString().trim()}`);
        });

        this.eventSub.on("exit", (code) => {
            if (!this.disposed) {
                this.log.warn(`Sway event subscription exited (${code}), restarting in 1s`);
                setTimeout(() => this.subscribeToEvents(), 1000);
            }
        });
    }

    private handleEvent(json: string): void {
        let event: SwayWindowEvent;
        try { event = JSON.parse(json) as SwayWindowEvent; } catch {
            this.log.warn(`Sway event parse error: ${json.slice(0, 200)}`);
            return;
        }

        const container = event.container;
        if (!container) return;

        const { change } = event;
        this.log.trace(`Sway window event: change="${change}" con_id=${container.id} type="${container.type}" app_id="${container.app_id ?? container.window_properties?.class ?? ""}" floating="${container.floating}" title="${container.name ?? ""}"`);

        switch (change) {
            case "new":
                this.handleNewWindow(container).catch(e =>
                    this.log.error(`Window new error: ${e}`)
                );
                break;
            case "close":
                this.handleWindowClose(container);
                break;
            case "move":
            case "resize":
                this.handleWindowGeometryChange(container);
                break;
        }
    }

    // --- Window lifecycle ---

    private async handleNewWindow(container: SwayNode): Promise<void> {
        const conId: number = container.id;
        if (this.windows.has(conId) || this.pending.has(conId) || this.disposed) return;

        const appId: string = container.app_id ?? container.window_properties?.class ?? "app";
        const title: string = container.name ?? appId;
        const pid: number = container.pid ?? 0;

        this.pending.add(conId);
        this.log.info(`New window: con_id=${conId} pid=${pid} app_id="${appId}" title="${title}"`);

        try {
            await this.promoteWindow(conId, appId, title);
        } catch (e) {
            this.log.error(`Promote failed con_id=${conId}: ${e}`);
        } finally {
            this.pending.delete(conId);
        }
    }

    private async promoteWindow(conId: number, appId: string, title: string): Promise<void> {
        // Snapshot current outputs, create a new one, diff to find its name.
        const beforeJson = await run("swaymsg -t get_outputs -r");
        const before: string[] = (JSON.parse(beforeJson) as SwayOutput[]).map(o => o.name);

        await run("swaymsg create_output");
        await sleep(50);

        const afterJson = await run("swaymsg -t get_outputs -r");
        const after: string[] = (JSON.parse(afterJson) as SwayOutput[]).map(o => o.name);
        const newOutputs = after.filter(n => !before.includes(n));

        if (newOutputs.length === 0) {
            this.log.error(`create_output produced no new output`);
            return;
        }
        const outputName = newOutputs[0];
        if (this.disposed) return;

        // scale=1 guard: prevents wlroots headless from inheriting a non-1 scale that
        // causes apps to render at a larger logical size and clip on the right.
        await run(`swaymsg output ${outputName} scale 1`);
        await run(`swaymsg '[con_id=${conId}] border none'`);
        await run(`swaymsg '[con_id=${conId}] move container to output ${outputName}'`);
        // Anchor floating windows to the output origin so wayvnc captures them.
        // Tiled windows ignore this command.
        await runSilent(`swaymsg '[con_id=${conId}] move position 0 0'`);

        const offset = this.nextPortOffset++;
        const vncPort = VNC_PORT_BASE + offset;
        const wsPort = WS_PORT_BASE + offset;

        // All windows start via pendingWindows — panel-resize drives output size.
        // After stream starts, we check if the window actually filled the output.
        // If not (non-resizable dialog/tool), we correct the output size then.
        await this.logOutputInfo(outputName);
        await this.logWindowGeometry(conId);
        if (this.disposed) return;
        this.pendingWindows.set(conId, { outputName, vncPort, wsPort });
        this.log.info(`Window pending: con_id=${conId} output=${outputName} wsPort=${wsPort} — awaiting first panel-resize`);
        this.listener.onWindowMapped(this, { conId, wsPort, title, appId });
    }

    /** Start wayvnc + websockify for a window at the given output size. */
    private async startStream(conId: number, outputName: string, vncPort: number, wsPort: number, width = 0, height = 0): Promise<void> {
        // --render-cursor: wayvnc captures the cursor as a separate Wayland surface and
        // sends it to noVNC via RFB cursor-shape pseudo-encoding. noVNC renders the cursor
        // client-side with zero lag. Combined with `seat * hide_cursor 1` in the Sway
        // config, the cursor is hidden from the compositor output so it is never baked
        // into screencopy frames — eliminating the lagging second cursor.
        // No --render-cursor: that flag bakes the cursor into screencopy frames (lagged).
        // wayvnc's cursor_sc path captures cursor shapes separately and sends them via
        // RFB encoding -239 (CursorImage), which noVNC renders client-side at pointer
        // rate — zero lag. seat * hide_cursor 1 keeps the cursor out of video frames.
        const wayvnc = spawn("wayvnc", [
            "-o", outputName,
            "-f", "60",
            "-S", `/tmp/wayvnc-ctl-${vncPort}`,  // unique ctl socket per instance — avoids "already running" error
            "0.0.0.0", String(vncPort),
        ], { stdio: ["ignore", "pipe", "pipe"] });

        wayvnc.stderr?.on("data", (d: Buffer) => {
            const text = d.toString().trim();
            if (!text) return;
            if (text.includes("ERROR") || text.includes("Failed") || text.includes("error")) {
                this.log.warn(`[wayvnc:${conId}] ${text}`);
            } else {
                this.log.trace(`[wayvnc:${conId}] ${text}`);
            }
        });

        wayvnc.on("exit", (code) => {
            this.log.info(`wayvnc exited: con_id=${conId} output=${outputName} code=${code}`);
            if (this.disposed || !this.windows.has(conId)) return;
            this.windows.delete(conId);
            this.listener.onWindowClosed(this, conId);
            runSilent(`swaymsg output ${outputName} disable`);
        });

        await this.waitForPort(vncPort);
        if (this.disposed) { wayvnc.kill("SIGTERM"); return; }

        const websockify = spawn("websockify", [
            String(wsPort), `localhost:${vncPort}`,
        ], { stdio: "ignore" });

        websockify.on("exit", (code) => {
            this.log.info(`websockify exited: con_id=${conId} code=${code}`);
        });

        await this.waitForPort(wsPort);
        if (this.disposed) {
            wayvnc.kill("SIGTERM");
            websockify.kill("SIGTERM");
            return;
        }

        if (wayvnc.exitCode !== null) {
            this.log.warn(`wayvnc already exited during stream start — skipping panel`);
            websockify.kill("SIGTERM");
            return;
        }

        this.windows.set(conId, { outputName, wayvnc, websockify, vncPort, wsPort, width, height });
        this.log.info(`Stream started: con_id=${conId} output=${outputName} vncPort=${vncPort} wsPort=${wsPort}`);

        const pendingColor = this.pendingBgColors.get(conId);
        if (pendingColor) {
            this.pendingBgColors.delete(conId);
            this.log.info(`bg-color applied (deferred): output=${outputName} color="${pendingColor}"`);
            runSilent(`swaymsg output ${outputName} bg "${pendingColor}" solid_color`);
        }

        // Force a screencopy damage event so wayvnc delivers the first frame immediately.
        // Static apps that haven't redrawn since pause produce no damage, leaving the
        // canvas blank even after noVNC connects. A 1px mode nudge triggers wlroots damage.
        if (width > 0 && height > 0) {
            (async () => {
                await sleep(100);
                await runSilent(`swaymsg output ${outputName} mode ${width}x${height - 1}`);
                await sleep(50);
                await runSilent(`swaymsg output ${outputName} mode ${width}x${height}`);
            })();
        }
    }

    private handleWindowClose(container: SwayNode): void {
        const conId: number = container.id;

        const pending = this.pendingWindows.get(conId);
        if (pending) {
            this.log.info(`Pending window closed before stream started: con_id=${conId}`);
            this.pendingWindows.delete(conId);
            this.nonResizable.delete(conId);
            this.listener.onWindowClosed(this, conId);
            runSilent(`swaymsg output ${pending.outputName} disable`);
            return;
        }

        const state = this.windows.get(conId);
        if (!state) return;

        this.log.info(`Window closed: con_id=${conId} output=${state.outputName}`);
        this.cleanupWindow(conId, state);
    }

    /** Handle move/resize events — re-sync output to window size for all windows. */
    private handleWindowGeometryChange(container: SwayNode): void {
        const conId = container.id;
        const state = this.windows.get(conId);
        if (!state || this.disposed) return;

        // Re-anchor floating windows to output origin (tiled windows ignore this).
        runSilent(`swaymsg '[con_id=${conId}] move position 0 0'`);

        // Read actual surface size from event (window_rect = committed buffer size).
        const wr = container.window_rect;
        const w = (wr && wr.width > 0) ? wr.width : container.rect?.width;
        const h = (wr && wr.height > 0) ? wr.height : container.rect?.height;
        if (!w || !h || (w === state.width && h === state.height)) return;

        this.log.info(`Window geometry changed: con_id=${conId} ${state.width}x${state.height} -> ${w}x${h}`);
        state.width = w;
        state.height = h;
        run(`swaymsg output ${state.outputName} mode ${w}x${h}`).catch(e =>
            this.log.warn(`Output sync failed con_id=${conId}: ${e}`)
        );
        // Notify webview of new size for non-resizable windows (centered display).
        if (this.nonResizable.has(conId)) {
            this.listener.onWindowNonResizable(this, conId, w, h);
        }
    }

    private cleanupWindow(conId: number, state: WindowStream): void {
        state.wayvnc.kill("SIGTERM");
        state.websockify.kill("SIGTERM");
        this.windows.delete(conId);
        this.nonResizable.delete(conId);
        this.pendingBgColors.delete(conId);
        this.listener.onWindowClosed(this, conId);
        runSilent(`swaymsg output ${state.outputName} disable`);
    }

    // --- Public API for DesktopManager ---

    async resizeWindow(conId: number, width: number, height: number): Promise<void> {
        if (this.disposed) return;

        const pending = this.pendingWindows.get(conId);
        if (pending) {
            // Panel → output (only Sway lever) → window fills if resizable.
            // Check window actual size before starting stream — swaymsg is synchronous so
            // the window has already settled. If it didn't fill, correct output first so
            // wayvnc starts exactly once at the right size (output = window always).
            this.pendingWindows.delete(conId);
            this.log.info(`First resize: con_id=${conId} output=${pending.outputName} → ${width}x${height}`);
            await run(`swaymsg output ${pending.outputName} mode ${width}x${height}`);
            await this.logOutputInfo(pending.outputName);

            let streamW = width;
            let streamH = height;
            const winState = await this.getWindowState(conId);
            if (winState && winState.width > 0 && winState.height > 0) {
                const match = winState.width === width && winState.height === height;
                this.log.info(`Window state: con_id=${conId} → ${winState.width}x${winState.height} (${match ? "matches output" : "correcting output"})`);
                if (!match) {
                    streamW = winState.width;
                    streamH = winState.height;
                    await run(`swaymsg output ${pending.outputName} mode ${streamW}x${streamH}`);
                    this.nonResizable.add(conId);
                    if (!this.disposed) this.listener.onWindowNonResizable(this, conId, streamW, streamH);
                }
            } else {
                this.log.warn(`Window state: con_id=${conId} → null, starting at panel size`);
            }
            await this.startStream(conId, pending.outputName, pending.vncPort, pending.wsPort, streamW, streamH);
            return;
        }

        const state = this.windows.get(conId);
        if (!state) return;
        // Non-resizable windows keep their natural size — ignore resize requests.
        if (this.nonResizable.has(conId)) return;
        // Skip if dimensions unchanged — avoids restart loop when noVNC re-sends size on connect.
        if (state.width === width && state.height === height) return;
        this.log.info(`Resize: con_id=${conId} output=${state.outputName} → ${width}x${height}`);
        state.width = width;
        state.height = height;

        // Just resize the output — neatvnc 0.9.x sends RFB DesktopSize (encoding -308)
        // on output mode changes, so noVNC adapts without a reconnect.
        await run(`swaymsg output ${state.outputName} mode ${width}x${height}`);
        await this.logOutputInfo(state.outputName);
        await this.logWindowGeometry(conId);
    }

    setOutputBackground(conId: number, color: string): void {
        const state = this.windows.get(conId);
        if (!state) {
            this.log.info(`bg-color queued for con_id=${conId}: "${color}" (stream not yet started)`);
            this.pendingBgColors.set(conId, color);
            return;
        }
        this.log.info(`bg-color applied: output=${state.outputName} color="${color}"`);
        runSilent(`swaymsg output ${state.outputName} bg "${color}" solid_color`);
    }

    async killWindow(conId: number): Promise<void> {
        this.pendingWindows.delete(conId);
        await runSilent(`swaymsg '[con_id=${conId}] kill'`);
    }

    // --- Diagnostics ---

    private async logOutputInfo(outputName: string): Promise<void> {
        try {
            const raw = await runSilent("swaymsg -t get_outputs -r");
            const outputs = JSON.parse(raw) as SwayOutput[];
            const o = outputs.find(x => x.name === outputName);
            if (!o) {
                this.log.warn(`logOutputInfo: output "${outputName}" not found`);
                return;
            }
            const mode = o.current_mode
                ? `${o.current_mode.width}x${o.current_mode.height}@${o.current_mode.refresh}`
                : "none";
            this.log.info(
                `Output ${outputName}: mode=${mode} scale=${o.scale} ` +
                `pos=${o.rect?.x},${o.rect?.y} active=${o.active} power=${o.dpms}`
            );
        } catch (e) {
            this.log.warn(`logOutputInfo failed: ${e}`);
        }
    }

    private async logWindowGeometry(conId: number): Promise<void> {
        try {
            const raw = await runSilent("swaymsg -t get_tree -r");
            const node = findNodeById(JSON.parse(raw) as SwayNode, conId);
            if (!node) {
                this.log.warn(`logWindowGeometry: con_id=${conId} not found in tree`);
                return;
            }
            this.log.info(
                `Window geometry con_id=${conId}: ` +
                `rect=${node.rect?.x},${node.rect?.y} ${node.rect?.width}x${node.rect?.height} ` +
                `window_rect=${node.window_rect?.width}x${node.window_rect?.height} ` +
                `type="${node.type}" floating=${node.floating ?? false} ` +
                `fullscreen=${node.fullscreen_mode ?? 0}`
            );
        } catch (e) {
            this.log.warn(`logWindowGeometry failed: ${e}`);
        }
    }

    private async getWindowState(conId: number): Promise<{ width: number; height: number } | null> {
        try {
            const raw = await runSilent("swaymsg -t get_tree -r");
            const node = findNodeById(JSON.parse(raw) as SwayNode, conId);
            if (!node) return null;
            // window_rect is the actual surface committed by the client within the container.
            // rect is the container size (= output size for tiled windows).
            // Prefer window_rect — catches dialogs that commit a smaller buffer than their container.
            const wr = node.window_rect;
            const w = (wr && wr.width > 0) ? wr.width : node.rect?.width;
            const h = (wr && wr.height > 0) ? wr.height : node.rect?.height;
            if (!w || !h) return null;
            return { width: w, height: h };
        } catch {
            return null;
        }
    }

    // --- Helpers ---

    private async waitForPort(port: number): Promise<void> {
        for (let i = 0; i < 40; i++) {
            if (this.disposed) return;
            try {
                await run(`bash -c 'echo > /dev/tcp/127.0.0.1/${port}' 2>/dev/null`);
                return;
            } catch {
                await sleep(100);
            }
        }
        this.log.warn(`Port ${port} did not become ready in 4s`);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.log.info("Disposing Sway session");
        this.eventSub?.kill();
        this.virtualPointer?.kill("SIGTERM");
        this.pendingWindows.clear();
        for (const [conId, state] of this.windows) {
            this.log.info(`Killing window con_id=${conId}`);
            state.wayvnc.kill("SIGTERM");
            state.websockify.kill("SIGTERM");
        }
        this.windows.clear();
        this.sway?.kill("SIGTERM");
    }
}
