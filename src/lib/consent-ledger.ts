import type { ConsentEventKind, Prisma } from "@/generated/prisma/client";
import { ConsentMethod } from "@/generated/prisma/enums";
import { consentMethodRules, consentState } from "@/lib/consent";

type StaffRecordedMethod =
  | typeof ConsentMethod.STAFF_RECORDED_REQUEST
  | typeof ConsentMethod.VERBAL_AT_COUNTER
  | typeof ConsentMethod.WRITTEN_FORM
  | typeof ConsentMethod.STAFF_CORRECTION;

type Common = {
  customerId: string;
  kind: ConsentEventKind;
  /** When the customer acted. For a text, the inbound message's own createdAt. */
  occurredAt: Date;
  messageId?: string | null;
  providerRef?: string | null;
};

/**
 * What an event must carry. A staff-recorded method does not compile without
 * the person recording it and what the customer said or signed; the database
 * refuses the same row by CHECK constraint.
 */
export type ConsentEventInput =
  | (Common & { method: StaffRecordedMethod; recordedByUserId: string; evidence: string })
  | (Common & {
      method: Exclude<ConsentMethod, StaffRecordedMethod>;
      recordedByUserId?: null;
      evidence?: string | null;
    });

/**
 * The only writer of a `ConsentEvent`, and the only writer of the cache on
 * `Customer`. It runs inside the caller's transaction so the event, the cache
 * and whatever the event is evidence of (the inbound text) commit together.
 *
 * The customer row is locked first, so two events for one customer - a STOP
 * and a START landing together - are recorded one after the other and the
 * cache is recomputed over a ledger that includes both. The cache is the
 * ledger's own answer from `consentState`, not the kind of the row just
 * written: an event recorded late for something the customer did earlier does
 * not outrank what they did since.
 */
export async function recordConsentEvent(tx: Prisma.TransactionClient, input: ConsentEventInput) {
  const rule = consentMethodRules[input.method];

  if (!rule.kinds.includes(input.kind)) {
    throw new Error(`A ${input.method} consent event cannot record ${input.kind}.`);
  }

  if (rule.staffRecorded && (!input.recordedByUserId || !input.evidence?.trim())) {
    throw new Error(`A ${input.method} consent event needs the person recording it and the evidence.`);
  }

  await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE "id" = ${input.customerId} FOR UPDATE`;

  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: input.customerId },
    select: { phone: true },
  });

  const event = await tx.consentEvent.create({
    data: {
      customerId: input.customerId,
      phone: customer.phone,
      kind: input.kind,
      method: input.method,
      messageId: input.messageId ?? null,
      recordedByUserId: input.recordedByUserId ?? null,
      evidence: input.evidence ?? null,
      occurredAt: input.occurredAt,
      providerRef: input.providerRef ?? null,
    },
  });

  const state = consentState(
    await tx.consentEvent.findMany({
      where: { customerId: input.customerId, channel: event.channel },
      select: { id: true, channel: true, kind: true, method: true, occurredAt: true, createdAt: true },
    }),
    event.channel,
  );

  await tx.customer.update({
    where: { id: input.customerId },
    data: { smsConsent: state.status, smsConsentEventId: state.event?.id ?? null },
  });

  return { event, state };
}

/** The status a customer is at right now, read under the same lock the writer takes. */
export async function lockedConsentStatus(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$executeRaw`SELECT 1 FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;

  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { smsConsent: true },
  });

  return customer.smsConsent;
}
