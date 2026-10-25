// Builds the web app. Kept apart from server.js so tests can start it with
// their own database (a Prisma client).
import express, { type Express } from 'express';
import type { PrismaClient } from './generated/prisma/client.ts';
import { fileURLToPath } from 'node:url';
import { loadTeacher } from './middleware/auth.ts';
import { sameOriginPosts } from './middleware/same-origin.ts';
import { webRoutes } from './routes/web.ts';
import { notFound, serverError } from './routes/status.ts';
import { formatVietnamDate, formatVietnamDateTime } from './vietnam-time.ts';

export function createApp({ prisma }: { prisma: PrismaClient }): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy, so req.secure sees HTTPS
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
  app.locals.formatDate = formatVietnamDate;
  app.locals.formatDateTime = formatVietnamDateTime;

  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  // The parser also runs in the browser, for the editor's live preview.
  app.use('/shared', express.static(fileURLToPath(new URL('./shared', import.meta.url))));
  // 1 MB fits 200 long questions; the default 100 KB does not.
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  // Middleware and controllers reach the database through req.prisma.
  app.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });
  app.use(loadTeacher);
  app.use(sameOriginPosts);

  app.use(webRoutes());

  app.use(notFound);
  app.use(serverError);

  return app;
}
