-- AlterTable
ALTER TABLE "homeworks" ADD COLUMN "time_limit_minutes" INTEGER
    CHECK ("time_limit_minutes" BETWEEN 1 AND 600); -- hand-written: Prisma has no CHECK

-- CreateTable
CREATE TABLE "attempts" (
    "homework_id" INTEGER NOT NULL,
    "student_key" TEXT NOT NULL,
    "started_at" TEXT NOT NULL,

    PRIMARY KEY ("homework_id", "student_key"),
    CONSTRAINT "attempts_homework_id_fkey" FOREIGN KEY ("homework_id") REFERENCES "homeworks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
