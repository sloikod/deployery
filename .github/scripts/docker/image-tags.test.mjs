import { describe, expect, it } from 'vitest';
import { aliasesForRelease, buildTags } from './image-tags.mjs';

describe('image-tags', () => {
	it('builds stable aliases and platform tags', () => {
		expect(
			aliasesForRelease({
				releaseType: 'stable',
				sha: '',
				version: '1.2.3',
			}),
		).toEqual(['1.2.3', 'latest']);

		const tags = buildTags({
			dockerUsername: 'acme',
			githubOwner: 'octo',
			imageName: 'widget',
			includeDockerHub: true,
			platform: 'linux/amd64',
			releaseType: 'stable',
			version: '1.2.3',
		});

		expect(tags.platformTags).toContain('ghcr.io/octo/widget:1.2.3-amd64');
		expect(tags.platformTags).toContain('acme/widget:latest-amd64');
	});

	it('builds beta aliases including the rolling beta tags', () => {
		expect(
			aliasesForRelease({
				releaseType: 'beta',
				sha: 'abcdef123456',
				version: '1.3.0-beta.42',
			}),
		).toEqual(['1.3.0-beta.42', 'beta', 'beta-abcdef1']);
	});
});
