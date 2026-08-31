import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AT_LATEST_TOLERANCE_PX,
  isShowingLatest,
  scrollTopShowingEnd,
  scrollsItself,
  shouldFollowNewMessage,
} from "../src/lib/thread-scroll";

// A thread that runs past the bottom of the screen: the last bubble ends 711px
// below the fold until something scrolls.
const BELOW_THE_FOLD = 711;
const viewportBottom = 826;
const atTop = { contentBottom: viewportBottom + BELOW_THE_FOLD, viewportBottom };

describe("scrollsItself", () => {
  it("recognises the values that make an element its own scroll box", () => {
    for (const overflowY of ["auto", "scroll", "overlay"]) {
      assert.equal(scrollsItself(overflowY), true, overflowY);
    }
  });

  it("does not treat clipping or plain overflow as scrolling", () => {
    // `hidden` and `clip` cut content off rather than offering it, and
    // `visible` lets it spill for something further up the page to scroll. That
    // last one is the phone layout: the conversation is part of the page, so
    // the answer has to come from the page and not from the message list.
    for (const overflowY of ["visible", "hidden", "clip", ""]) {
      assert.equal(scrollsItself(overflowY), false, overflowY);
    }
  });
});

describe("isShowingLatest", () => {
  it("is false at the top of a thread that runs past the fold", () => {
    assert.equal(isShowingLatest(atTop), false);
  });

  it("is true once the end of the thread reaches the fold", () => {
    assert.equal(isShowingLatest({ contentBottom: viewportBottom, viewportBottom }), true);
  });

  it("is false part way back through history", () => {
    assert.equal(
      isShowingLatest({ contentBottom: viewportBottom + BELOW_THE_FOLD / 2, viewportBottom }),
      false,
    );
  });

  it("treats a thread too short to scroll as showing the newest message", () => {
    // The reply box sits under the conversation on a phone, so the last bubble
    // legitimately ends well above the fold while the newest message is on
    // screen.
    assert.equal(isShowingLatest({ contentBottom: viewportBottom - 240, viewportBottom }), true);
  });

  it("survives fractional layout rounding just short of the end", () => {
    // Fractional device pixel ratios leave the last bubble a hair below the
    // fold; that is still the newest message on screen, not history.
    assert.equal(isShowingLatest({ contentBottom: viewportBottom + 0.5, viewportBottom }), true);
  });

  it("counts an over-scroll bounce past the end as showing the newest message", () => {
    // iOS rubber-banding drags the content up past where it can settle.
    assert.equal(isShowingLatest({ contentBottom: viewportBottom - 90, viewportBottom }), true);
  });

  it("holds the tolerance boundary exactly", () => {
    const justInside = viewportBottom + AT_LATEST_TOLERANCE_PX;
    assert.equal(isShowingLatest({ contentBottom: justInside, viewportBottom }), true);
    assert.equal(isShowingLatest({ contentBottom: justInside + 1, viewportBottom }), false);
  });

  it("accepts a caller-supplied tolerance", () => {
    const scrolledBack = { contentBottom: viewportBottom + 200, viewportBottom };
    assert.equal(isShowingLatest(scrolledBack), false);
    assert.equal(isShowingLatest(scrolledBack, 200), true);
  });
});

describe("scrollTopShowingEnd", () => {
  it("moves an unscrolled thread by exactly what hangs below the fold", () => {
    assert.equal(scrollTopShowingEnd(0, atTop), BELOW_THE_FOLD);
  });

  it("adds to a position already scrolled part way", () => {
    // Opening a second conversation from a page that was left scrolled down.
    assert.equal(scrollTopShowingEnd(400, atTop), 400 + BELOW_THE_FOLD);
  });

  it("stays put when the end is already at the fold", () => {
    assert.equal(scrollTopShowingEnd(940, { contentBottom: viewportBottom, viewportBottom }), 940);
  });

  it("never asks for a negative position", () => {
    // A conversation shorter than the screen ends above the fold and has
    // nothing to scroll; asking to scroll up past the start is not an answer.
    assert.equal(scrollTopShowingEnd(0, { contentBottom: viewportBottom - 500, viewportBottom }), 0);
  });

  it("scrolls back up when the end has been left above the fold", () => {
    // Everything below the newest message was removed - a follow-up panel
    // closing, say - so the panel now ends higher than it did.
    assert.equal(
      scrollTopShowingEnd(900, { contentBottom: viewportBottom - 120, viewportBottom }),
      780,
    );
  });
});

describe("shouldFollowNewMessage", () => {
  it("follows a message that arrives while she is at the end of the thread", () => {
    assert.equal(
      shouldFollowNewMessage({ latestChanged: true, wasShowingLatest: true, latestIsHers: false }),
      true,
    );
  });

  it("leaves her where she is when she has scrolled back through history", () => {
    assert.equal(
      shouldFollowNewMessage({ latestChanged: true, wasShowingLatest: false, latestIsHers: false }),
      false,
    );
  });

  it("always follows a reply or note she just wrote herself", () => {
    // Pressing send while scrolled back through history and seeing nothing
    // move is how she comes to doubt the message went out.
    assert.equal(
      shouldFollowNewMessage({ latestChanged: true, wasShowingLatest: false, latestIsHers: true }),
      true,
    );
  });

  it("does not move the box when a re-render brought no new message", () => {
    // Saving conversation controls, closing a follow-up and marking a thread
    // unread all re-render the thread. None of them is a reason to move it,
    // even when the message already at the end is one she wrote.
    for (const wasShowingLatest of [true, false]) {
      for (const latestIsHers of [true, false]) {
        assert.equal(
          shouldFollowNewMessage({ latestChanged: false, wasShowingLatest, latestIsHers }),
          false,
        );
      }
    }
  });
});
