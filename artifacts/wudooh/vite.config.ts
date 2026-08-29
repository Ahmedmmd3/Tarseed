import path from 'path';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

const publicOutDir = path.resolve(import.meta.dirname, 'dist/public');

async function listBuildAssets(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const assets = await Promise.all(entries.map(async (entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listBuildAssets(path.join(directory, entry.name), relativePath)
      : [relativePath];
  }));
  return assets.flat();
}

function pwaPrecachePlugin(): Plugin {
  return {
    name: 'wudooh-pwa-precache',
    apply: 'build',
    async closeBundle() {
      const serviceWorkerPath = path.join(publicOutDir, 'sw.js');
      const serviceWorkerTemplate = await readFile(serviceWorkerPath, 'utf8');
      const assetPaths = (await listBuildAssets(path.join(publicOutDir, 'assets'), 'assets')).sort();
      const buildId = createHash('sha256').update(assetPaths.join('\n')).digest('hex').slice(0, 12);
      const generatedServiceWorker = serviceWorkerTemplate
        .replace('__WUDOOH_BUILD_ID__', buildId)
        .replace('/* __WUDOOH_BUILD_ASSETS__ */ []', JSON.stringify(assetPaths));

      if (generatedServiceWorker === serviceWorkerTemplate) {
        throw new Error('Service worker precache placeholders were not replaced.');
      }
      await writeFile(serviceWorkerPath, generatedServiceWorker);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    pwaPrecachePlugin(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: publicOutDir,
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: process.env.API_PROXY_TARGET
      ? {
          '/api': {
            target: process.env.API_PROXY_TARGET,
            changeOrigin: false,
          },
        }
      : undefined,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
