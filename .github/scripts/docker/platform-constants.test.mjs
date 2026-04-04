import { describe, expect, it } from 'vitest';
import {
	PLATFORM_RUNNERS,
	SUPPORTED_DOCKER_PLATFORMS,
	platformArchitecture,
} from './platform-constants.mjs';

describe('platform-constants', () => {
	it('defines the supported Docker platforms once', () => {
		expect(SUPPORTED_DOCKER_PLATFORMS).toEqual(['linux/amd64', 'linux/arm64']);
		expect(PLATFORM_RUNNERS).toEqual({
			'linux/amd64': 'ubuntu-24.04',
			'linux/arm64': 'ubuntu-24.04-arm',
		});
	});

	it('extracts the architecture suffix from a Docker platform', () => {
		expect(platformArchitecture('linux/amd64')).toBe('amd64');
		expect(platformArchitecture('linux/arm64')).toBe('arm64');
	});
});
