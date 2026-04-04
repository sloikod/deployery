#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { platformArchitecture } from './platform-constants.mjs';

export const platformSources = (tag, platforms) =>
	platforms.map((platform) => `${tag}-${platformArchitecture(platform)}`);

// CLI entry point – skipped when imported as a module.
if (import.meta.url === `file://${process.argv[1]}`) {
	const platforms = JSON.parse(process.env.PLATFORMS_JSON ?? '[]');
	const tags = (process.env.MANIFEST_TAGS ?? '').split(',').filter(Boolean);

	for (const tag of tags) {
		const sources = platformSources(tag, platforms);
		execSync(`docker buildx imagetools create --tag ${tag} ${sources.join(' ')}`, {
			stdio: 'inherit',
		});
	}
}
