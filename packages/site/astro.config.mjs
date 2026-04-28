// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Build target is driven by env so the same source can ship to multiple hosts:
//   default: GitHub Pages — base /TermBeam, site dorlugasigal.github.io
//   Cloudflare Pages: detected automatically via CF_PAGES=1 (set by Cloudflare's
//     Git integration during builds) OR explicitly via DEPLOY_TARGET=cloudflare.
//     Base /, site from CF_PAGES_URL (set by Cloudflare) or SITE_URL.
const explicitTarget = process.env.DEPLOY_TARGET;
const isCF = explicitTarget === 'cloudflare' || process.env.CF_PAGES === '1';

const site = isCF
  ? process.env.SITE_URL || process.env.CF_PAGES_URL || 'https://termbeam.pages.dev'
  : 'https://dorlugasigal.github.io';
const base = isCF ? '/' : '/TermBeam';
const ogImage = `${site.replace(/\/$/, '')}${base === '/' ? '' : base}/og-image.png`;

// https://astro.build/config
export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'TermBeam',
      description:
        'Access your terminal from any device. Mobile-optimized web terminal with multi-session support.',
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: ogImage,
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:card',
            content: 'summary_large_image',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image',
            content: ogImage,
          },
        },
        {
          tag: 'script',
          content: `(function(){function fix(){var btn=document.querySelector('[data-open-modal][aria-label]');if(btn){btn.setAttribute('aria-label','Search docs (Ctrl+K)');}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fix);}else{fix();}setTimeout(fix,500);})();`,
        },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/dorlugasigal/TermBeam' },
      ],
      editLink: {
        baseUrl: 'https://github.com/dorlugasigal/TermBeam/edit/main/packages/site/',
      },
      customCss: ['./src/styles/global.css', './src/styles/starlight.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Use Cases', slug: 'use-cases' },
            { label: 'Comparison', slug: 'comparison' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Usage Guide', slug: 'usage-guide' },
            { label: 'Customization', slug: 'customization' },
            { label: 'AI Agents', slug: 'ai-agents' },
            { label: 'Configuration', slug: 'configuration' },
            { label: 'Resume & List', slug: 'resume' },
            { label: 'Running in Background', slug: 'running-in-background' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Security', slug: 'security' },
            { label: 'API Reference', slug: 'api' },
            { label: 'Architecture', slug: 'architecture' },
            { label: 'Troubleshooting', slug: 'troubleshooting' },
          ],
        },
        {
          label: 'Community',
          items: [{ label: 'Contributing', slug: 'contributing' }],
        },
      ],
    }),
  ],
});
