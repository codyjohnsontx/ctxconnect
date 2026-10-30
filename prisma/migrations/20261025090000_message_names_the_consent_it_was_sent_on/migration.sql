-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "consentEventId" TEXT;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_consentEventId_fkey" FOREIGN KEY ("consentEventId") REFERENCES "ConsentEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
