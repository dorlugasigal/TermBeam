// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://dorlugasigal.github.io',
  base: '/TermBeam',
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
            content: 'https://dorlugasigal.github.io/TermBeam/og-image.png',
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
            content: 'https://dorlugasigal.github.io/TermBeam/og-image.png',
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
