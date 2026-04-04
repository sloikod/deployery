import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

import { baseConfig } from './base.mjs';

export const nextConfig = defineConfig([
	...baseConfig,
	...nextVitals,
	globalIgnores(['.next/**', 'build/**']),
]);

export default nextConfig;
