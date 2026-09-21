-- DropForeignKey
ALTER TABLE "ticket_satisfaction_surveys" DROP CONSTRAINT "ticket_satisfaction_surveys_ticketId_fkey";

-- AddForeignKey
ALTER TABLE "ticket_satisfaction_surveys" ADD CONSTRAINT "ticket_satisfaction_surveys_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
