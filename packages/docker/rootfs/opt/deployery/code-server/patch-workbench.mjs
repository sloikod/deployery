import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const codeServerRootPath = '/opt/code-server/current';
const patchStartMarker = '<!-- deployery-workbench-patch:start -->';
const patchEndMarker = '<!-- deployery-workbench-patch:end -->';
const workbenchScriptTag = '<script src="/_deployery/code-server/bootstrap.js"></script>';

const findWorkbenchHtml = (root) => {
	const stack = [root];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;

		for (const entry of readdirSync(current, {
			withFileTypes: true,
		})) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}

			if (!entry.isFile() || entry.name !== 'workbench.html') continue;
			if (!fullPath.includes('/out/vs/code/browser/workbench/')) {
				continue;
			}
			return fullPath;
		}
	}

	throw new Error(`Could not find code-server workbench.html under ${root}`);
};

const patchWorkbenchHtml = (html) => {
	const markerPattern = new RegExp(`${patchStartMarker}[\\s\\S]*?${patchEndMarker}\\s*`, 'g');
	const cleanedHtml = html.replace(markerPattern, '');
	const injection = `${patchStartMarker}\n${workbenchScriptTag}\n${patchEndMarker}\n</head>`;

	if (!cleanedHtml.includes('</head>')) {
		throw new Error('Expected </head> in code-server workbench.html');
	}

	return cleanedHtml.replace('</head>', injection);
};

const workbenchHtmlPath = findWorkbenchHtml(codeServerRootPath);
const workbenchHtml = readFileSync(workbenchHtmlPath, 'utf8');
const patchedWorkbenchHtml = patchWorkbenchHtml(workbenchHtml);

if (patchedWorkbenchHtml !== workbenchHtml) {
	writeFileSync(workbenchHtmlPath, patchedWorkbenchHtml, 'utf8');
}

console.log(`Patched ${workbenchHtmlPath} with bootstrap script.`);
