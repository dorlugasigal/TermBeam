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
          { src: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
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
    proxy: {
      '/api': 'http://localhost:3456',
      '/ws': {
        target: 'ws://localhost:3456',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../../public',
    emptyOutDir: true,
    sourcemap: false,
  },
});
