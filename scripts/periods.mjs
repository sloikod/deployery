import { globSync, readFileSync, statSync, writeFileSync } from 'fs';
import { createInterface } from 'readline/promises';
import prettier from 'prettier';

const LIST_ITEM = /^(\s*(?:[-*+]|\d+\.)\s+)(.+)$/;
const TERMINAL_PUNCT = /[.!?:;,)\]"']$/;

const shouldAutoWrite = process.argv.includes('-y');
const checkOnly = process.argv.includes('-n');

const candidates = globSync('**/*.{md,mdx}', {
	cwd: process.cwd(),
	absolute: true,
}).filter((f) => statSync(f).isFile());

const files = (
	await Promise.all(
		candidates.map(async (f) => {
			const { ignored } = await prettier.getFileInfo(f, { ignorePath: '.prettierignore' });
			return ignored ? null : f;
		}),
	)
).filter(Boolean);

const violations = [];
for (const file of files) {
	const original = readFileSync(file, 'utf8');
	const lines = original.split(/\r?\n/);
	const hits = [];
	const fixed = lines.map((line, i) => {
		const match = LIST_ITEM.exec(line);
		if (!match) return line;
		const [, prefix, content] = match;
		if (TERMINAL_PUNCT.test(content)) return line;
		hits.push({ lineNo: i + 1, text: line.trim() });
		return prefix + content + '.';
	});
	const content = fixed.join('\n');
	if (content !== original) {
		violations.push({ file, content, hits });
	}
}

if (violations.length === 0) {
	console.log('All list items have trailing periods.');
	process.exit(0);
}

for (const { file, hits } of violations) {
	const rel = file.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');
	console.log(`\n  ${rel}`);
	for (const { lineNo, text } of hits) {
		console.log(`  ${String(lineNo).padStart(4)}  ${text}`);
	}
}

async function confirmFix() {
	if (checkOnly || !process.stdin.isTTY || !process.stdout.isTTY) return false;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question(`\nFix ${violations.length} file(s)? [y/N] `);
		return /^(y|yes)$/i.test(answer.trim());
	} finally {
		rl.close();
	}
}

const shouldWrite = shouldAutoWrite || (await confirmFix());

if (shouldWrite) {
	for (const { file, content } of violations) {
		writeFileSync(file, content, 'utf8');
	}
	console.log(`\nFixed ${violations.length} file(s).`);
} else {
	const green = process.stderr.isTTY ? '\x1b[32m' : '';
	const reset = process.stderr.isTTY ? '\x1b[0m' : '';
	console.error(
		`\n[${green}fix${reset}] ${violations.length} file(s) have list items missing trailing periods. Run 'pnpm format'.`,
	);
	process.exitCode = 1;
}
