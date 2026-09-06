import 'dotenv/config'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // The PDF renderer is a .tsx module; use the automatic runtime so the tests
  // do not need a React import that the Next compiler never asks for.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    globals: true,
    /**
     * Integration tests share one database, and teardown suspends the
     * append-only triggers - which is global DDL. Run files one at a time so
     * one suite's cleanup cannot disable a guard another suite is asserting.
     * See tests/integration/setup.ts.
     */
    fileParallelism: false,
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
