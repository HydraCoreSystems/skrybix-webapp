// GM Commerce handoff health -- pure bucketing logic, no Supabase/Next
// runtime, so it's directly testable (same pattern as lib/cuttings-batch.ts).
//
// Reads only the two timestamp columns every commerce-selectable record
// already has (commerce_selected_at/commerce_acknowledged_at, present on
// both cuttings and mother_plants -- see supabase/schema.sql). No new
// columns, no change to the GM Commerce API contract
// (isCommerceExportRequestAuthorized, /api/commerce/v1/plants) at all --
// this is Phil's own internal visibility into the existing narrow
// authenticated handoff, not a new integration surface.
//
// "Actionable failure" is deliberately not a bucket here: there is no
// failure-tracking column anywhere in this schema to source one honestly
// from, and fabricating a status would be exactly the kind of believable-
// but-wrong state this reliability phase is trying to remove. Deferred as
// a beta follow-up (a real durable event/failure log) rather than faked.

export type CommerceHandoffRecord = {
  sourceRecordId: string;
  plantRecordType: "cutting" | "mother";
  commerceSelectedAt: string | null;
  commerceAcknowledgedAt: string | null;
};

export const HANDOFF_WAITING_LONG_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

export type CommerceHandoffHealth = {
  waitingCount: number;
  waitingLongCount: number;
  acknowledgedCount: number;
  /** Waiting records at/over the threshold, oldest selection first. */
  waitingLongRecords: CommerceHandoffRecord[];
};

export function computeCommerceHandoffHealth(
  records: readonly CommerceHandoffRecord[],
  now: Date = new Date()
): CommerceHandoffHealth {
  let waitingCount = 0;
  let acknowledgedCount = 0;
  const waitingLongRecords: CommerceHandoffRecord[] = [];

  for (const record of records) {
    if (record.commerceAcknowledgedAt) {
      acknowledgedCount++;
      continue;
    }
    if (!record.commerceSelectedAt) {
      // Not yet selected -- not part of the handoff at all.
      continue;
    }
    waitingCount++;
    const waitedMs = now.getTime() - new Date(record.commerceSelectedAt).getTime();
    if (waitedMs >= HANDOFF_WAITING_LONG_THRESHOLD_MS) {
      waitingLongRecords.push(record);
    }
  }

  waitingLongRecords.sort(
    (a, b) => new Date(a.commerceSelectedAt as string).getTime() - new Date(b.commerceSelectedAt as string).getTime()
  );

  return {
    waitingCount,
    waitingLongCount: waitingLongRecords.length,
    acknowledgedCount,
    waitingLongRecords,
  };
}
