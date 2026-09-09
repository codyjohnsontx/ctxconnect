/**
 * When a customer has been left waiting, and what counts as somebody seeing to
 * them.
 *
 * The breach alert exists to say one thing: this customer texted, and nobody
 * has attended to them since. Two questions decide it - how long a department
 * is allowed, and whether anything since the customer's last text actually
 * counts as attending to them - and both live here, database-free, because the
 * sweep that asks them runs on a cron with nobody watching and a rule nobody
 * can execute is a rule nobody can check.
 *
 * The second question is the subtle one. A reply obviously counts. So does an
 * advisor's own internal note: "called her, left a voicemail" is somebody doing
 * the work, and an alert that kept shouting through it would be telling a
 * manager to chase a customer who has already been chased.
 *
 * What does not count is a note Attend wrote itself. Handing a conversation to
 * a colleague - an ordinary reassignment, or coverage moving an advisor's whole
 * book while she is away - writes a note on every thread it touches, and none
 * of that is anybody answering the customer. Before `systemGenerated` existed,
 * arranging coverage withdrew the breach alert on exactly the threads it was
 * raised for, at the moment a manager most needed them.
 *
 * So the test is not OUTBOUND-versus-INTERNAL, which would have thrown away the
 * voicemail note along with the bookkeeping. It is **a person recording action**
 * against **the system recording an event**, and that distinction is a fact
 * about the row rather than something the shape of the message can imply.
 * Background: content/decisions/2026-09-09-a-note-attend-wrote-itself-is-not-somebody-answering.md
 */

import { Department, MessageDirection } from "@/generated/prisma/enums";

/** How long a department may leave a customer waiting before it is a breach. */
export function slaMinutesForDepartment(department: Department) {
  switch (department) {
    case Department.SALES:
      return 15;
    case Department.SERVICE:
      return 120;
    case Department.PARTS:
      return 240;
    case Department.FINANCE:
    case Department.GENERAL:
      return 60;
  }
}

/** One message, as much of it as the rule below reads. */
export type AttendedMessage = {
  createdAt: Date;
  direction: string;
  /** True when Attend wrote the row itself - see the note above. */
  systemGenerated: boolean;
};

/**
 * Whether anybody has attended to this customer since their last message.
 *
 * Takes the messages rather than a database filter, the same way
 * `coverageOutcome` does and for the same reason: the rule is then one function
 * that can be run in a test, instead of a `where` clause that can only be read.
 * The caller loads the thread; this decides.
 */
export function attendedSinceInbound(
  latestInboundAt: Date,
  messages: ReadonlyArray<AttendedMessage>,
): boolean {
  return messages.some((message) => {
    if (message.createdAt <= latestInboundAt) {
      return false;
    }

    if (message.direction === MessageDirection.OUTBOUND) {
      return true;
    }

    return message.direction === MessageDirection.INTERNAL && !message.systemGenerated;
  });
}
