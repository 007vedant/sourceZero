import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  out: './packages/engine/drizzle',
  schema: './packages/engine/src/persistence/schema.ts',
});
