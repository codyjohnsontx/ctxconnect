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
  trip became a departure and nearly everything stays where it is - except a
  thread nobody is holding, and one back on the departing advisor's own account
  after it has been switched off, which both go to the cover rather than being
  finalised onto somebody who is not reading.
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
* Coverage that chains - the cover goes away too - moves the threads on and
  re-points the account pointer at whoever is holding them now, and a thread
  already marked for an advisor keeps that mark rather than being re-marked for
  the cover handing it on. What one mark cannot record is a second claim on the
  same thread; see Open Questions.

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
  keeps the mark it was first given, so her own return still decides it.
* Given a closed conversation, when coverage starts, then it does not move.
* Given the cover has replied to the customer on a thread since coverage began,
  when coverage ends with the advisor returning, then that thread stays with the
  cover and its mark is cleared.
* Given the cover has only left an internal note on a thread, when coverage
  ends, then that thread returns to the advisor - the customer never saw the
  note.
* Given a covered thread somebody reassigned to a third person during coverage,
  when coverage ends with the advisor returning, then it stays with that person
  whether or not anyone has replied.
* Given a covered thread nobody is assigned to, when coverage ends with the
  advisor returning, then it goes to her even if the cover had replied - there is
  no cover holding it for it to stay with.
* Given the account is still switched off, when somebody posts the hand-back
  anyway, then it is refused and nothing moves.
* Given any account holding one of the covered conversations has been switched
  off during the coverage, when somebody tries to leave the conversations with
  the cover, then it is refused and nothing moves - the board disables the button
  and names the account, and the action refuses a stale post with the same
  sentence. The one exception is the advisor this coverage is *for*: a thread a
  manager routed back to her by hand goes to the cover, because "leave them with
  the cover" plainly means her threads, and refusing it left a coverage whose two
  endings were both disabled - the hand-back because she cannot read, and this
  one because she was a holder who cannot read. Every other switched-off holder
  still refuses: a thread given to a colleague deliberately is not the cover's to
  inherit, and reactivating that colleague or arranging cover for her are both
  reachable, because her own card shows the start form.
* Given a covered conversation whose holder has been switched off, when the
  advisor returns, then it comes back to her rather than staying put - whether
  the holder was the cover or somebody a manager routed it to.
* Given coverage ends either way, when it does, then no conversation is left
  carrying a mark and the account's coverage record is cleared.
* Given an alert addressed to the advisor on a thread that moves, when it moves,
  then the alert is addressed to whoever now holds the thread; a follow-up's
  alerts are not.

## Edge Cases

* **Chained coverage.** A covers for B, then A goes away and C takes over.
  Each thread keeps the mark it was first given, so B's own return is what
  decides it, from wherever it has got to: it comes back to her unless the cover
  now holding it has answered the customer herself, in which case it stays with
  that cover. A thread A answered before leaving goes back to B, because only the
  cover's own reply keeps a thread and C never spoke to that customer - so the
  customer hears the voice they had originally rather than a third one. What the
  single mark cannot record is A's claim on it; A's own return does not reclaim
  it. That is the accepted limitation under Open Questions. The mark is written
  once and never overwritten. B's account pointer does move: `coveredByUserId` is
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
* **A covered thread routed to somebody else during coverage.** A manager can
  hand a covered thread to a parts specialist, and reassigning it does not clear
  its mark. It stays with them when the advisor returns: they were given it
  deliberately, and an advisor walking back in must not silently undo that -
  unless that account has since been switched off, in which case the thread comes
  back to her. A routing decision to an account nobody can sign in as is not a
  live decision, and coverage is about to clear the mark that would otherwise
  have brought the thread back.
* **A covered thread with no assignee.** Reachable from the picker's explicit
  unassigned option and from deleting a staff account, whose threads the foreign
  key nulls. It goes to somebody whichever way coverage ends, because a thread
  belonging to nobody is the state this feature exists to end: to the returning
  advisor on the hand-back, whatever the reply rule says, and to the cover when
  the coverage is left with her, which is what that button says it does.
* **Nobody available to cover.** The card says so rather than offering an empty
  picker.
* **Coverage already running.** Starting a second one is refused; end the first.

* **A breach alert on a thread coverage moves.** It stays open. Handing a
  conversation to a colleague is not somebody answering the customer, so the
  note Attend writes while moving it is marked `systemGenerated` and the breach
  rule skips it. An internal note *a person* types still clears the alert - that
  advisor did the work. See
  [the decision](../decisions/2026-09-09-a-note-attend-wrote-itself-is-not-somebody-answering.md).
* **Two coverages posted at once for the same advisor.** The second is refused.
  Both pointer writes are conditional on the state the transaction read, so a
  double click or two admins on the board cannot leave her pointed at one cover
  while her threads sit with another, and cannot write a `coverage.end` row
  claiming nothing moved. The conversation moves are guarded the same way and
  counted - scoped to the threads still on the account they were read from, and
  refused outright if any of them moved in between - which is what covers the
  permanent hand-off, since it writes no pointer to guard on.

## Data Requirements

* `User.coveredByUserId`, `User.coveredSince` - who is holding this account's
  conversations and from when. Both are written when coverage begins, or
  neither is: `coveredSince` is the instant the return rule measures a reply
  against, so a cover with no start is a coverage nobody can end correctly.
  After that they part company. `coveredByUserId` follows the threads, so a
  chained hand-off re-points it at whoever is holding them now. `coveredSince`
  stays put: it is when this advisor's own trip began, and only the cover now
  holding a thread has her replies counted, so advancing it to a chained
  hand-off would drop one she sent on that thread before it reached her and hand
  back a conversation the customer has already heard her on.
* `Conversation.coveredForUserId` - the advisor a thread goes back to. Set only
  by coverage that can end. It is the mark, never the answer to "who is reading
  this": a hand-reassignment deliberately leaves it in place, so the covered
  line on the board counts each thread's real `assignedUserId` instead
  (`describeCoveredThreads`), names anybody a thread has been routed on to, and
  says outright how many nobody is holding. That is a different question from
  `landsOn`, which reports a thread nobody holds as the cover's because that is
  where leaving the coverage with her would put it.
* `AuditLog` - `coverage.start` and `coverage.end` on the account, and
  `conversation.coverageStart` / `coverageReturned` / `coverageAlreadyBack` /
  `coverageNotReturned` on each conversation. The account row answers "who
  covered whom and when"; the conversation rows answer "where did this thread
  go" for one thread months later. `coverageAlreadyBack` is the thread somebody
  reassigned to the returning advisor by hand during coverage, so the return had
  nothing to move. `coverageNotReturned` is everything else, and its name claims
  only that: a thread can end the coverage with the cover, with somebody she
  routed it on to, with nobody at all, or finished while she was away, so the
  row's `heldBy` is the only field that names a holder and `null` there means
  nobody does. `heldBy` is
  always who holds the thread once the action is done, on every row, and a row
  whose thread moved also carries `movedFrom` - the account it came off - so the
  hop can be read back without either value standing in for the other.
  `coverage.end` counts them as `returned`, `alreadyBack`, `closed` and
  `notReturned` - a thread finished during the coverage is counted as `closed`
  rather than folded into `notReturned`, which would read as open customer work
  left with somebody else.
  `coverage.start` counts the advisor's own threads as `conversations` and
  everything the hand-off moved as `movedInTotal`: a thread she was holding for
  somebody else is counted on that advisor's chained row instead, and the two
  numbers differ by whatever was hand-routed to her from an advisor she does not
  cover, which belongs on no account row at all.
* An internal note on each conversation that actually changed hands, matching
  what a manual reassignment already writes. It says the same thing as that
  thread's `conversation.coverageStart` row, because both read one per-thread
  decision: only a thread left carrying no mark is described as handed over for
  good.

* `Message.systemGenerated` - true on the notes Attend writes while a
  conversation changes hands, false on anything a person typed. Two readers: the
  breach rule in `src/lib/sla.ts`, which the column was added for, and the queue
  row's preview include in `src/lib/data.ts`, which leaves these notes out so a
  handed-over book does not arrive as rows all previewing the hand-off - that
  one is written where the query is. Existing rows are false, which reads them
  as human-written; that is deliberate and the reason is beside the migration.

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

* **A thread that passes through two coverages remembers only the first.**
  `Conversation.coveredForUserId` records one advisor, and it is written once
  when a coverage moves an unmarked thread. So when Ben covers Alyssa, answers a
  thread, and then goes away himself and Cara covers him, that thread moves to
  Cara still marked for Alyssa. Ben's claim on it is recorded nowhere. When
  Alyssa returns, the thread goes back to her: Cara is the cover this return is
  ending and Cara never answered this customer, so nothing keeps it away. That
  is the right outcome for the customer - the voice they had before any of this,
  rather than Cara, whom they have never heard from - but it is reached without
  Ben's claim being consulted, because there is nowhere to record it. Ben's own
  return loads only the threads marked for him, so it is not among them, in
  either return order. Had Cara answered the customer herself, it would stay with
  Cara, which is the ordinary rule working inside the second coverage.

  Not fixed here. The fact needed to do it properly - which coverage put this
  thread in this holder's hands - is not persisted, and persisting it (a
  previous-holder column, or a per-hop coverage record) is a schema change
  beyond this task's scope and wants agreement of its own. An attempt that
  inferred it from who had replied was reverted: it could not tell "the cover
  whose coverage moved this thread here" from "an away account that happened to
  reply once", and it wrote fresh coverage marks onto closed history.

  What is not harmed: no conversation is left with nobody, and no customer is
  abandoned. The thread does move a second time, and it moves to the right
  person - back to Alyssa, whose customer it is, rather than staying with a
  cover they have never heard from. What is lost is only Ben's claim on it,
  which nothing recorded. `tests/coverage.test.ts` pins both sides of that
  return: the thread goes back to the advisor it belongs to when the cover
  holding it never answered, and stays with the second cover once she has
  answered the customer herself. It does not pin the ordering: which advisor's
  return can even see the thread is decided by `endConversationCoverage`'s
  loading clause and by the mark-clearing scoped to the same id, and this repo's
  tests are database-free and execute neither.
* **`coveredSince` takes the application's clock, and this entry once said the
  opposite.** RESOLVED 2026-09-09, and recorded here rather than deleted because
  the reasoning that was wrong is the useful part. Between 2026-09-08 and
  2026-09-09 the hand-off read the instant with `SELECT NOW()` inside its own
  transaction, on the stated premise that the other end of the return-window
  comparison, `Message.createdAt`, is assigned by Postgres from
  `DEFAULT CURRENT_TIMESTAMP`. **That premise is false.** `Message.createdAt` is
  `@default(now())`, which Prisma generates and sends, so the column's DDL
  default never fires - a default only fires when the client omits the column,
  and Prisma does not omit it. The read was therefore not removing a
  two-machine comparison, it was introducing one: it put `coveredSince` on the
  database's clock while every message stayed on the application's. Proven by
  writing to a real database rather than by argument - with the session timezone
  set to `Asia/Tokyo`, one hand-off transaction wrote `coveredSince` in JST and
  its own hand-off note's `createdAt` in UTC nine hours apart, and a control
  insert relying on the column's own default came back in JST. Downstream, the
  cover's reply fell below `createdAt >= coveredSince` and the thread she was
  mid-exchange on was handed back to the advisor anyway. The remedy was to
  revert: `new Date()` is back at the write, the `SELECT NOW()` read is gone,
  and both ends of the window are one clock again. There is now nothing here for
  a database-backed test to catch - the two agree by construction rather than by
  a guard - which is a better outcome than the test that was declined for it.
* Should the assignee picker on a conversation mark an advisor who is currently
  away? It would stop the case above at its source. Not built: it widens a panel
  that has its own reset hazard, and the board already answers the question.
* `EndCoverageForm` in `src/app/(app)/coverage/page.tsx` replaces the
  stays-with-the-cover explanation with the inactive-holder note rather than
  adding to it, so an advisor on her own card - who has no "leave them with"
  button - can be shown only "Anything <holder> was holding comes back too...",
  whose "too" has no antecedent, while the rule governing the button she is
  about to press goes unstated. Recorded rather than fixed: display only, and
  the narrower form is to append the note and keep the existing sentence
  whenever the hand-back is still available.
* Should reassigning a covered thread by hand clear its `coveredForUserId` mark,
  so coverage stops tracking a thread somebody has re-owned? We think so, and it
  would retire the already-with-her case entirely. It touches
  `updateConversation`, which every reassignment in the app passes through, so it
  wants its own validation rather than riding along here - see
  [content/decisions/2026-09-08-a-hand-reassignment-should-end-that-thread-s-coverage.md](../decisions/2026-09-08-a-hand-reassignment-should-end-that-thread-s-coverage.md).
  It would not remove the unowned-thread rule: a null assignee also arrives from
  `onDelete: SetNull` when a staff account is deleted.

## Implementation Notes

### Every conditional write in the two coverage actions

Read-then-write gaps were found here five separate times, one at a time, so this
is the map rather than a sixth bug. Prisma runs interactive transactions at Read
Committed: a row read at the top of a transaction can change before the write
that acts on it, and the only checks that survive are the ones in a `where`
clause. Every write below carries a `where`; the unconditional `create` /
`createMany` calls (the in-thread notes and the audit rows) are omitted because
they insert new rows and have nothing to race with, and they are covered by the
row locks the writes above them take.

**`startConversationCoverage`**

| Write | Rule it enforces | Conditions the rule needs | Conditions the clause carries | Verdict |
|---|---|---|---|---|
| `actions.ts:704` (`lockCoverageAccounts`) | Neither the away advisor nor the cover may already be covered when this takes their row locks. | Both rows exist; neither is covered; the cover is active. | `id`, `coveredByUserId: null`, one row at a time in sorted id order. | Complete. `active` is deliberately not here: the re-read plus `coverRefusal` immediately after runs **under** this lock, where a deactivation can no longer land. |
| `actions.ts:871` (assignment move) | Only OPEN threads still on her account move to the cover. | The ids read; still hers; still open. | `id in`, `assignedUserId`, `openConversationWhere`. | Complete. The status clause was added 2026-09-09 - without it a thread closed between the read and this write was reassigned and marked, against the brief. |
| `actions.ts:885` (`coveredForUserId` mark) | Mark only threads this move took, and only ones carrying no earlier mark. | The ids moved; unmarked; still open. | `id in`, `coveredForUserId: null`. | Complete. The status is not repeated because the write above holds the row lock on every one of these ids until commit, so nothing can close them in between. |
| `actions.ts:914` (`rechained` pointers) | Re-point only the advisors this cover genuinely covers. | The ids read; each still covered by *this* away advisor. | `id in`, `coveredByUserId: awayUserId`, count checked. | Complete. |
| `actions.ts:955` (pointer + `coveredSince`) | Record the coverage on an account that is not already covered. | The row; still uncovered. | `id` only. | Complete. The uncovered condition is held by the lock at 704, which refused if it was not; re-asserting it here would be a second copy of the same guard. |
| `notifications.ts:303` (re-address) | Every assignee-addressed alert on the moved threads is addressed to the new holder. | Those threads; those types; any status. | `conversationId in`, `type in`, `recipientUserId: { not: to }`. | Complete. Status is deliberately absent - see the docstring; a resolved row that revives must not revive addressed to somebody who left. |
| `notifications.ts:326` (supersede copies) | Leave one outstanding row per fact per recipient. | The ids chosen from the rows read a statement earlier. | `id in`. | Known gap, recorded not fixed: a row resolved by another transaction between the read and this write is re-resolved, moving its `resolvedAt` later. No surface reads `resolvedAt`, and the row's status is already what this write sets. |

**`endConversationCoverage`**

| Write | Rule it enforces | Conditions the rule needs | Conditions the clause carries | Verdict |
|---|---|---|---|---|
| `actions.ts:1202` (`moveFromHolderRead`) | Move only threads still with the holder the disposition was computed from, and only open ones - both dispositions that move (`returned`, `toTheCover`) require an open thread. | The ids; same holder; still open. | `id in`, `assignedUserId`, `openConversationWhere`, count checked. | Complete. The status clause was added 2026-09-09, same defect as 871. |
| `notifications.ts:159` (`resolveConversationNotificationsTx`) | Withdraw "nobody is holding this" for exactly the threads this ending gave an owner. | Those ids; that one type; only rows not already resolved. | `conversationId in`, `type in`, `status: { not: RESOLVED }`. | Complete. |
| `notifications.ts:303` / `:326` (re-address) | As above, once per recipient in `coverageAlertPlan`'s plan. | As above. | As above. | As above. |
| `actions.ts:1278` (clear the marks) | Every covered thread loses its mark, whichever way this ended. | Exactly the threads carrying this advisor's mark. | `coveredForUserId: returningUserId`. | Complete, and deliberately not scoped to the ids read: it must match the same set the read at the top matched. A thread cannot gain this mark mid-transaction, because writing it needs a hand-off, and a hand-off refuses while this advisor is already covered. |
| `actions.ts:1288` (end the coverage) | End only the coverage this transaction actually read. | The row; still covered by *this* cover. | `id`, `coveredByUserId: cover.id`, count checked. | Complete. |

One gap found beyond the two reported, and it is the `resolvedAt` one above:
recorded rather than fixed, because it moves a timestamp nothing displays.
Every other guard carries its rule's conditions.

**A second known gap, in the counting rather than in a write, recorded not
fixed: a covered thread that is CLOSED and assigned to the returning advisor is
classified `alreadyHers`.** That arm short-circuits before the `closed` one, so
the thread lands in the `alreadyBack` tally on the `coverage.end` row and its
per-thread audit row reads `conversation.coverageAlreadyBack` rather than being
counted as closed. The precedence is nonetheless right for the **move**: nothing
should happen to such a thread on either ending, and reordering the arms to fix
a count would change what `alreadyHers` means. It is not fixed here because it
misstates a count rather than an attribution - the thread's handler is unchanged
and recorded - and this branch has already been reverted once for changing a
disposition to satisfy a downstream reader. A fix would separate the tally's
buckets from the disposition's precedence, so counting can distinguish
closed-and-hers with the move rule unchanged.

* **`coveredSince` and `Message.createdAt` must come from the same clock, and
  that clock is the application's.** The return window is `createdAt >=
  coveredSince`, so a value read from anywhere else is a comparison between two
  machines. The reason nobody should reach for the database's clock, which is
  the sentence that would have prevented one defect here already: a DDL default
  only fires if the client omits the column, and Prisma does not omit it -
  `@default(now())` is generated and sent, so `DEFAULT CURRENT_TIMESTAMP` in
  `prisma/migrations` never assigns a message's timestamp. Reading the migration
  and concluding otherwise is what put a `SELECT NOW()` at the write for a day;
  see the resolved Open Question above.
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

The third is how to count the cross-vendor review this branch carries, and it
should be counted as two, not three. Finding (1), the coverage-start race - the
chosen cover read once and never re-checked - was real, and nothing else on this
branch caught it. Finding (3), the return window's clock, was itself reasoning
from a false premise about where `Message.createdAt` comes from: the defect it
described never existed, and the fix written for it introduced a real one, found
a day later by writing to a database rather than by reading the code again.
Worth saying plainly wherever this work is written up, because "confirmed by the
implementer" is not the same as "observed", and a review counted generously
teaches the wrong lesson about where defects actually get caught.
