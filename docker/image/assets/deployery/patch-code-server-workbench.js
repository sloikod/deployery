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
    "      const text = node.textContent;",
    "      if (!text || !/\\S+:\\d+\\s+-\\s+INSTALLED$/i.test(text.trim())) continue;",
    "      node.textContent = text.replace(/\\S+:\\d+\\s+-\\s+/i, '');",
    "    }",
    "  }",
    "",
    "  function brandText(root) {",
    "    const elements = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [];",
    "    for (const element of elements) {",
    "      if (!(element instanceof HTMLElement)) continue;",
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
    "      const title = element.getAttribute('title');",
    "      if (title && /code-server/i.test(title)) {",
    "        element.setAttribute('title', title.replace(/code-server/gi, brandName));",
    "      }",
    "      const ariaLabel = element.getAttribute('aria-label');",
    "      if (ariaLabel && /code-server/i.test(ariaLabel)) {",
    "        element.setAttribute('aria-label', ariaLabel.replace(/code-server/gi, brandName));",
    "      }",
    "    }",
    "  }",
    "",
    "  const run = () => normalizeInstalledHeaders(document.body);",
    "  const brand = () => brandText(document.body);",
    "  if (document.readyState === 'loading') {",
    "    document.addEventListener('DOMContentLoaded', () => { run(); brand(); }, { once: true });",
    "  } else {",
    "    run();",
    "    brand();",
    "  }",
    "",
    "  new MutationObserver((mutations) => {",
    "    for (const mutation of mutations) {",
    "      for (const node of mutation.addedNodes) {",
    "        if (node.nodeType === Node.ELEMENT_NODE) {",
    "          normalizeInstalledHeaders(node);",
    "          brandText(node);",
    "        }",
    "      }",
    "      if (mutation.target && mutation.target.nodeType === Node.ELEMENT_NODE) {",
    "        normalizeInstalledHeaders(mutation.target);",
    "        brandText(mutation.target);",
    "      }",
    "    }",
    "  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });",
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
