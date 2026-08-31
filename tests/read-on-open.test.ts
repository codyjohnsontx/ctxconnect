import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportConversationOpen } from "../src/lib/read-on-open";

// The defect this pins, driven end to end against the app before the fix:
// opening Grant Delaney's thread, which was already read on arrival, and
// pressing Mark unread logged `markConversationUnread` immediately followed by
// `markConversationRead` for the same conversation. The row stayed
// `unread = f` and /inbox?unread=true listed nothing, so the press she had just
// made was silently undone. Pressing it on a thread that had arrived unread
// worked, which is why a happy-path walkthrough misses this.

/**
 * One mount of MarkReadOnOpen: React runs the effect on mount and again on
 * every render where `unread` changed, and the ref survives between the runs.
 */
function mountThread(conversationId: string) {
  let reported: string | null = null;
  const reads: string[] = [];

  return {
    reads,
    /** A render of the thread with this unread state. */
    render(unread: boolean) {
      const opening = reportConversationOpen(reported, conversationId, unread);

      reported = opening.reported;

      if (opening.markRead) {
        reads.push(conversationId);
      }
    },
  };
}

describe("opening a conversation is what marks it read", () => {
  it("marks a thread she opened unread", () => {
    const thread = mountThread("conv-1");

    thread.render(true);

    assert.deepEqual(thread.reads, ["conv-1"]);
  });

  it("does not mark a thread that was already read when she opened it", () => {
    const thread = mountThread("conv-1");

    thread.render(false);

    assert.deepEqual(thread.reads, []);
  });

  // The revert itself, on the thread that arrived read.
  it("leaves Mark unread standing on a thread that was already read", () => {
    const thread = mountThread("conv-1");

    thread.render(false); // opened, nothing to clear
    thread.render(true); // Mark unread pressed

    assert.deepEqual(thread.reads, [], "the press was undone by a second read");
  });

  it("leaves Mark unread standing on a thread she opened unread", () => {
    const thread = mountThread("conv-1");

    thread.render(true); // opened unread -> marked read
    thread.render(false); // the re-render that read produced
    thread.render(true); // Mark unread pressed

    assert.deepEqual(thread.reads, ["conv-1"]);
  });

  it("marks each thread she moves to, once", () => {
    let reported: string | null = null;
    const reads: string[] = [];

    for (const [conversationId, unread] of [
      ["conv-1", true],
      ["conv-1", false],
      ["conv-2", true],
      ["conv-2", false],
      ["conv-1", true], // she came back, and it is unread again
    ] as const) {
      const opening = reportConversationOpen(reported, conversationId, unread);

      reported = opening.reported;

      if (opening.markRead) {
        reads.push(conversationId);
      }
    }

    assert.deepEqual(reads, ["conv-1", "conv-2", "conv-1"]);
  });
});
