import { describe, expect, it } from 'vitest';
import {
	deriveBetaVersion,
	deriveBranchVersion,
	deriveStableVersion,
	sanitizeBranch,
} from './build-context.mjs';

describe('build-context', () => {
	it('derives stable versions from semver tags', () => {
		expect(deriveStableVersion('v1.2.3', '1.2.3')).toBe('1.2.3');
	});

	it('derives beta versions from the prerelease base and run number', () => {
		expect(deriveBetaVersion('1.3.0-beta', '42')).toBe('1.3.0-beta.42');
	});

	it('sanitizes branch preview versions', () => {
		expect(deriveBranchVersion('Feature/New UI', 'abcdef123456')).toBe(
			'branch-feature-new-ui-abcdef1',
		);
		expect(sanitizeBranch('..Release Candidate..')).toBe('release-candidate');
	});
});
