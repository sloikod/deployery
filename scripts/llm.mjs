import { globSync, readFileSync, statSync, writeFileSync } from 'fs';
import { createInterface } from 'readline/promises';
import prettier from 'prettier';

const REPLACEMENTS = [
  [/\u2014/g, '-'], // —
  [/\u2013/g, '-'], // –
  [/\u2212/g, '-'], // −
  [/\u2192/g, '->'], // →
  [/\u2190/g, '<-'], // ←
  [/\u21D2/g, '=>'], // ⇒
  [/\u2026/g, '...'], // …
  [/[\u201C\u201D]/g, '"'], // " "
  [/[\u2018\u2019]/g, "'"], // ' '
  [/\u2265/g, '>='], // ≥
  [/\u2264/g, '<='], // ≤
  [/\u2260/g, '!='], // ≠
  [/\u00D7/g, 'x'], // ×
  [/\u00A0/g, ' '], // nbsp
  [/\u202F/g, ' '], // narrow nbsp
  [/\u2009/g, ' '], // thin space
  [/\u200B/g, ''], // zero-width space
  [/\u200C/g, ''], // zwnj
  [/\u200D/g, ''], // zwj
  [/\uFEFF/g, ''], // bom
];

const EXTENSIONS = ['ts', 'tsx', 'js', 'mjs', 'cjs', 'md', 'mdx'];
const shouldAutoWrite = process.argv.includes('-y');
const checkOnly = process.argv.includes('-n');

const candidates = globSync(`**/*.{${EXTENSIONS.join(',')}}`, {
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

const allChars = new RegExp(REPLACEMENTS.map(([r]) => r.source).join('|'), 'g');

const violations = [];
for (const file of files) {
  const original = readFileSync(file, 'utf8');
  let content = original;
  for (const [from, to] of REPLACEMENTS) {
    content = content.replace(from, to);
  }
  if (content !== original) {
    const lines = original.split('\n').map((line, i) => ({ line, i }));
    const hits = lines
      .filter(({ line }) => allChars.test(line))
      .map(({ line, i }) => ({ lineNo: i + 1, text: line.trim() }));
    violations.push({ file, content, hits });
  }
}

if (violations.length === 0) {
  console.log('No LLM-style characters found.');
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
  console.error(`\n[${green}fix${reset}] ${violations.length} file(s) contain LLM-style characters. Run 'pnpm format'.`);
  process.exitCode = 1;
}
