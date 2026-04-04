#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCKER_IMAGE_NAME, GITHUB_URL } from '@deployery/constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dockerPackagePath = path.resolve(__dirname, '..');
const repoRootPath = path.resolve(dockerPackagePath, '..', '..');

const run = (command, args) => {
	const result = spawnSync(command, args, {
		cwd: repoRootPath,
		stdio: 'inherit',
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
};

const runCapture = (command, args) => {
	const result = spawnSync(command, args, {
		cwd: repoRootPath,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
	if (result.status !== 0) return undefined;
	return result.stdout.trim() || undefined;
};

const main = async () => {
	const packageJson = JSON.parse(await readFile(path.join(repoRootPath, 'package.json'), 'utf8'));
	if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
		throw new Error('Root package.json is missing a string version');
	}

	const version = packageJson.version;
	const revision = runCapture('git', ['rev-parse', 'HEAD']) ?? 'unknown';
	const source = runCapture('git', ['config', '--get', 'remote.origin.url']) ?? GITHUB_URL;
	// Mirrors the resolution logic in packages/docker/rootfs/opt/deployery/runtime/path-constants.ts
	const dockerVolumePath = process.env.DEPLOYERY_DOCKER_VOLUME_PATH?.trim() || '/data';
	const imageName = DOCKER_IMAGE_NAME;

	run('docker', [
		'build',
		'--build-arg',
		`DEPLOYERY_VERSION=${version}`,
		'--build-arg',
		`BUILD_REVISION=${revision}`,
		'--build-arg',
		`BUILD_SOURCE=${source}`,
		'--build-arg',
		`DEPLOYERY_DOCKER_VOLUME_PATH=${dockerVolumePath}`,
		'-t',
		imageName,
		'-f',
		path.join(dockerPackagePath, 'Dockerfile'),
		repoRootPath,
	]);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
