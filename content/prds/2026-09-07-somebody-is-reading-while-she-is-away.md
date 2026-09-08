# PRD: Somebody Is Reading While She Is Away

## Status

Built

## Date

2026-09-07

## Owner

Cody Johnson

## Summary

A service advisor goes on holiday, or leaves, or has her account switched off,
and her open conversations stay assigned to her. Nothing moves them, so the
customers in those threads are mid-conversation with somebody who is not
reading, and they are not told. This adds coverage: her open conversations can
be handed to an active colleague, either while she is away or for good, and when
she comes back the quiet ones come back with her.

## Problem

Attend's whole claim is that it reads every conversation a service advisor has
and tells her what to do next. It has no idea what to do when there is no
advisor.

Deactivation, shipped in
[Deactivation Ends the Session](./2026-08-12-deactivation-ends-the-session.md),
ends the person's access and deliberately stops there. The conversations stay
where they were. What happens next depends entirely on luck:

* A thread in her own department is still reachable by her colleagues in it, but
  it carries her name, and every alert on it is addressed to her - and a
  `Notification` row is stored once per recipient, so those alerts are now in
  nobody's rail.
* A thread routed to a department nobody else works is reachable by **no one**.
  Reproduced end to end before any of this was written: with the service advisor
  switched off, her seven open conversations stayed assigned to her, and the one
  filed under `GENERAL` returned a 404 to every other advisor on the floor while
  her own session was correctly refused.

The customer sees none of this. They sent a text and nobody answered.

## Target User

The service advisor, both ways round:

* the one going away, who wants to leave on Friday knowing her customers are
  covered;
* the one covering, who needs those threads to actually arrive - in her queue
  and in her alert rail, not merely be technically openable.

The admin is the third party, and the only one who can act when somebody has
already gone.

## Goal

No open conversation is left with nobody reading it, and no customer experiences
two changes of voice where one would do.

## Background

The owner framed this as coverage, not termination: build it as though somebody
is on vacation, not only as though they were fired. That is not tone, it is the
design. Firing is permanent. A holiday ends, and the advisor comes back and
wants her book back. A feature that only does permanent hand-over cannot serve
the case that prompted it.

## v1 Scope

* An advisor hands her own open conversations to an active colleague before she
  goes. An admin does the same for anyone, including somebody already switched
  off who cannot act at all.
* Only conversations that are still open move. Closed history stays attributed
  to whoever handled it.
* The cover is picked from active staff who are not away themselves.
* Coverage ends one of two ways. **She is back**: everything the cover never
  answered returns to her, and anything the cover has replied to since coverage
  began stays with the cover until it closes. **Leave them with the cover**: the
  trip became a departure and nothing moves.
* A permanent hand-off - no return, no mark - is available to an admin at the
  start too.
* Every move is written to the existing audit log, on the account and on each
  conversation.
* The alerts a thread raises against whoever holds it follow the thread.

## Non-Goals

* **Telling the customer.** Whether a customer should be told their advisor
  changed is a business decision the owner has not made, and Attend must not
  make it by default. Not built.
* **Leave calendars or scheduling.** Coverage starts when somebody says so and
  ends when somebody says so. No dates, no automation.
* **Reassignment analytics.** The audit log answers who handled what and when.
  Nothing reports on it.
* **Follow-ups.** Coverage moves conversations. A follow-up's alerts are
  addressed to the *task's* assignee, and `src/lib/task-access.ts` already lets
  the department work one either way.
* **Deactivation arranging coverage by itself.** Switching an account off would
  then quietly be two decisions, and it would have to fail when nobody suitable
  exists. Settings names the stranded conversations instead and links to the
  coverage board - see the decision log.

## User Flow

**Going away.** The advisor opens Coverage from her account block, picks a
colleague, and presses "While away". Her open conversations move to the
colleague, each with a note in the thread saying who has it and why.

**Being covered.** The colleague finds those conversations in her own queue, and
the alerts that were standing on them in her own rail.

**Coming back.** She opens Coverage and presses "I'm back". Everything her cover
never answered is hers again. Anything the cover replied to stays with the
cover, and the page says so before she presses.

**Somebody who has already gone.** The admin sees the count of stranded
conversations on the Settings row for that account, follows the link, and hands
them to somebody. Handing them *back* later is refused while the account is
still switched off, because that would put them back where they started.

## Requirements

* The cover picker offers only staff who can actually take the work: active, not
  the advisor going away, and not away themselves.
* An advisor may arrange her own coverage and nobody else's. A permanent
  hand-off is the admin's alone.
* The rules the board renders are re-checked by the server action, because a
  form posted from a stale tab is not a form Attend rendered.
* The board and the hand-off count open conversations by one clause.
* Coverage that chains - the cover goes away too - keeps each thread pointed at
  the advisor it actually belongs to, however many hands it passes through.

## User Stories

* As a service advisor, I want to hand my open conversations to a colleague
  before I go on holiday, so that my customers get an answer while I am away.
* As the covering advisor, I want those conversations in my queue and their
  alerts in my rail, so that I can see what is waiting rather than having to be
  told.
* As a returning advisor, I want my quiet conversations back and the ones my
  cover has taken on left alone, so that no customer is handed between two
  people mid-exchange.
* As an admin, I want to see that a deactivated advisor still holds open
  conversations, so that I do not switch somebody off and strand their
  customers.

## Acceptance Criteria

* Given an advisor with open conversations, when she is switched off with no
  coverage, then Settings names how many conversations are on that account and
  says nobody is reading them.
* Given a conversation in a department nobody else works, when it is covered,
  then the covering advisor can open it - and before coverage she could not.
* Given coverage starts, when it is temporary, then each moved conversation
  records the advisor it goes back to; when it is permanent, then it records
  nobody - except a thread that was already covering for somebody else, which
  keeps the mark it was first given and still goes back to her.
* Given a closed conversation, when coverage starts, then it does not move.
* Given the cover has replied to the customer on a thread since coverage began,
  when coverage ends with the advisor returning, then that thread stays with the
  cover and its mark is cleared.
* Given the cover has only left an internal note on a thread, when coverage
  ends, then that thread returns to the advisor - the customer never saw the
  note.
* Given the account is still switched off, when somebody posts the hand-back
  anyway, then it is refused and nothing moves.
* Given coverage ends either way, when it does, then no conversation is left
  carrying a mark and the account's coverage record is cleared.
* Given an alert addressed to the advisor on a thread that moves, when it moves,
  then the alert is addressed to whoever now holds the thread; a follow-up's
  alerts are not.

## Edge Cases

* **Chained coverage.** A covers for B, then A goes away and C takes over.
  Each thread keeps the mark it was first given, so B's thread returns to B
  whenever B comes back, from wherever it has got to. The mark is written once
  and never overwritten. B's account pointer does move: `coveredByUserId` is
  re-pointed at C, because it has to name whoever is holding her threads now,
  and B gets her own `coverage.start` row carrying `chainedFrom` so the trail
  names every cover rather than only the first. Her `coveredSince` stays where
  it was - it is when B's coverage began, not when C took over.
* **A reply that failed to send.** It counts as the cover having taken the
  thread on. The customer never saw it, but the cover is mid-fix with the
  failure banner in front of her, and handing the thread back drops the retry.
* **A reply with no recorded sender.** Not counted. Nothing writes one, and a
  machine is not somebody a customer's thread can be left with.
* **The advisor replies on her own thread during coverage** - reachable through
  her department, or after being switched back on. Her own voice is not somebody
  else covering, so that thread still returns to her.
* **A thread closed during coverage.** It stays where it was closed and only
  loses its mark. Closed history is not re-attributed.
* **Nobody available to cover.** The card says so rather than offering an empty
  picker.
* **Coverage already running.** Starting a second one is refused; end the first.

## Data Requirements

* `User.coveredByUserId`, `User.coveredSince` - who is holding this account's
  conversations and from when. Both are written when coverage begins, or
  neither is: `coveredSince` is the instant the return rule measures a reply
  against, so a cover with no start is a coverage nobody can end correctly.
  After that they part company. `coveredByUserId` follows the threads, so a
  chained hand-off re-points it at whoever is holding them now. `coveredSince`
  stays put, because advancing it would stop counting the earlier cover's
  replies and threads that should stay with a cover would come back instead.
* `Conversation.coveredForUserId` - the advisor a thread goes back to. Set only
  by coverage that can end.
* `AuditLog` - `coverage.start` and `coverage.end` on the account, and
  `conversation.coverageStart` / `coverageReturned` / `coverageAlreadyBack` /
  `coverageNotReturned` on each conversation. The account row answers "who
  covered whom and when"; the conversation rows answer "where did this thread
  go" for one thread months later. `coverageAlreadyBack` is the thread somebody
  reassigned to the returning advisor by hand during coverage, so the return had
  nothing to move. `coverageNotReturned` is everything else, and its name claims
  only that: a thread can end the coverage with the cover, with somebody she
  routed it on to, or with nobody at all, so the row's `heldBy` is the only
  field that names a holder and `null` there means nobody does. `coverage.end`
  counts the three as `returned`, `alreadyBack` and `notReturned`.
* An internal note on each conversation that actually changed hands, matching
  what a manual reassignment already writes.

## Analytics / Success Metrics

No live usage metrics - this is a portfolio product with seeded data. The
intended success signal is that no open conversation is assigned to an inactive
account, which is a state Settings now makes visible on the screen that creates
it. Metric to track after launch: the count of open conversations held by
inactive accounts, which should be zero.

## Risks

* **The return rule is the fragile half.** It runs once per advisor per trip, on
  a page nobody is watching, so a regression would surface months later as a
  customer being handed back and forth. It lives in one tested function,
  `coverageOutcome` in `src/lib/coverage.ts`, and the action loads only the
  coverage window and lets that function decide the rest.
* **Coverage arranged and never ended.** The threads are with somebody who is
  reading them, so the failure mode is a stale record rather than a stranded
  customer. The board shows every running coverage.
* **A thread assigned to an away advisor after coverage started** does not move.
  Rare - it takes a colleague deliberately assigning work to somebody the board
  shows as away - and the thread is still in her department. Filed, not built.

## Open Questions

* Should the assignee picker on a conversation mark an advisor who is currently
  away? It would stop the case above at its source. Not built: it widens a panel
  that has its own reset hazard, and the board already answers the question.

## Implementation Notes

* `src/lib/coverage.ts` holds every rule several surfaces must agree about, free
  of the database client, alongside `conversation-access.ts` and
  `task-access.ts`.
* `/coverage` calls `requireUser()` itself. Next does not re-render a shared
  layout when navigating between routes inside it, so a page that leans on the
  `(app)` layout's guard is not re-guarded on a client-side navigation.
  `tests/coverage.test.ts` scans every page in the segment for its own call.
* The board and the hand-off both count by `openConversationWhere`, written as
  the statuses that *are* open, so a status added to the enum later has to be
  placed deliberately rather than silently joining the hand-off.

## Portfolio Notes

The product decision worth talking about is the return rule. The obvious build
is "she comes back, she gets her conversations back". That is wrong for the
customer: a thread the cover has been answering for a week is a live exchange,
and handing it back is a second change of voice - the same discontinuity the
feature exists to prevent, arriving through the front door. So the rule is
split by evidence: what the cover answered stays with the cover, what she never
touched goes back. An internal note is deliberately not evidence, because the
customer never saw it.

The second is what was left out. Deactivation could have arranged coverage
itself, and it does not: that would make one decision quietly into two, and
force it to fail when nobody suitable exists. Instead the screen that creates
the gap names it. The scope cut that matters most is not telling the customer -
a real product question the owner has not answered, and not one to answer by
default.
