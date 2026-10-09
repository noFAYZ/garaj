import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests share one Postgres database; running files in parallel would let
    // one suite's truncate wipe another's fixtures mid-assertion.
    fileParallelism: false,
  },
});
