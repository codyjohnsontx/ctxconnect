-- Keep the first event for each insight-scoped event type before enforcing idempotency.
DELETE FROM "ProductEvent" duplicate
USING "ProductEvent" keeper
WHERE duplicate."aiInsightId" IS NOT NULL
  AND keeper."aiInsightId" = duplicate."aiInsightId"
  AND keeper."type" = duplicate."type"
  AND (
    keeper."createdAt" < duplicate."createdAt"
    OR (
      keeper."createdAt" = duplicate."createdAt"
      AND keeper."id" < duplicate."id"
    )
  );

-- Postgres allows multiple NULL values, so request/failure events without an insight remain repeatable.
-- Prisma PostgreSQL migrations are not wrapped in a transaction by default; do not add BEGIN/COMMIT here.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProductEvent_type_aiInsightId_key" ON "ProductEvent"("type", "aiInsightId");
