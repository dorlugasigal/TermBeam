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
            { label: 'Comparison', slug: 'comparison' },
            { label: 'Use Cases', slug: 'use-cases' },
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
