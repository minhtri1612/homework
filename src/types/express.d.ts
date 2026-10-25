// What this app adds to Express's request object (see src/app.ts and
// src/middleware/auth.js). Types only: nothing here runs.
import type { PrismaClient } from '../generated/prisma/client.ts';

declare global {
  namespace Express {
    interface Request {
      /** The database, set for every request in createApp(). */
      prisma: PrismaClient;
      /** The raw session token from the "sid" cookie, or null when there is none. */
      sessionToken: string | null;
      /** The logged-in teacher, or null. Set by loadTeacher. */
      teacher: { id: number; email: string; name: string } | null;
    }
  }
}

export {};
