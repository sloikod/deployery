import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const prettierBin = require.resolve('prettier/bin/prettier.cjs');
const shouldWrite = process.argv.includes('-y');
const args = shouldWrite ? ['--write', '.'] : ['--check', '.'];

const result = spawnSync(process.execPath, [prettierBin, ...args], {
	stdio: 'inherit',
	cwd: process.cwd(),
});

if (result.status !== 0) {
	if (!shouldWrite) {
		const green = process.stderr.isTTY ? '\x1b[32m' : '';
		const reset = process.stderr.isTTY ? '\x1b[0m' : '';
		console.error(`\n[${green}fix${reset}] Run 'pnpm format'.`);
	}
	process.exitCode = result.status ?? 1;
}
