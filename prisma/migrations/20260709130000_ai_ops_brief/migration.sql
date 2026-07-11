-- CreateEnum
CREATE TYPE "AiInsightActionType" AS ENUM ('GENERATED', 'ACCEPTED', 'DISMISSED', 'NOTE_CREATED', 'FOLLOW_UP_CREATED', 'REPLY_COPIED');

-- CreateEnum
CREATE TYPE "ProductEventType" AS ENUM ('AI_INSIGHT_REQUESTED', 'AI_INSIGHT_GENERATED', 'AI_INSIGHT_FAILED', 'AI_RECOMMENDATION_ACCEPTED', 'AI_RECOMMENDATION_DISMISSED', 'AI_NOTE_CREATED', 'AI_FOLLOW_UP_CREATED', 'AI_REPLY_COPIED');

-- CreateTable
CREATE TABLE "ConversationAiInsight" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "model" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "customerNeed" TEXT NOT NULL,
    "riskLevel" "Priority" NOT NULL,
    "riskReasons" JSONB NOT NULL,
    "escalationRecommended" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" TEXT,
    "suggestedDepartment" "Department",
    "suggestedNextAction" TEXT NOT NULL,
    "suggestedReply" TEXT,
    "suggestedTaskTitle" TEXT,
    "confidence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "ConversationAiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "type" "ProductEventType" NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "aiInsightId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationAiInsight_conversationId_createdAt_idx" ON "ConversationAiInsight"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationAiInsight_riskLevel_createdAt_idx" ON "ConversationAiInsight"("riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "ProductEvent_type_createdAt_idx" ON "ProductEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ProductEvent_conversationId_createdAt_idx" ON "ProductEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductEvent_aiInsightId_idx" ON "ProductEvent"("aiInsightId");

-- AddForeignKey
ALTER TABLE "ConversationAiInsight" ADD CONSTRAINT "ConversationAiInsight_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAiInsight" ADD CONSTRAINT "ConversationAiInsight_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_aiInsightId_fkey" FOREIGN KEY ("aiInsightId") REFERENCES "ConversationAiInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
