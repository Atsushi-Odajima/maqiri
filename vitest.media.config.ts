import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// 実 ffmpeg/ffprobe を spawn する統合テスト。Windows では同梱ツール、他 OS では開発専用のシステム ffmpeg。
export default defineConfig({
  resolve: {
    alias: {
      '@domain': resolve(__dirname, 'src/domain'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@media': resolve(__dirname, 'src/media')
    }
  },
  test: {
    include: ['tests/media/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/media/globalSetup.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    reporters: ['default']
  }
});
