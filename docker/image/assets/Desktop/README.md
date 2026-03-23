# Welcome to Your Deployery Sandbox!

## 📦 Package Management
- **System packages:** `sudo apt install <package>`
- **Node packages:** `npm install <package>`
- **Python packages:** `pip install <package>`

### 📙 Pre-installed:
- `node` / `npm`
- `python3` / `pip`
- `git` / `gh`
- `fzf` / `rg` (ripgrep) / `fd`
- `deployery` CLI

## 🤖 Workflows
This sandbox is equipped with the `deployery` CLI to sync and trigger workflows.
- **Location:** `~/Desktop/Workflows/`
- **Usage:** Create a JSON manifest in the workflows folder, then run `deployery deploy <path>` to sync it.

## Auto-pause

Your sandbox pauses automatically when idle. Add process patterns to `~/Desktop/autopause.cfg` to keep it alive while specific processes are running. If the file is empty or missing, the sandbox will always auto-pause when idle.

## 📜 Additional Info
Your entire sandbox (files, settings, extensions) persists across sessions.
When you leave, the sandbox pauses automatically and resumes when you return.

### ⌨️ Advanced Keyboard Shortcuts (Ctrl+W, Ctrl+T)
For security reasons, web browsers prevent websites from intercepting tab management shortcuts like `Ctrl+W` or `Ctrl+T`.

**To unlock full native IDE keyboard shortcuts:**
1. Look for the **"Install App"** icon in your browser's address bar.
2. Install Deployery as an application (PWA).
3. Open sandboxes in the newly installed standalone window to get 100% native keyboard behavior.
