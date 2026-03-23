const cfg = JSON.parse(document.getElementById('cfg').textContent);
const { default: RFB } = await import(cfg.rfbUri);
const vscode = acquireVsCodeApi();
vscode.setState({ conId: cfg.conId, wsPort: cfg.wsPort, title: cfg.title });

const log = (msg) => vscode.postMessage({ type: 'log', text: msg });
const statusEl = document.getElementById('status');
const screen = document.getElementById('screen');
log(`webview init: viewport=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`);

function resolveWebSocketUrl(proxyPath) {
    const url = new URL(proxyPath, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
}

function applyBgColor() {
    const color = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    if (!color) return;
    screen.style.background = color;
    vscode.postMessage({ type: 'bg-color', color });
}

applyBgColor();
const themeObserver = new MutationObserver(applyBgColor);
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

let rfb = null;
let retryDelay = 1000;
let isNonResizable = false;

function connect(proxyPath = cfg.vncProxyPath) {
    cfg.vncProxyPath = proxyPath;
    if (rfb) {
        try {
            rfb.disconnect();
        } catch (_) {
        }
        rfb = null;
    }
    screen.innerHTML = '';
    rfb = new RFB(screen, resolveWebSocketUrl(proxyPath));
    rfb.scaleViewport = false;
    rfb.resizeSession = false;
    rfb.background = 'transparent';
    rfb.qualityLevel = 9;
    rfb.showDotCursor = true;

    rfb.addEventListener('connect', () => {
        retryDelay = 1000;
        statusEl.style.display = 'none';
        const width = Math.floor(screen.clientWidth);
        const height = Math.floor(screen.clientHeight);
        log(`connected: container=${width}x${height} dpr=${window.devicePixelRatio}`);
        if (!isNonResizable && width > 0 && height > 0) {
            vscode.postMessage({ type: 'panel-resize', width, height });
        }
    });

    rfb.addEventListener('disconnect', ({ detail }) => {
        log(`disconnected: clean=${detail?.clean} retryIn=${retryDelay}ms`);
        statusEl.style.display = 'flex';
        retryDelay = Math.min(retryDelay * 2, 8000);
        setTimeout(() => connect(cfg.vncProxyPath), retryDelay);
    });

    rfb.addEventListener('desktopname', ({ detail }) => log(`desktop name: "${detail?.name}"`));
    rfb.addEventListener('desktopsize', () => {
        const canvas = screen.querySelector('canvas');
        log(`desktopsize: ${screen.clientWidth}x${screen.clientHeight} canvas=${canvas?.offsetWidth}x${canvas?.offsetHeight}`);
    });
}

connect();

let resizeTimer;
let firstResize = true;
const resizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    const roundedWidth = Math.floor(width);
    const roundedHeight = Math.floor(height);
    if (isNonResizable || roundedWidth <= 0 || roundedHeight <= 0) return;
    if (firstResize) {
        firstResize = false;
        vscode.postMessage({ type: 'panel-resize', width: roundedWidth, height: roundedHeight });
        return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        vscode.postMessage({ type: 'panel-resize', width: roundedWidth, height: roundedHeight });
    }, 100);
});
resizeObserver.observe(screen);

let audioRunning = false;
let audioCtx = null;
let audioWs = null;

function startAudio() {
    stopAudio();
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
    audioRunning = true;
    let audioRetryDelay = 1000;

    function connectAudio() {
        if (!audioRunning) return;
        let nextTime = 0;
        const ws = new WebSocket(resolveWebSocketUrl(cfg.audioProxyPath));
        ws.binaryType = 'arraybuffer';
        audioWs = ws;

        ws.onopen = () => {
            audioRetryDelay = 1000;
        };

        ws.onmessage = ({ data }) => {
            const pcm = new Int16Array(data);
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
    audioRunning = false;
}

if (cfg.audioEnabled) {
    startAudio();
}

window.addEventListener('message', ({ data }) => {
    switch (data?.type) {
        case 'toggle-audio':
            audioRunning ? stopAudio() : startAudio();
            break;
        case 'set-non-resizable':
            isNonResizable = true;
            screen.style.width = `${data.width}px`;
            screen.style.height = `${data.height}px`;
            document.body.style.cssText = 'display:flex;align-items:center;justify-content:center';
            break;
        case 'reconnect':
            vscode.setState({ conId: cfg.conId, wsPort: data.wsPort, title: cfg.title });
            connect(data.vncProxyPath);
            break;
    }
});
