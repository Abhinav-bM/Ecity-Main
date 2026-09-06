import type { NextConfig } from 'next'

const config: NextConfig = {
  // Required for the Docker deployment described in docs/04-Deployment-Guide.md
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Linting runs as its own CI step with the flat config in eslint.config.mjs.
  // Next's built-in detection only recognises eslint-config-next, which is
  // eslintrc-only and incompatible with ESLint 9 flat config.
  eslint: { ignoreDuringBuilds: true },
  // react-pdf ships its own font/layout engine and must not be run through
  // the webpack/turbopack bundler - let Node require it at runtime instead.
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    // Server Actions are used for form mutations; keep the body limit tight.
    serverActions: { bodySizeLimit: '2mb' },
  },
}

export default config
