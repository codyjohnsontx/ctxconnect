import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adoptSavedValues,
  type ConversationControlValues,
  hasUnsavedControlChanges,
  sameControlValues,
} from "../src/lib/conversation-controls-state";

// The defect these pin, driven end to end against the app before the fix: with
// Renee Whitlock's thread at URGENT, picking Low and pressing Save wrote LOW to
// the database and snapped the select back to Urgent. Pressing Save again -
// which is exactly what a panel showing the old value looks like it needs -
// posted URGENT over the LOW that had just been saved, and nothing on screen
// said the change had been undone.
//
// So there are two things to hold: the panel must never show a value the
// database does not hold, and Save must have nothing to submit while the two
// agree.

const urgent: ConversationControlValues = {
  assignedUserId: "advisor-1",
  status: "WAITING_ON_STAFF",
  priority: "URGENT",
  department: "SERVICE",
};

const low: ConversationControlValues = { ...urgent, priority: "LOW" };

/** One press of Save, as the panel does it: post the draft, then re-render with what the server now holds. */
function saveAndRerender(state: { snapshot: ConversationControlValues; draft: ConversationControlValues }) {
  const posted = state.draft;

  return { posted, next: adoptSavedValues(state, posted) };
}

describe("the controls panel and the database cannot disagree", () => {
  it("shows the values that were just saved, not the ones it mounted with", () => {
    const mounted = { snapshot: urgent, draft: urgent };
    const edited = { ...mounted, draft: low };

    const { posted, next } = saveAndRerender(edited);

    assert.equal(posted.priority, "LOW");
    assert.deepEqual(next.draft, low, "the panel snapped back to the mounted value");
    assert.deepEqual(next.snapshot, low);
  });

  it("offers nothing to save once the panel agrees with the server", () => {
    const afterSave = adoptSavedValues({ snapshot: urgent, draft: low }, low);

    assert.equal(hasUnsavedControlChanges(afterSave, low), false);
  });

  // The revert itself. Before the fix the second press was reachable and posted
  // the stale value; after it, there is no second press to make.
  it("cannot post a stale value by pressing Save twice", () => {
    let state = { snapshot: urgent, draft: low };
    const writes: string[] = [];

    for (let press = 0; press < 2; press += 1) {
      if (!hasUnsavedControlChanges(state, state.snapshot)) {
        continue;
      }

      const { posted, next } = saveAndRerender(state);
      writes.push(posted.priority);
      state = next;
    }

    assert.deepEqual(writes, ["LOW"], "a second press wrote the pre-save value back over the saved one");
  });

  it("takes over a change somebody else made to the same thread", () => {
    const elsewhere: ConversationControlValues = { ...urgent, status: "CLOSED" };

    const next = adoptSavedValues({ snapshot: urgent, draft: urgent }, elsewhere);

    assert.deepEqual(next.draft, elsewhere);
    assert.equal(hasUnsavedControlChanges(next, elsewhere), false);
  });

  it("leaves an in-progress edit alone while the server has not moved", () => {
    const edited = { snapshot: urgent, draft: low };

    assert.equal(adoptSavedValues(edited, urgent), edited);
    assert.equal(hasUnsavedControlChanges(edited, urgent), true);
  });

  it("compares every field the panel can change", () => {
    for (const field of ["assignedUserId", "status", "priority", "department"] as const) {
      const changed = { ...urgent, [field]: "something-else" };

      assert.equal(sameControlValues(urgent, changed), false, `${field} was not compared`);
    }
  });
});
