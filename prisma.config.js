// Settings for the Prisma command line (prisma generate, prisma migrate diff).
// The app does not read this file: it connects through src/config/client.js.
import './src/load-env.js';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL || 'file:data/local.db' },
});
