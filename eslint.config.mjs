import { defineConfig, globalIgnores } from 'eslint/config';

import baseConfig from '@deployery/configs/eslint/base.mjs';

export default defineConfig([...baseConfig, globalIgnores(['packages/**'])]);
