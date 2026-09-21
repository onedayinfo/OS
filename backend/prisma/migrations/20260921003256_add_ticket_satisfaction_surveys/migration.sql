-- CreateTable
CREATE TABLE "ticket_satisfaction_surveys" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_satisfaction_surveys_ticketId_key" ON "ticket_satisfaction_surveys"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_satisfaction_surveys_publicToken_key" ON "ticket_satisfaction_surveys"("publicToken");

-- AddForeignKey
ALTER TABLE "ticket_satisfaction_surveys" ADD CONSTRAINT "ticket_satisfaction_surveys_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
