import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2,ttf}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      includeAssets: ['icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'TermBeam',
        short_name: 'TermBeam',
        description: 'Beam your terminal to any device',
        start_url: '/',
        display: 'standalone',
        background_color: '#1e1e1e',
        theme_color: '#1e1e1e',
        icons: [
          {
            src: '/icons/icon-180.png',
            sizes: '180x180',
            type: 'image/png',
          },
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    // Dev-only: point the proxy at another TermBeam instance with
    // TERMBEAM_DEV_TARGET=http://localhost:3999 npx vite
    proxy: {
      // Keep the browser's Host header: TermBeam's CSRF guard compares it with
      // Origin (Vite's string shorthand would rewrite it to the target).
      '/api': {
        target: process.env.TERMBEAM_DEV_TARGET || 'http://localhost:3456',
        changeOrigin: false,
      },
      '/ws': {
        target: (process.env.TERMBEAM_DEV_TARGET || 'http://localhost:3456').replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
  test: {
    setupFiles: ['./src/test/setup.ts'],
  },
  build: {
    // Never inline fonts as data: URIs — the server's CSP only allows
    // font-src 'self', so tiny unicode-range subsets would be blocked.
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    outDir: '../../public',
    emptyOutDir: true,
    sourcemap: false,
  },
});
