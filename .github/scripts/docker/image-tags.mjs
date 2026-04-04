#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { DOCKER_HUB_NAMESPACE, DOCKER_IMAGE_NAME, REPO_OWNER } from '@deployery/constants';
import { platformArchitecture } from './platform-constants.mjs';

export const aliasesForRelease = ({ releaseType, sha, version }) => {
	switch (releaseType) {
		case 'stable':
			return [version, 'latest'];
		case 'beta':
			return [version, 'beta', `beta-${sha.slice(0, 7)}`];
		case 'branch':
			return [version];
		default:
			throw new Error(`Unsupported release type "${releaseType}"`);
	}
};

const buildRegistryTags = ({
	aliases,
	dockerUsername,
	githubOwner,
	imageName,
	includeDockerHub,
	platform,
}) => {
	const platformSuffix = platform ? `-${platformArchitecture(platform)}` : '';
	const registries = [`ghcr.io/${githubOwner}/${imageName}`];

	if (includeDockerHub) {
		registries.push(`${dockerUsername}/${imageName}`);
	}

	const manifestTags = registries.flatMap((repository) =>
		aliases.map((alias) => `${repository}:${alias}`),
	);

	return {
		manifestTags,
		platformTags: manifestTags.map((tag) => `${tag}${platformSuffix}`),
		primaryTag: manifestTags[0],
	};
};

export const buildTags = ({
	dockerUsername = DOCKER_HUB_NAMESPACE,
	githubOwner = REPO_OWNER,
	imageName = DOCKER_IMAGE_NAME,
	includeDockerHub = false,
	platform,
	releaseType,
	sha = '',
	version,
}) => {
	const aliases = aliasesForRelease({
		releaseType,
		sha,
		version,
	});
	return buildRegistryTags({
		aliases,
		dockerUsername,
		githubOwner,
		imageName,
		includeDockerHub,
		platform,
	});
};

const output = ({ manifestTags, platformTags, primaryTag }) => {
	const githubOutput = process.env.GITHUB_OUTPUT;
	if (!githubOutput) {
		console.log(
			JSON.stringify(
				{
					manifestTags,
					platformTags,
					primaryTag,
				},
				null,
				2,
			),
		);
		return;
	}

	appendFileSync(
		githubOutput,
		[
			`manifest_tags=${manifestTags.join(',')}`,
			`platform_tags=${platformTags.join(',')}`,
			`primary_tag=${primaryTag}`,
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
			buildTags({
				dockerUsername: process.env.DOCKERHUB_USERNAME || DOCKER_HUB_NAMESPACE,
				githubOwner: process.env.GITHUB_REPO_OWNER || REPO_OWNER,
				imageName: DOCKER_IMAGE_NAME,
				includeDockerHub: process.argv.includes('--include-docker'),
				platform: getArg('platform'),
				releaseType: getArg('release-type'),
				sha: getArg('sha') ?? '',
				version: getArg('version') ?? '',
			}),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
