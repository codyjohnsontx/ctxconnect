/**
 * What the composer does with the send route's answer. Pure, so the one case
 * the composer cannot reproduce on a laptop - a request that never came back -
 * is decided somewhere a test can reach.
 */

/** A send with no answer is not proof nothing went out, so this does not claim it. */
export const UNCONFIRMED_SEND = "Attend could not confirm this text was sent. Check the thread before sending it again.";

export type SendAnswer = {
  ok: boolean;
  payload: { error?: string; deliveryUnknown?: boolean } | null;
};

export type SendOutcome = {
  error: { message: string; deliveryUnknown: boolean } | null;
  /** True when the text may already be with the customer, so it must not wait in the box for a second press. */
  clearDraft: boolean;
};

/**
 * `answer` is null when the request itself rejected. That cannot tell a
 * request that never left from one Twilio sent and whose answer was lost on
 * the way back, so it is treated as unknown, the same as the route saying so.
 * A text sent twice is worse than one retyped.
 */
export function sendOutcome(answer: SendAnswer | null): SendOutcome {
  if (!answer) {
    return { error: { message: UNCONFIRMED_SEND, deliveryUnknown: true }, clearDraft: true };
  }

  if (answer.ok) {
    return { error: null, clearDraft: true };
  }

  const deliveryUnknown = Boolean(answer.payload?.deliveryUnknown);

  return {
    error: { message: answer.payload?.error ?? UNCONFIRMED_SEND, deliveryUnknown },
    clearDraft: deliveryUnknown,
  };
}
