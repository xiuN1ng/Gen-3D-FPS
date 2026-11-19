import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const __rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': __rootDir,
      },
    },
    build: {
      chunkSizeWarningLimit: 1600,
      rolldownOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/three') || id.includes('node_modules\\three')) {
              return 'three';
            }
            if (
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules\\react-dom') ||
              id.includes('node_modules/react/') ||
              id.includes('node_modules\\react\\') ||
              id.includes('node_modules/scheduler') ||
              id.includes('node_modules\\scheduler')
            ) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // Optional toggle to disable HMR and file watching via DISABLE_HMR=true.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
