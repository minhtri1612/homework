-- Hand-written instead of Prisma's RedefineTables (which only reorders the
-- columns): three columns added in place, with CHECKs Prisma cannot express.
ALTER TABLE "attempts" ADD COLUMN "student_name" TEXT;
ALTER TABLE "attempts" ADD COLUMN "leave_count" INTEGER NOT NULL DEFAULT 0 CHECK ("leave_count" >= 0);
ALTER TABLE "attempts" ADD COLUMN "away_seconds" INTEGER NOT NULL DEFAULT 0 CHECK ("away_seconds" >= 0);
