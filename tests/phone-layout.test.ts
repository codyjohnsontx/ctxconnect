import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// Three things a service advisor needs on the shop floor that the wide layout
// hid, each of them a class list rather than a function: the conversation has to
// fill the phone, the account she is texting from has to be reachable, and the
// controls that narrow the queue have to get out of the queue's way. Nothing
// here can be asserted from a pure module, and all three broke silently on a
// screen no one was looking at, so they are pinned where they live.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

/** Only the utilities that apply below `lg`, which is what a phone gets. */
function phoneClasses(classList: string) {
  return classList.split(/\s+/).filter((name) => name && !name.includes(":"));
}

describe("the conversation fills the phone", () => {
  const inboxView = read("src", "components", "inbox-view.tsx");
  const messageList = /<ThreadMessages[\s\S]*?className="([^"]*)"/.exec(inboxView)?.[1];

  it("renders the thread through the box that owns its scroll position", () => {
    assert.ok(messageList, "inbox-view.tsx no longer renders <ThreadMessages>");
  });

  it("does not cap the height of the message list on a phone", () => {
    // A `max-h-[34dvh]` here gave a 390x844 screen a 287px porthole onto the
    // thread, scrolling inside a page that scrolled separately.
    assert.deepEqual(
      phoneClasses(messageList ?? "").filter((name) => name.startsWith("max-h-")),
      [],
    );
  });

  it("only makes the message list its own scroll box from lg up", () => {
    // On a phone the conversation is part of the page. Two nested scrollers is
    // what put a scrollbar inside a scrollbar.
    assert.deepEqual(
      phoneClasses(messageList ?? "").filter((name) => name.startsWith("overflow-")),
      [],
    );
    assert.ok(
      (messageList ?? "").includes("lg:overflow-y-auto"),
      "the wide layout's thread column should still scroll itself",
    );
  });
});

describe("the phone knows whose shift it is", () => {
  const appShell = read("src", "components", "app-shell.tsx");
  const mobileBar = appShell.slice(appShell.indexOf("lg:hidden"));

  it("puts the account menu in the bar the phone actually shows", () => {
    // The sidebar that names the account and offers sign out is `hidden lg:flex`,
    // so on a phone the advisor could neither see whose account was sending the
    // texts nor leave it.
    assert.ok(mobileBar.includes("<AccountMenu"), "the mobile bar has no account cell");
  });

  it("offers sign out from that menu", () => {
    assert.ok(read("src", "components", "account-menu.tsx").includes("<SignOutButton"));
  });

  it("names sign out rather than showing a bare icon", () => {
    // The label used to be `hidden lg:inline`, which is invisible in the only
    // place a phone can reach it.
    const label = /<span[^>]*>Sign out<\/span>/.exec(read("src", "components", "sign-out-button.tsx"));
    assert.ok(label, "sign-out-button.tsx no longer labels itself");
    assert.ok(!label[0].includes("hidden"), `sign out is hidden on a phone: ${label[0]}`);
  });
});

describe("the inbox filters get out of the queue's way", () => {
  const inboxView = read("src", "components", "inbox-view.tsx");
  const toggle = /htmlFor="inbox-filters-toggle"[\s\S]*?className="([^"]*)"/.exec(inboxView)?.[1];
  const panel = /id="inbox-filters" className="([^"]*)"/.exec(inboxView)?.[1];

  it("collapses the controls on a phone", () => {
    assert.ok(panel, "the filter controls are no longer in a collapsible panel");
    assert.ok(
      phoneClasses(panel ?? "").includes("hidden"),
      "the filter controls should start collapsed on a phone",
    );
    assert.ok((panel ?? "").includes("peer-checked:block"), "the toggle should open them");
  });

  it("leaves the wide layout's controls on screen", () => {
    // The 390px rail has room for the controls and the queue together, so the
    // collapse is a phone answer to a phone problem.
    assert.ok(toggle, "the filter toggle is gone");
    assert.ok(
      (toggle ?? "").includes("lg:hidden"),
      "the toggle should not appear in the wide layout",
    );
    assert.ok((panel ?? "").includes("lg:block"), "the wide layout should show the controls");
  });

  it("keeps no control the form cannot show", () => {
    // A filter with no control in the form must not be carried forward behind
    // her back: submitting the visible controls sets the queue to what is on
    // screen, and Clear filters is the way out of the rest.
    assert.equal(/<input type="hidden" name="priority"/.test(inboxView), false);
  });
});
