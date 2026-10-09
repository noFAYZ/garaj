import { loadEnvFile } from '@vehicle-os/config';
import { defineConfig } from 'drizzle-kit';

loadEnvFile();

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://vehicleos:vehicleos@localhost:5432/vehicleos',
  },
  // Migrations are immutable once applied (Architecture.md §66); this keeps drizzle-kit
  // from silently rewriting an already-deployed file when the schema drifts.
  strict: true,
  verbose: true,
});
