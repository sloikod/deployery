const cfg = JSON.parse(document.getElementById("cfg").textContent);
const { default: RFB } = await import(cfg.rfbUri);
const vscode = acquireVsCodeApi();
vscode.setState({ conId: cfg.conId, wsPort: cfg.wsPort, title: cfg.title });

const log = (msg) => vscode.postMessage({ type: "log", text: msg });
const statusEl = document.getElementById("status");
const screen = document.getElementById("screen");
log(
  `webview init: viewport=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
);
statusEl.textContent = "Waiting for window stream...";

function resolveWebSocketUrl(proxyTarget) {
  const url =
    proxyTarget.startsWith("http://") || proxyTarget.startsWith("https://")
      ? new URL(proxyTarget)
      : new URL(proxyTarget, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function applyBgColor() {
  const color = getComputedStyle(document.body)
    .getPropertyValue("--vscode-editor-background")
    .trim();
  if (!color) return;
  screen.style.background = color;
  vscode.postMessage({ type: "bg-color", color });
}

applyBgColor();
const themeObserver = new MutationObserver(applyBgColor);
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["style", "class"],
});
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});

let rfb = null;
let retryDelay = 1000;
let isNonResizable = false;

function connect(proxyTarget = cfg.vncProxyUri) {
  cfg.vncProxyUri = proxyTarget;
  const wsUrl = resolveWebSocketUrl(proxyTarget);
  if (rfb) {
    try {
      rfb.disconnect();
    } catch (_) {}
    rfb = null;
  }
  screen.innerHTML = "";
  statusEl.textContent = "Connecting to window stream...";
  rfb = new RFB(screen, wsUrl);
  rfb.scaleViewport = false;
  rfb.resizeSession = false;
  rfb.background = "transparent";
  rfb.qualityLevel = 9;
  rfb.showDotCursor = true;

  rfb.addEventListener("connect", () => {
    retryDelay = 1000;
    statusEl.style.display = "none";
    const width = Math.floor(screen.clientWidth);
    const height = Math.floor(screen.clientHeight);
    log(
      `connected: container=${width}x${height} dpr=${window.devicePixelRatio}`,
    );
    if (!isNonResizable && width > 0 && height > 0) {
      vscode.postMessage({ type: "panel-resize", width, height });
    }
  });

  rfb.addEventListener("disconnect", ({ detail }) => {
    log(`disconnected: clean=${detail?.clean} retryIn=${retryDelay}ms`);
    statusEl.style.display = "flex";
    statusEl.textContent = "Reconnecting to window stream...";
    retryDelay = Math.min(retryDelay * 2, 8000);
    setTimeout(() => connect(cfg.vncProxyUri), retryDelay);
  });

  rfb.addEventListener("desktopname", ({ detail }) =>
    log(`desktop name: "${detail?.name}"`),
  );
  rfb.addEventListener("desktopsize", () => {
    const canvas = screen.querySelector("canvas");
    log(
      `desktopsize: ${screen.clientWidth}x${screen.clientHeight} canvas=${canvas?.offsetWidth}x${canvas?.offsetHeight}`,
    );
  });
}

let resizeTimer;
let firstResize = true;
const resizeObserver = new ResizeObserver((entries) => {
  const { width, height } = entries[0].contentRect;
  const roundedWidth = Math.floor(width);
  const roundedHeight = Math.floor(height);
  if (isNonResizable || roundedWidth <= 0 || roundedHeight <= 0) return;
  if (firstResize) {
    firstResize = false;
    vscode.postMessage({
      type: "panel-resize",
      width: roundedWidth,
      height: roundedHeight,
    });
    return;
  }
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    vscode.postMessage({
      type: "panel-resize",
      width: roundedWidth,
      height: roundedHeight,
    });
  }, 100);
});
resizeObserver.observe(screen);

let audioRunning = false;
let audioCtx = null;
let audioWs = null;
let audioRemainder = new Uint8Array(0);

function concatUint8Arrays(left, right) {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function startAudio() {
  stopAudio();
  audioCtx = new AudioContext({ latencyHint: "interactive" });
  audioRunning = true;
  audioRemainder = new Uint8Array(0);
  let audioRetryDelay = 1000;

  function connectAudio() {
    if (!audioRunning) return;
    let nextTime = 0;
    const ws = new WebSocket(resolveWebSocketUrl(cfg.audioProxyUri));
    ws.binaryType = "arraybuffer";
    audioWs = ws;

    ws.onopen = () => {
      audioRetryDelay = 1000;
    };

    ws.onmessage = ({ data }) => {
      if (!(data instanceof ArrayBuffer)) {
        log(
          `audio: ignoring non-binary websocket message of type ${typeof data}`,
        );
        return;
      }

      const incoming = new Uint8Array(data);
      const bytes =
        audioRemainder.length > 0
          ? concatUint8Arrays(audioRemainder, incoming)
          : incoming;
      const alignedLength = bytes.length - (bytes.length % 2);

      if (alignedLength === 0) {
        audioRemainder = bytes;
        return;
      }

      audioRemainder =
        alignedLength === bytes.length
          ? new Uint8Array(0)
          : bytes.slice(alignedLength);

      try {
        const pcm = new Int16Array(
          bytes.buffer,
          bytes.byteOffset,
          alignedLength / 2,
        );
        const buffer = audioCtx.createBuffer(1, pcm.length, cfg.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let index = 0; index < pcm.length; index += 1) {
          channel[index] = pcm[index] / 32768;
        }
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        if (nextTime < now + 0.005) nextTime = now + 0.02;
        source.start(nextTime);
        nextTime += buffer.duration;
      } catch (error) {
        log(
          `audio decode error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    ws.onclose = () => {
      if (!audioRunning) return;
      audioRetryDelay = Math.min(audioRetryDelay * 2, 8000);
      setTimeout(connectAudio, audioRetryDelay);
    };

    ws.onerror = () => ws.close();
  }

  connectAudio();
}

function stopAudio() {
  if (audioWs) {
    audioWs.onclose = null;
    audioWs.close();
    audioWs = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  audioRemainder = new Uint8Array(0);
  audioRunning = false;
}

if (cfg.audioEnabled) {
  startAudio();
}

window.addEventListener("message", ({ data }) => {
  switch (data?.type) {
    case "toggle-audio":
      audioRunning ? stopAudio() : startAudio();
      break;
    case "set-non-resizable":
      isNonResizable = true;
      screen.style.width = `${data.width}px`;
      screen.style.height = `${data.height}px`;
      document.body.style.cssText =
        "display:flex;align-items:center;justify-content:center";
      break;
    case "reconnect":
      vscode.setState({
        conId: cfg.conId,
        wsPort: data.wsPort,
        title: cfg.title,
      });
      cfg.vncProxyUri = data.vncProxyUri;
      connect(data.vncProxyUri);
      break;
  }
});

connect();
