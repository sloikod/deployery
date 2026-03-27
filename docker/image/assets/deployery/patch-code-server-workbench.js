const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootfs = process.env.DEPLOYERY_CODE_SERVER_ROOTFS || "";
const searchRoot = path.join(rootfs, "/usr/lib/code-server");
const brandName = "Deployery";
const patchStartMarker = "<!-- deployery-workbench-patch:start -->";
const patchEndMarker = "<!-- deployery-workbench-patch:end -->";
const replacementRules = [
  [/^code-server$/i, brandName],
  [/^welcome to code-server$/i, `Welcome to ${brandName}`],
  [/^sign out of code-server$/i, `Sign out of ${brandName}`],
  [/^code-server:\s*/i, `${brandName}: `],
  [/\bcode-server\b/g, brandName],
];

function findWorkbenchHtml() {
  const cmd = `find ${JSON.stringify(searchRoot)} -name "workbench.html" | grep "/browser/" | head -1`;
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function buildInjection() {
  return [
    patchStartMarker,
    "<script>",
    "(function () {",
    "  const css = '.editor-group-watermark,.letterpress{display:none!important;}';",
    '  const style = document.createElement("style");',
    "  style.textContent = css;",
    "  document.head.appendChild(style);",
    "",
    `  const brandName = ${JSON.stringify(brandName)};`,
    `  const replacementRules = ${JSON.stringify(replacementRules.map(([pattern, replacement]) => ({ source: pattern.source, flags: pattern.flags, replacement })))}`,
    "    .map((rule) => ({ regex: new RegExp(rule.source, rule.flags), replacement: rule.replacement }));",
    "",
    "  function normalizeInstalledHeaders(root) {",
    "    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);",
    "    let node;",
    "    while ((node = walker.nextNode())) {",
    "      const trimmed = node.textContent?.trim();",
    "      if (!trimmed || !/\\S+:\\d+\\s+-\\s+INSTALLED$/i.test(trimmed)) continue;",
    "      node.textContent = trimmed.replace(/\\S+:\\d+\\s+-\\s+/i, '');",
    "    }",
    "  }",
    "",
    "  function brandText(root) {",
    "    const elements = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [];",
    "    for (const element of elements) {",
    "      if (!(element instanceof HTMLElement)) continue;",
    "      const title = element.getAttribute('title');",
    "      if (title && /code-server/i.test(title)) {",
    "        element.setAttribute('title', title.replace(/code-server/gi, brandName));",
    "      }",
    "      const ariaLabel = element.getAttribute('aria-label');",
    "      if (ariaLabel && /code-server/i.test(ariaLabel)) {",
    "        element.setAttribute('aria-label', ariaLabel.replace(/code-server/gi, brandName));",
    "      }",
    "      if (element.children.length > 0) continue;",
    "      const original = element.textContent;",
    "      if (!original || !original.trim()) continue;",
    "      let next = original;",
    "      for (const rule of replacementRules) {",
    "        next = next.replace(rule.regex, rule.replacement);",
    "      }",
    "      if (next !== original) {",
    "        element.textContent = next;",
    "      }",
    "    }",
    "  }",
    "",
    "  const run = () => normalizeInstalledHeaders(document.body);",
    "  const brand = () => brandText(document.body);",
    "  const sandboxOpenEndpoint = new URL('/api/v1/open-external', window.location.href).toString();",
    "  const nativeWindowOpen = window.open.bind(window);",
    "",
    "  function parseHttpUrl(value) {",
    "    if (typeof value !== 'string' || !value.trim()) return null;",
    "    try {",
    "      const resolved = new URL(value, window.location.href);",
    "      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;",
    "      return resolved;",
    "    } catch {",
    "      return null;",
    "    }",
    "  }",
    "",
    "  function isLoopbackHost(hostname) {",
    "    const normalized = String(hostname || '').trim().toLowerCase();",
    "    return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.startsWith('127.') || normalized === '::1' || normalized === '[::1]' || normalized === '0.0.0.0';",
    "  }",
    "",
    "  function hasLoopbackCallback(url) {",
    "    const callbackParamNames = ['redirect_uri', 'redirect_url', 'redirectUrl', 'callback', 'callback_url', 'callbackUrl'];",
    "    for (const key of callbackParamNames) {",
    "      const value = url.searchParams.get(key);",
    "      if (!value) continue;",
    "      const parsed = parseHttpUrl(value);",
    "      if (parsed && isLoopbackHost(parsed.hostname)) return true;",
    "    }",
    "    return false;",
    "  }",
    "",
    "  function shouldOpenInSandbox(value) {",
    "    const parsed = parseHttpUrl(value);",
    "    if (!parsed) return null;",
    "    if (parsed.hash && parsed.origin === window.location.origin && parsed.pathname === window.location.pathname && parsed.search === window.location.search) return null;",
    "    if (isLoopbackHost(parsed.hostname) || hasLoopbackCallback(parsed)) return parsed.toString();",
    "    return null;",
    "  }",
    "",
    "  function openInSandboxBrowser(href) {",
    "    const normalized = shouldOpenInSandbox(href);",
    "    if (!normalized) return false;",
    "    void fetch(sandboxOpenEndpoint, {",
    "      method: 'POST',",
    "      headers: { 'content-type': 'application/json' },",
    "      credentials: 'same-origin',",
    "      keepalive: true,",
    "      body: JSON.stringify({ url: normalized }),",
    "    }).then((response) => {",
    "      if (!response.ok) {",
    "        console.warn('deployery: sandbox browser open failed', response.status, normalized);",
    "      }",
    "    }).catch((error) => {",
    "      console.warn('deployery: failed to open external URL in sandbox', error);",
    "    });",
    "    return true;",
    "  }",
    "",
    "  function createWindowProxy(initialHref) {",
    "    const state = { closed: false, href: initialHref || '' };",
    "    return {",
    "      get closed() { return state.closed; },",
    "      set closed(value) { state.closed = !!value; },",
    "      close() { state.closed = true; },",
    "      focus() {},",
    "      blur() {},",
    "      opener: null,",
    "      location: {",
    "        get href() { return state.href; },",
    "        set href(value) {",
    "          state.href = String(value);",
    "          if (!openInSandboxBrowser(state.href)) nativeWindowOpen(state.href, '_blank');",
    "        },",
    "        assign(value) { this.href = value; },",
    "        replace(value) { this.href = value; },",
    "      },",
    "    };",
    "  }",
    "",
    "  window.open = function (url, target, features) {",
    "    if (typeof url === 'undefined' || url === null || url === '') {",
    "      return createWindowProxy('');",
    "    }",
    "    const href = String(url);",
    "    if (openInSandboxBrowser(href)) {",
    "      return createWindowProxy(href);",
    "    }",
    "    return nativeWindowOpen(url, target, features);",
    "  };",
    "",
    "  function findAnchor(event) {",
    "    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];",
    "    for (const entry of path) {",
    "      if (entry instanceof HTMLAnchorElement && entry.href) return entry;",
    "    }",
    "    return event.target instanceof Element ? event.target.closest('a[href]') : null;",
    "  }",
    "",
    "  function shouldHijackAnchor(anchor, event) {",
    "    if (!(anchor instanceof HTMLAnchorElement) || !anchor.href || anchor.hasAttribute('download')) return false;",
    "    if (!shouldOpenInSandbox(anchor.href)) return false;",
    "    if (anchor.target && anchor.target !== '_self') return true;",
    "    if (event.ctrlKey || event.metaKey || event.shiftKey) return true;",
    "    return event.button === 1 || event.button === 0;",
    "  }",
    "",
    "  function handleAnchorOpen(event) {",
    "    const anchor = findAnchor(event);",
    "    if (!shouldHijackAnchor(anchor, event)) return;",
    "    event.preventDefault();",
    "    event.stopPropagation();",
    "    openInSandboxBrowser(anchor.href);",
    "  }",
    "",
    "  document.addEventListener('click', handleAnchorOpen, true);",
    "  document.addEventListener('auxclick', handleAnchorOpen, true);",
    "  if (document.readyState === 'loading') {",
    "    document.addEventListener('DOMContentLoaded', () => { run(); brand(); }, { once: true });",
    "  } else {",
    "    run();",
    "    brand();",
    "  }",
    "",
    "  const observer = new MutationObserver((mutations) => {",
    "    for (const mutation of mutations) {",
    "      if (mutation.type === 'characterData') {",
    "        const el = mutation.target.parentElement;",
    "        if (el) { normalizeInstalledHeaders(el); brandText(el); }",
    "      } else if (mutation.type === 'attributes') {",
    "        if (mutation.target.nodeType === Node.ELEMENT_NODE) brandText(mutation.target);",
    "      } else {",
    "        for (const node of mutation.addedNodes) {",
    "          if (node.nodeType === Node.ELEMENT_NODE) {",
    "            normalizeInstalledHeaders(node);",
    "            brandText(node);",
    "          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {",
    "            normalizeInstalledHeaders(node.parentElement);",
    "            brandText(node.parentElement);",
    "          }",
    "        }",
    "      }",
    "    }",
    "  });",
    "  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label'] });",
    "})();",
    "</script>",
    patchEndMarker,
    "</head>",
  ].join("\n");
}

function upsertInjection(html, injection) {
  const markerPattern = new RegExp(
    `${patchStartMarker}[\\s\\S]*?${patchEndMarker}\\s*`,
  );
  const legacyPattern =
    /<script>\s*\(function \(\) \{[\s\S]*?function normalizeInstalledHeaders\(root\) \{[\s\S]*?function brandText\(root\) \{[\s\S]*?new MutationObserver\(\(mutations\) => \{[\s\S]*?\}\)\.observe\(document\.documentElement, \{ childList: true, subtree: true, characterData: true \}\);\s*\}\)\(\);\s*<\/script>\s*/;

  let nextHtml = html.replace(markerPattern, "");
  nextHtml = nextHtml.replace(legacyPattern, "");

  if (!nextHtml.includes("</head>")) {
    throw new Error("patch-code-server-workbench: </head> not found");
  }

  return nextHtml.replace("</head>", injection);
}

function main() {
  const workbenchHtml = findWorkbenchHtml();
  if (!workbenchHtml) {
    console.error("patch-code-server-workbench: workbench.html not found");
    process.exit(1);
  }

  const injection = buildInjection();
  const html = fs.readFileSync(workbenchHtml, "utf8");
  fs.writeFileSync(workbenchHtml, upsertInjection(html, injection));
  console.log(`patch-code-server-workbench: patched ${workbenchHtml}`);
}

main();
