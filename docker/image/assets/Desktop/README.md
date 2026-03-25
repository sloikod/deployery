# Welcome to Your Deployery Sandbox

## Package management

- System packages: `sudo apt install <package>`
- Node packages: `npm install <package>`
- Python packages: `pip install <package>`

## Preinstalled tools

- `node` / `npm`
- `python3` / `pip`
- `git`
- `fzf`, `rg`, `fd`
- `deployery` CLI

## Workflows

Store workflow manifests in `~/Desktop/workflows/`, then sync them with:

```bash
deployery push <path>
```

## Auto-pause

The sandbox pauses automatically when idle. Add process patterns to
`~/Desktop/autopause.cfg` to keep it awake while matching processes are running.

## Keyboard shortcuts

Browsers do not allow sites to intercept some tab-management shortcuts such as
`Ctrl+W` and `Ctrl+T`.

For the closest native IDE experience, install Deployery as a PWA from your
browser and open future sessions in that standalone window.
