import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@domain': resolve(__dirname, 'src/domain'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@media': resolve(__dirname, 'src/media')
    }
  },
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['default']
  }
});
