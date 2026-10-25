import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import launchesHandler from './api/launches.js';

/**
 * Serves /api/launches under `vite dev` and `vite preview`, the way Vercel serves
 * the function in production, so the Upcoming Launches panel works locally.
 */
function launchesApi(): Plugin {
  const mount = (server: { middlewares: { use: (path: string, handler: unknown) => void } }): void => {
    server.middlewares.use('/api/launches', (req: unknown, res: unknown) => {
      void launchesHandler(req, res);
    });
  };
  return { name: 'launches-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  base: './',
  plugins: [launchesApi()],
  // satellite.js 7 bundles an optional WebAssembly runtime that this app never
  // uses; leave it out of the build (see src/vendor/satelliteWasmStub.ts).
  resolve: {
    alias: {
      '#wasm-single-thread': fileURLToPath(new URL('./src/vendor/satelliteWasmStub.ts', import.meta.url)),
      '#wasm-multi-thread': fileURLToPath(new URL('./src/vendor/satelliteWasmStub.ts', import.meta.url)),
    },
  },
  build: {
    // Never inline fonts as data: URIs — the CSP only allows fonts from our own origin.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    // vendor-three is a deliberately isolated, long-term-cacheable chunk
    // containing only the three.js core (see manualChunks below) — its size
    // is expected for a WebGL app and not something further splitting can
    // meaningfully reduce, so the default 500 kB warning is just noise here.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor code from app code so a
        // deploy that only touches app logic doesn't invalidate the
        // browser's cached copy of three.js/satellite.js. Only the core
        // three.js build is pinned here — three/examples/jsm/* (e.g. the
        // dynamically-imported GLTFLoader) is left for Rollup's default
        // splitting so a lazy import() still lands in its own chunk instead
        // of being pulled back into this always-loaded vendor bundle.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\\/]three[\\/]build/.test(id)) return 'vendor-three';
          if (id.includes('satellite.js')) return 'vendor-satellite';
          return undefined;
        },
      },
    },
  },
});
