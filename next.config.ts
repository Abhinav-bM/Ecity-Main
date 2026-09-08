import type { NextConfig } from 'next'

const config: NextConfig = {
  // Required for the Docker deployment described in docs/04-Deployment-Guide.md
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Linting is its own CI step, with the flat config in eslint.config.mjs.
  // Next 16 removed `next lint` and with it the `eslint` config key, so
  // there is nothing to switch off here any more.
  // react-pdf ships its own font/layout engine and must not be run through
  // the webpack/turbopack bundler - let Node require it at runtime instead.
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    // Server Actions are used for form mutations; keep the body limit tight.
    serverActions: { bodySizeLimit: '2mb' },
  },
}

export default config
