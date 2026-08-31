# PRD: A Customer Row Opens a Thread She Can Read

## Status

Built

## Date

2026-08-31

## Summary

Every row on the Customers page linked to that customer's newest conversation
regardless of who was allowed to open it, so a service advisor clicking a
customer that parts had spoken to more recently got a bare 404. The row now
opens the newest thread she can actually read, and names the departments holding
the ones she cannot.

## Problem

`getCustomers` selected customers the reader can see - `conversations: { some:
scopedConversationWhere(user) }` - and then included the newest conversation
with no `where` at all. The outer filter asked "does this customer have a thread
she can read"; the inner include answered "here is their newest thread", and
those are different threads whenever another department has spoken more
recently.

The thread page guards correctly: `getInboxData` scopes `selectedConversation`,
finds nothing, and the route calls `notFound()`. So the fix belonged in the
query, not the guard.

Reproduced in the running app as the service advisor, on a seeded customer with
threads in two departments. The Customers row rendered, said `Parts · Open`, and
clicking it produced the 404 page with no explanation - from a row the page had
chosen to show her.

That is worse than a customer being absent. The row is the app telling her the
customer is there and reachable, and the click is the app contradicting itself.
It is also unrecoverable in place: nothing on the 404 page says what happened or
where to go.

A second, smaller dead end sat beside it. A customer with no readable
conversation at all rendered as a link to `/inbox`, which reads as a click that
did nothing.

## Target User

The service advisor using the Customers page as a directory - she has a name,
she wants the conversation.

## Goal

Every row on that page either opens a conversation she can read, or does not
pretend to be a link.

## v1 Scope

**The nested include is scoped to the reader.** `conversations: { where:
readerScope, take: 1 }`, so the row links at the newest thread she may open. The
nested query also drops from `include: { assignedUser: true }` to a `select` of
the three fields the page renders, which keeps a full `User` row - password hash
included - out of the page's data.

**A customer with nothing readable is not a link.** The row renders as a plain
`div` with the same layout, no hover state, and "No conversation yet".

**The row says who else is working this customer.** A customer can be with two
departments at once and the reader only ever sees her own side of it, so the
row carries "Also with Parts" under the status. The line names the department
and nothing else: she is not allowed to read those threads, so their status,
their assignee and anything said in them stay out of it.

**That list is computed in application code, not in SQL.** `NOT (assignedUserId
= me OR department = mine)` is *unknown* rather than true for a null
`assignedUserId` in SQL, so a negated Prisma clause would silently drop exactly
the unclaimed threads in other departments - the ones most worth reporting.
`unreachableDepartments` in `src/lib/conversation-access.ts` inverts the access
rule the rest of the app already uses, so the page and the guard cannot disagree.

**Managers and admins skip the extra read.** Nothing is out of their reach, so
the second query only runs for accounts that can lose sight of a thread.

## Non-Goals

- **Bounding the Customers page.** `getCustomers` still has no `take`, and the
  new query reads every thread of every listed customer. Invisible at sixteen
  seeded customers, load-bearing at a real store. Fixing it means paging or
  searching this page, which is its own change - see
  [Find a Customer From the Inbox](./2026-08-31-find-a-customer-from-the-inbox.md)
  for where search went first.
- **Search on the Customers page.** Not here.
- **Letting her open the other department's thread.** The line tells her who
  has it; it does not link there, and it must not.
- **The Opt status badge.** Unchanged, including its existing looseness about
  `smsOptedIn`.

## Acceptance Criteria

- Given a customer whose newest thread is in another department, when the
  advisor clicks their row, then she lands on the newest thread she can read,
  with the "Back to customers" link.
- Given that same row, then it reads "Also with Parts" under the status.
- Given a customer she can see but has no readable thread, then the row is not a
  link and reads "No conversation yet".
- Given a manager or admin, then every row links to that customer's newest
  thread and no "Also with" line is shown.
- Given any row on the page, when she clicks it, then she never sees a 404.

## Risks / Open Questions

- **Two reads instead of one for non-managers.** The second query is over every
  thread of the listed customers, unbounded like the page it serves. Named as a
  non-goal; it is the same ceiling the page already had.
- **"Also with Parts" is a small disclosure.** It tells a service advisor that
  parts has spoken to this customer. That is intentional - she needs it before
  she calls them - but it is information her scope otherwise withholds, so it is
  deliberately the department name and nothing more.
- **A row can be a link one minute and not the next.** A hand-off can take the
  last readable thread away between page loads. Correct, and it now degrades to
  a non-link rather than to a 404.
- No live usage metrics. The signal to watch is any 404 reached from
  `?from=customers`, which should now be impossible.

## Portfolio Notes

Two things made this worth writing down. The first is where the bug was: the
guard was right, the query was wrong, and the symptom appeared at the guard.
Hardening the thread page would have produced a nicer 404 rather than a working
link.

The second is the three-valued logic. The obvious implementation of "which
departments can she not reach" is a negated database filter, it reads correctly,
and it quietly drops every unassigned thread, because `NULL = 'advisor-1'` is
neither true nor false in SQL. Inverting the rule in application code is both
easier to test and the only version that reports an unclaimed thread - which is
the case an advisor most needs to know about.
