/**
 * Whether a conversation being on screen is the advisor opening it.
 *
 * The component holds one ref: the conversation it has already reported. The
 * subtlety is when that ref gets claimed. Claiming it only on the way to a
 * write leaves it unclaimed for a thread that was already read when she opened
 * it - and then pressing Mark unread flips `unread` back to true, which is a
 * change the effect re-runs on, and the run marks it read again. The press was
 * silently undone: the thread never returned to the unread queue.
 *
 * So arriving at a conversation claims it, whether or not there is anything to
 * write. Kept free of React and of the database so it can be tested directly.
 */

export type ConversationOpening = {
  /** The conversation the component has now reported; goes back into the ref. */
  reported: string;
  /** Whether this is the first time she has had this thread on screen unread. */
  markRead: boolean;
};

export function reportConversationOpen(
  reported: string | null,
  conversationId: string,
  unread: boolean,
): ConversationOpening {
  return { reported: conversationId, markRead: unread && reported !== conversationId };
}
