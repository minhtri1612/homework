-- AlterTable
-- Add-only: existing homeworks get NULL ("Chưa xếp lớp"), no table is rebuilt.
ALTER TABLE "homeworks" ADD COLUMN "grade" INTEGER
    CHECK ("grade" BETWEEN 6 AND 12); -- hand-written: Prisma has no CHECK

-- CreateIndex
CREATE INDEX "homeworks_grade" ON "homeworks"("grade");
