import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// 性能計測(明示実行のみ): npx vitest run --config vitest.perf.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@domain': resolve(__dirname, 'src/domain'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@media': resolve(__dirname, 'src/media')
    }
  },
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node',
    globalSetup: ['tests/media/globalSetup.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
    fileParallelism: false,
    reporters: ['default']
  }
});
