#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import {
	PLATFORM_RUNNERS,
	SUPPORTED_DOCKER_PLATFORMS,
	platformArchitecture,
} from './platform-constants.mjs';

export const sanitizeBranch = (branch) =>
	branch
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, '-')
		.replace(/^[.-]+/, '')
		.replace(/[.-]+$/, '')
		.slice(0, 120) || 'unknown';

export const deriveStableVersion = (refName, repoVersion) => {
	const match = /^v(\d+\.\d+\.\d+)$/.exec(refName);
	if (!match) {
		throw new Error(`Stable releases require a vX.Y.Z tag, received "${refName}"`);
	}

	const version = match[1];
	if (repoVersion && repoVersion !== version) {
		throw new Error(
			`Root package.json version ${repoVersion} does not match release tag ${version}`,
		);
	}

	return version;
};

export const deriveBetaVersion = (repoVersion, runNumber) => {
	if (!/^\d+\.\d+\.\d+-beta$/.test(repoVersion)) {
		throw new Error(
			`Beta releases require a root package.json version shaped X.Y.Z-beta, received "${repoVersion}"`,
		);
	}

	const run = Number.parseInt(runNumber, 10);
	if (!Number.isInteger(run) || run <= 0) {
		throw new Error(`Beta releases require a positive run number, received "${runNumber}"`);
	}

	return `${repoVersion}.${run}`;
};

export const deriveBranchVersion = (branch, sha) => {
	const shortSha = sha.slice(0, 7);
	if (!shortSha) throw new Error('Branch preview builds require a commit SHA');
	return `branch-${sanitizeBranch(branch)}-${shortSha}`;
};

export const buildMatrix = (platforms) => ({
	include: platforms.map((platform) => ({
		docker_platform: platform,
		platform: platformArchitecture(platform),
		runner: PLATFORM_RUNNERS[platform],
	})),
});

export const determineContext = ({ branch, mode, refName, repoVersion, runNumber, sha }) => {
	switch (mode) {
		case 'stable':
			return {
				build_matrix: buildMatrix(SUPPORTED_DOCKER_PLATFORMS),
				platforms: SUPPORTED_DOCKER_PLATFORMS,
				push_to_docker: true,
				release_type: 'stable',
				version: deriveStableVersion(refName, repoVersion),
			};
		case 'beta':
			return {
				build_matrix: buildMatrix(SUPPORTED_DOCKER_PLATFORMS),
				platforms: SUPPORTED_DOCKER_PLATFORMS,
				push_to_docker: true,
				release_type: 'beta',
				version: deriveBetaVersion(repoVersion, runNumber),
			};
		case 'branch':
			return {
				build_matrix: buildMatrix(SUPPORTED_DOCKER_PLATFORMS),
				platforms: SUPPORTED_DOCKER_PLATFORMS,
				push_to_docker: false,
				release_type: 'branch',
				version: deriveBranchVersion(branch ?? refName, sha),
			};
		default:
			throw new Error(`Unsupported release mode "${mode}"`);
	}
};

const output = (context) => {
	const githubOutput = process.env.GITHUB_OUTPUT;
	if (!githubOutput) {
		console.log(JSON.stringify(context, null, 2));
		return;
	}

	appendFileSync(
		githubOutput,
		[
			`version=${context.version}`,
			`release_type=${context.release_type}`,
			`push_to_docker=${context.push_to_docker}`,
			`platforms=${JSON.stringify(context.platforms)}`,
			`build_matrix=${JSON.stringify(context.build_matrix)}`,
		].join('\n') + '\n',
	);
};

// CLI entry point – skipped when imported as a module.
if (import.meta.url === `file://${process.argv[1]}`) {
	const getArg = (name) => {
		const index = process.argv.indexOf(`--${name}`);
		return index >= 0 ? process.argv[index + 1] : undefined;
	};

	try {
		output(
			determineContext({
				branch: getArg('branch'),
				mode: getArg('mode'),
				refName: getArg('ref-name') ?? '',
				repoVersion: getArg('repo-version') ?? '',
				runNumber: getArg('run-number') ?? '',
				sha: getArg('sha') ?? '',
			}),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
