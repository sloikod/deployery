import { describe, expect, it } from 'vitest';
import { platformSources } from './image-manifest.mjs';

describe('image-manifest', () => {
	it('builds per-platform source tags from a manifest tag', () => {
		expect(
			platformSources('ghcr.io/owner/deployery:1.2.3', ['linux/amd64', 'linux/arm64']),
		).toEqual(['ghcr.io/owner/deployery:1.2.3-amd64', 'ghcr.io/owner/deployery:1.2.3-arm64']);
	});
});
