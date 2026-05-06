-- Convert existing transactions from UTC to local time (BR -3)
-- Only convert CONFIRMED transactions; skip PENDING transactions as they haven't been finalized
UPDATE "Transaction"
SET "date" = "date" - INTERVAL '3 hours'
WHERE "status" = 'CONFIRMED'
  AND "parentTransactionId" IS NULL;  -- Skip recurrence child transactions

-- Convert existing account balances from UTC to local time (BR -3)
UPDATE "AccountBalance"
SET "date" = "date" - INTERVAL '3 hours';
