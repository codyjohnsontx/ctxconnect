/**
 * What the Conversation controls panel shows, and whether there is anything to
 * save.
 *
 * The panel used to be four uncontrolled selects inside a plain
 * `<form action={...}>`, which React resets once the action resolves. The reset
 * restores the values the selects were mounted with, not the ones that were
 * just saved, so a successful save visibly snapped back - and pressing Save a
 * second time, which is exactly what that looks like it needs, posted the
 * mounted values over the real ones. The advisor's change was undone and
 * nothing on screen said so.
 *
 * These are the two rules that close that: the panel adopts whatever the server
 * last told it, and Save is offered only while the panel and the server
 * disagree. Kept free of React and of the database so both can be tested
 * directly.
 */

export type ConversationControlValues = {
  /** `unassigned` rather than null, because that is what the picker posts. */
  assignedUserId: string;
  status: string;
  priority: string;
  department: string;
};

/** The panel's own state: what the server last said, and what she has picked since. */
export type ConversationControlsState = {
  /** The server values this panel last adopted. */
  snapshot: ConversationControlValues;
  /** What the selects are showing right now. */
  draft: ConversationControlValues;
};

export function sameControlValues(a: ConversationControlValues, b: ConversationControlValues) {
  return (
    a.assignedUserId === b.assignedUserId &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.department === b.department
  );
}

/**
 * Take the values the server just rendered.
 *
 * A save that landed, or a change a colleague made to the same thread, arrives
 * as a new `saved`. Adopting it into both halves is what stops the panel ever
 * showing a value the database does not hold - which is the only way a later
 * press could write a stale one back.
 */
export function adoptSavedValues(
  state: ConversationControlsState,
  saved: ConversationControlValues,
): ConversationControlsState {
  if (sameControlValues(state.snapshot, saved)) {
    return state;
  }

  return { snapshot: saved, draft: saved };
}

export type HandOffReason = "department" | "assignment";

/** The two reasons, for checking one that arrived on a URL against them. */
export const handOffReasons: readonly HandOffReason[] = ["department", "assignment"];

/**
 * Why a save takes the thread out of the reach of the person making it.
 * `department` when it is genuinely moving to another department, and
 * `assignment` when the department is unchanged and it was the assignment that
 * held it - which is how a staff account with no department of its own reaches
 * any thread at all.
 *
 * Both the warning before the click and the queue banner after it have to say
 * which, because telling her the thread was handed to the department it already
 * sits in is not true. They read it from here, off whatever pair each of them
 * has - the panel its draft against the server's values, the action the row it
 * wrote against the row it read - so the two surfaces cannot describe the same
 * save differently.
 */
export function handOffReason(
  next: { department: string },
  previous: { department: string },
): HandOffReason {
  return next.department === previous.department ? "assignment" : "department";
}

/**
 * Whether Save has anything to do. Offered only against the server's own
 * values, so a panel that agrees with the database cannot submit at all.
 */
export function hasUnsavedControlChanges(
  state: ConversationControlsState,
  saved: ConversationControlValues,
) {
  return !sameControlValues(state.draft, saved);
}
