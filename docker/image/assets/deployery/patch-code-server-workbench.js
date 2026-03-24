const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootfs = process.env.DEPLOYERY_CODE_SERVER_ROOTFS || "";
const searchRoot = path.join(rootfs, "/usr/lib/code-server");

function findWorkbenchHtml() {
  const cmd = `find ${JSON.stringify(searchRoot)} -name "workbench.html" | grep "/browser/" | head -1`;
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function main() {
  const workbenchHtml = findWorkbenchHtml();
  if (!workbenchHtml) {
    console.error("patch-code-server-workbench: workbench.html not found");
    process.exit(1);
  }

  const injection = [
    "<script>",
    "(function () {",
    "  const css = '.home-bar,.window-appicon,.editor-group-watermark{display:none!important;}';",
    '  const style = document.createElement("style");',
    "  style.textContent = css;",
    "  document.head.appendChild(style);",
    "",
    "  function normalizeInstalledHeaders(root) {",
    "    const nodes = (root instanceof Element ? [root, ...root.querySelectorAll('*')] : []);",
    "    for (const node of nodes) {",
    "      const text = node.textContent?.trim();",
    "      if (!text || !/\\s-\\sINSTALLED$/i.test(text)) continue;",
    "      if (!/^.+:\\d+\\s-\\sINSTALLED$/i.test(text)) continue;",
    "      node.textContent = 'INSTALLED';",
    "    }",
    "  }",
    "",
    "  const run = () => normalizeInstalledHeaders(document.body);",
    "  if (document.readyState === 'loading') {",
    "    document.addEventListener('DOMContentLoaded', run, { once: true });",
    "  } else {",
    "    run();",
    "  }",
    "",
    "  new MutationObserver((mutations) => {",
    "    for (const mutation of mutations) {",
    "      for (const node of mutation.addedNodes) {",
    "        if (node.nodeType === Node.ELEMENT_NODE) {",
    "          normalizeInstalledHeaders(node);",
    "        }",
    "      }",
    "      if (mutation.target && mutation.target.nodeType === Node.ELEMENT_NODE) {",
    "        normalizeInstalledHeaders(mutation.target);",
    "      }",
    "    }",
    "  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });",
    "})();",
    "</script>",
    "</head>",
  ].join("\n");

  const html = fs.readFileSync(workbenchHtml, "utf8");
  if (html.includes("normalizeInstalledHeaders")) {
    console.log(
      `patch-code-server-workbench: already patched ${workbenchHtml}`,
    );
    return;
  }

  fs.writeFileSync(workbenchHtml, html.replace("</head>", injection));
  console.log(`patch-code-server-workbench: patched ${workbenchHtml}`);
}

main();
