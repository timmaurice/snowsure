import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    globals: true,
    setupFiles: './frontend/test/setup.ts',
    alias: { '\\.scss$': './frontend/test/styleMock.ts' },
  },
});
