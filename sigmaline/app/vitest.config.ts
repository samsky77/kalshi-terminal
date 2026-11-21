import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src'), 'server-only': resolve(__dirname, 'test/stubs/server-only.ts') } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 60000 },
});
