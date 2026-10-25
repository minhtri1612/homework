// Builds the web app. Kept apart from server.js so tests can start it with
// their own database (a Prisma client).
import express, { type Express } from 'express';
import type { PrismaClient } from './generated/prisma/client.ts';
import { fileURLToPath } from 'node:url';
import { loadTeacher } from './middleware/auth.ts';
import { sameOriginPosts } from './middleware/same-origin.ts';
import { webRoutes } from './routes/web.ts';
import { healthz, notFound, serverError } from './routes/status.ts';
import { formatVietnamDate, formatVietnamDateTime } from './vietnam-time.ts';

export const BROWSER_BUILD = {
  public: fileURLToPath(new URL('../dist/browser/public', import.meta.url)),
  shared: fileURLToPath(new URL('../dist/browser/shared', import.meta.url)),
};

export interface AppOptions {
  prisma: PrismaClient;
  /** Required to register as a teacher; null lets anyone register (local use and tests). */
  inviteCode?: string | null;
}

export function createApp({ prisma, inviteCode = null }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy, so req.secure sees HTTPS
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
  app.locals.formatDate = formatVietnamDate;
  app.locals.formatDateTime = formatVietnamDateTime;

  // Browser JavaScript is compiled from TypeScript by npm run build:browser:
  // /js/*.js from src/public/js/*.ts, and /shared/parser.js from the same
  // parser the server uses (for the editor's live preview).
  app.use(express.static(BROWSER_BUILD.public));
  app.use('/shared', express.static(BROWSER_BUILD.shared));
  // style.css; src/public also holds the .ts sources of the browser code, which are not served.
  const publicFiles = express.static(fileURLToPath(new URL('./public', import.meta.url)));
  app.use((req, res, next) => (req.path.endsWith('.ts') ? next() : publicFiles(req, res, next)));
  // 1 MB fits 200 long questions; the default 100 KB does not.
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  // Middleware and controllers reach the database through req.prisma.
  app.use((req, res, next) => {
    req.prisma = prisma;
    req.inviteCode = inviteCode;
    next();
  });
  app.use(loadTeacher);
  app.use(sameOriginPosts);

  app.get('/healthz', healthz);
  app.use(webRoutes());

  app.use(notFound);
  app.use(serverError);

  return app;
}
