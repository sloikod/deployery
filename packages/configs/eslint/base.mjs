import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const baseConfig = defineConfig([
	globalIgnores([
		'**/node_modules/**',
		'**/dist/**',
		'**/out/**',
		'**/.source/**',
		'**/.turbo/**',
		'**/coverage/**',
		'**/*.d.ts',
	]),
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'],
		languageOptions: {
			ecmaVersion: 'latest',
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
	},
	{
		files: ['**/*.{js,mjs,cjs,mts,cts}'],
		languageOptions: {
			globals: {
				...globals.nodeBuiltin,
				...globals.node,
			},
		},
	},
	{
		files: ['**/*.cjs'],
		languageOptions: {
			sourceType: 'commonjs',
		},
	},
]);

export default baseConfig;
