import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, runnerImport, type Plugin } from 'vite';
import launchesHandler from './api/launches.js';
import type { PageFonts } from './src/satPages/render';
import type * as SatSiteModule from './src/satPages/site';

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

/**
 * Writes one static page per satellite on the Radio panel's default list
 * (dist/sat/<NORAD>/index.html), the list page, 404.html and sitemap.xml,
 * from the catalogue in public/data/tle.json (see src/satPages/).
 */
function satellitePages(): Plugin {
  let outDir = 'dist';
  let publicDir = 'public';
  const fonts: PageFonts = {};
  const fontFiles: Array<[keyof PageFonts, RegExp]> = [
    ['sans400', /ibm-plex-sans-latin-400-normal-[^/]*\.woff2$/],
    ['sans600', /ibm-plex-sans-latin-600-normal-[^/]*\.woff2$/],
    ['mono400', /ibm-plex-mono-latin-400-normal-[^/]*\.woff2$/],
  ];
  return {
    name: 'satellite-pages',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        for (const [key, pattern] of fontFiles) {
          if (pattern.test(fileName)) fonts[key] = `/${fileName}`;
        }
      }
    },
    async closeBundle() {
      // Only after a complete build (closeBundle also runs when it failed).
      if (!existsSync(join(outDir, 'index.html'))) return;
      // Loaded through Vite (not imported at the top) so the app's TypeScript,
      // with its extensionless imports, never becomes part of loading this config.
      const { module } = await runnerImport<typeof SatSiteModule>(
        fileURLToPath(new URL('./src/satPages/site.ts', import.meta.url)),
      );
      const raw: unknown = JSON.parse(readFileSync(join(publicDir, 'data', 'tle.json'), 'utf8'));
      const { files, satelliteCount, skippedCount } = module.buildSatSite(raw, fonts);
      for (const [path, content] of files) {
        const target = join(outDir, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
      console.log(
        `satellite pages: ${satelliteCount} pages, list, 404, llms.txt and sitemap written` +
          ` (${skippedCount} objects with frequencies skipped: orbit no longer propagates)`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [launchesApi(), satellitePages()],
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
