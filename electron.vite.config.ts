import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@domain': resolve(__dirname, 'src/domain'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@media': resolve(__dirname, 'src/media')
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    define: { __APP_EDITION__: JSON.stringify(process.env.APP_EDITION ?? 'demo') },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'analysis-worker': resolve(__dirname, 'src/media/analysisWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias },
    // ロゴ/アイコン/フォントは assets/ からローカル配信(外部 CDN なし)
    publicDir: resolve(__dirname, 'assets'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
});
