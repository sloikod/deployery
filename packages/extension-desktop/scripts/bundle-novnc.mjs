import { build } from "esbuild";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(pkgDir, "vendor", "novnc");
const entryPoint = path.join(vendorDir, "core", "rfb.js");

// Download noVNC source if not already vendored
if (!fs.existsSync(entryPoint)) {
  console.log("Downloading noVNC v1.6.0 source...");
  fs.mkdirSync(vendorDir, { recursive: true });
  execSync(
    `curl -sL https://github.com/novnc/noVNC/archive/refs/tags/v1.6.0.tar.gz | tar xz --strip-components=1 -C "${vendorDir}"`,
    { stdio: "inherit" },
  );
}

// Bundle core/rfb.js (native ESM) into a single file
await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "esm",
  outfile: path.join(pkgDir, "media", "novnc-rfb.js"),
  minify: true,
});

console.log("Bundled noVNC RFB -> media/novnc-rfb.js");
