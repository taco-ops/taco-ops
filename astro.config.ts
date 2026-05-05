import { loadEnv } from "vite";
import { defineConfig } from 'astro/config';

import expressiveCode from 'astro-expressive-code';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import spectre from './package/src';

const {
  GISCUS_REPO,
  GISCUS_REPO_ID,
  GISCUS_CATEGORY,
  GISCUS_CATEGORY_ID,
  GISCUS_MAPPING,
  GISCUS_STRICT,
  GISCUS_REACTIONS_ENABLED,
  GISCUS_EMIT_METADATA,
  GISCUS_LANG
} = loadEnv(process.env.NODE_ENV!, process.cwd(), "");

// https://astro.build/config
const config = defineConfig({
  site: 'https://taco-ops.github.io',
  base: '/taco-ops',
  output: 'static',
  integrations: [
    expressiveCode({
      themes: ['material-theme-palenight'],
    }),
    mdx(),
    sitemap(),
    spectre({
      name: 'Taco Ops',
      themeColor: '#84ffff',
      openGraph: {
        home: {
          title: 'Taco Ops',
          description: 'Infrastructure, observability, Kubernetes, and astrophotography from someone who spends a great deal of time separating signal from noise.'
        },
        blog: {
          title: 'Blog',
          description: 'Notes on Kubernetes, platform engineering, astrophotography, and the machinery people trust until it starts telling the truth.'
        },
        projects: {
          title: 'Projects'
        }
      },
    })
  ]
});

export default config;
