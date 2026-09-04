import 'dotenv/config'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globals: true,
    // Unit tests must not need a database, so these fall back to dummy
    // values that satisfy the env schema. Integration tests use the real
    // DATABASE_URL loaded from .env above, and skip when none is reachable.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused:unused@127.0.0.1:5432/unused',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-secret-not-used-anywhere-real',
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
