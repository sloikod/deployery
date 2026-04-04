import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: [
			'.github/**/*.{test,spec}.?(c|m)[jt]s?(x)',
			'packages/**/*.{test,spec}.?(c|m)[jt]s?(x)',
		],
		exclude: [
			...configDefaults.exclude,
			'**/dist/**',
			'**/coverage/**',
			'**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
			'**/*.e2e.{test,spec}.?(c|m)[jt]s?(x)',
		],
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			reportsDirectory: './coverage/unit',
		},
	},
});
