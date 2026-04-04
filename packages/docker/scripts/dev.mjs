#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCKER_DEV_CONTAINER_NAME, DOCKER_IMAGE_NAME } from '@deployery/constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dockerPackagePath = path.resolve(__dirname, '..');

const DEV_CONTAINER_NAME = DOCKER_DEV_CONTAINER_NAME;
// Mirrors the resolution logic in packages/docker/rootfs/opt/deployery/runtime/path-constants.ts
const DOCKER_VOLUME_PATH = process.env.DEPLOYERY_DOCKER_VOLUME_PATH?.trim() || '/data';
const IMAGE_NAME = DOCKER_IMAGE_NAME;
const DEV_VOLUME_NAME = `${DEV_CONTAINER_NAME}-dev`;

const run = (command, args) => {
	const result = spawnSync(command, args, {
		cwd: dockerPackagePath,
		stdio: 'inherit',
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
};

const removeStaleContainer = () => {
	const result = spawnSync('docker', ['rm', '-f', DEV_CONTAINER_NAME], {
		cwd: dockerPackagePath,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	if (result.status === 0) {
		process.stdout.write(`Removed stale container ${DEV_CONTAINER_NAME}.\n`);
		return;
	}

	if (result.stderr?.includes('No such container')) return;

	process.stderr.write(
		`${result.stderr?.trim() || `Failed to remove container ${DEV_CONTAINER_NAME}.`}\n`,
	);
	process.exit(result.status ?? 1);
};

run('node', ['scripts/build.mjs']);
removeStaleContainer();

run('docker', [
	'run',
	'--name',
	DEV_CONTAINER_NAME,
	'--rm',
	'-p',
	'8080:8080',
	'-v',
	`${DEV_VOLUME_NAME}:${DOCKER_VOLUME_PATH}`,
	IMAGE_NAME,
]);
