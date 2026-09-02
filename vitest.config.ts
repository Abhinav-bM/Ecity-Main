import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globals: true,
    // Unit tests must not need a database. Integration tests set these
    // properly via .env.test; these values only satisfy the env schema.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused:unused@127.0.0.1:5432/unused',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-secret-not-used-anywhere-real',
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
