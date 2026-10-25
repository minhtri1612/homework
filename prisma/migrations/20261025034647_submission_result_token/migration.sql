-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "result_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "submissions_result_token_hash_key" ON "submissions"("result_token_hash");
