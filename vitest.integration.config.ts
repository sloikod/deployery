import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: [
			'.github/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
			'.github/**/*.e2e.{test,spec}.?(c|m)[jt]s?(x)',
			'packages/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
			'packages/**/*.e2e.{test,spec}.?(c|m)[jt]s?(x)',
		],
		exclude: [...configDefaults.exclude, '**/dist/**', '**/coverage/**'],
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			reportsDirectory: './coverage/integration',
		},
	},
});
