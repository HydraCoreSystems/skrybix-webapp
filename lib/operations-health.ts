import { computeCommerceHandoffHealth, type CommerceHandoffRecord } from "@/lib/commerce-health";

export type OperationsHealthInput = {
  commerceRecords: readonly CommerceHandoffRecord[];
  soldActiveCuttingIds: readonly string[];
  archivedCuttingIds: readonly string[];
  outgoingCuttingIds: readonly string[];
  now?: Date;
};

export type OperationsHealth = {
  commerce: ReturnType<typeof computeCommerceHandoffHealth>;
  soldAwaitingDisposition: string[];
  archivedWithoutOutgoing: string[];
  outgoingWithoutArchive: string[];
  attentionCount: number;
  integrityIssueCount: number;
};

export function computeOperationsHealth(input: OperationsHealthInput): OperationsHealth {
  const archived = new Set(input.archivedCuttingIds);
  const outgoing = new Set(input.outgoingCuttingIds);
  const archivedWithoutOutgoing = [...archived].filter((id) => !outgoing.has(id)).sort();
  const outgoingWithoutArchive = [...outgoing].filter((id) => !archived.has(id)).sort();
  const soldAwaitingDisposition = [...new Set(input.soldActiveCuttingIds)].sort();
  const commerce = computeCommerceHandoffHealth(input.commerceRecords, input.now);
  const integrityIssueCount = archivedWithoutOutgoing.length + outgoingWithoutArchive.length;

  return {
    commerce,
    soldAwaitingDisposition,
    archivedWithoutOutgoing,
    outgoingWithoutArchive,
    integrityIssueCount,
    attentionCount: integrityIssueCount + commerce.waitingLongCount + soldAwaitingDisposition.length,
  };
}

export function latestTimestamp(values: readonly (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms) && ms > latestMs) {
      latest = value;
      latestMs = ms;
    }
  }
  return latest;
}
