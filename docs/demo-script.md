# Attend: the ninety-second demo

## The sentence

Say this before you touch anything, and do not add to it:

> **Attend reads every conversation a service advisor has and tells her what to do next.**

One user. One verb. One outcome. Everything below exists to make that sentence
land; if a section of the demo does not support it, cut the section.

## Who Alyssa is

Alyssa Torres is a service advisor at CTX MotoWorks, a single-store motorcycle
dealership. She is the person at the write-up desk. She owns the service lane's
customer conversations: repair orders, estimates, approvals, parts delays, pickup
times, comebacks.

Her day is not blocked by having too few tools. It is blocked by not knowing which
of her open repair orders is about to go wrong. A customer who has asked the same
question three times looks exactly like a customer asking for the first time, until
you open the thread and read it.

That is the job the product does for her.

## What the app did before she arrived

At 09:30, before Alyssa unlocks the door, the ambient AI pass runs. It reads every
conversation with new activity since the last time it looked, and writes a brief for
each one: what the thread is about, what the customer needs, what the risk is and
why, whether it needs someone above her, and the single next action.

It skips what it already understands. A thread nobody has touched since its last
brief costs nothing. That is the whole cost model, and it is worth saying out loud
because it is the first question a technical listener asks.

## The demo: three clicks

Total 90 seconds. Land on each click, then stop talking.

---

### Click 1 - `View demo` on the login page (0:00 - 0:30)

You are signed in as Alyssa and dropped straight into her inbox. Do not go to the
Command Center. Do not tour the nav.

Point at the top of the list and say:

> "This is her Monday. It is not in message order - it is in the order the AI decided
> matters. Six conversations, and the ones it has read carry the reason they are where
> they are."

Do not claim every row has an AI reason. One does not: Priya Patel's thread has no
inbound customer message, so the pass has nothing to read and leaves it alone. Her row
says `Not briefed`. If anyone points at it, that is the honest and useful answer - the
pass skips what it cannot assess rather than inventing a rating for it.

One more label to expect, for the same reason. Nina Caldwell's row carries an
`earlier brief` marker on its risk badge, because a staff note landed in her thread
after her brief was written. The app says so rather than presenting an out-of-date
read as current, and the header counts her as unbriefed - which is why that line says
`4 of 5 briefed` against six rows on screen. Five is the number of threads the pass
will consider, so Priya is in neither number. The scheduled pass leaves that one
thread alone so the marker is on screen whenever you present. If the room wants to
see the pass move, Nina's thread is exactly what `Run pass` re-briefs.

Then read the top row out loud, because it does the work for you:

> **Renee Whitlock** - Urgent, Escalate.
> *"Get the service manager on the warranty claim today and give the customer a dated
> commitment."*

And the bottom row, because the contrast is the point:

> **Kelsey Nakamura** - Low. A first-service scheduling question. It is at the bottom
> because it should be.

If someone asks whether the AI is really running: the header says how many of these
threads are briefed and how recent the newest brief is, and `Run pass` runs it live in
front of them.

---

### Click 2 - open Renee Whitlock (0:30 - 1:05)

The thread on the left, the brief on the right.

> "Nine days on an unpaid warranty claim. The customer has asked three times and has
> now asked for the service manager. Alyssa did not have to read any of that to know
> it."

Then point at **Escalation** specifically, because it is the part that is hard to
build and easy to miss:

> "It is not just summarizing. It decided this one is above her - the claim is stalled
> with the regional rep, which an advisor cannot fix by being more diligent."

If you have a phone in the room, open the same screen on it. The brief works at
390x844. That matters because she is not at a desk; she is in the lane.

---

### Click 3 - `Use as follow-up` (1:05 - 1:30)

The recommendation drops into the follow-up form, already titled. Save it.

> "This is the part I care about most. The recommendation is not a paragraph she has
> to re-type. One click turns it into a tracked follow-up assigned to a person with a
> due date. And every accept, dismiss, and copy is recorded - so we can measure
> whether the AI was actually useful, not just whether it ran."

Stop there. Ninety seconds.

## What not to volunteer

- **The Command Center.** It is a manager's screen. Opening it re-opens the "who is
  this for" question, which is the question that has to stay closed.
- **Staff-to-staff messaging.** See the roadmap note below. Answer it confidently if
  asked; never raise it.
- **Twilio, Neon, Prisma, Vercel.** Nobody asked what it is made of.
- **Anything with a number on it that came from a seed.** There are no real users, so
  there are no real metrics. Say so if asked; do not decorate.

## Answers to the four questions that will come

**"Is the AI real, or is that text?"**
Real. Structured output against a fixed schema, re-validated before it is saved. Press
`Run pass` and watch it run. With no key configured, the app says so and writes
nothing - it never invents a brief.

**"What happens at 500 conversations a day?"**
Honestly: the pass is bounded per run and the inbox has no pagination yet. It is built
for a single store's service lane. Scaling it is a cost conversation before it is an
engineering one, because every brief is a paid call.

**"Does it integrate with the DMS?"**
No. Repair order numbers are typed. That is the first integration worth building, and
it is the difference between a useful tool and a system of record.

**"How do you know it works?"**
No live usage data - there are no users. What is instrumented is whether the advisor
accepts or dismisses each recommendation, which is the signal that tells you the
ranking is right. See [experiment-plan.md](./experiment-plan.md).

## Roadmap note: staff-to-staff messaging

Today Attend has one staff-to-staff primitive: an internal note on a customer
thread. There is no direct message, no channel, no `@mention`. Two staff members
cannot talk unless a customer conversation exists to talk inside of.

That is deliberate, and it stays a roadmap line rather than a pitch line.

An advisor's day is not blocked by lacking a place to talk to the parts counter -
that already exists, in person and in every chat tool a dealership already pays for.
It is blocked by not knowing which of forty open repair orders is about to go wrong.
Building a second chat app would widen the product back to "everyone at the
dealership", which is exactly the answer that does not land in a room.

If asked, the answer is one sentence and then move on:

> "Internal notes are on the customer thread today. Direct staff messaging is on the
> roadmap, behind DMS integration, because knowing which repair order is at risk is
> worth more to an advisor than another place to type."

Do not offer more than that. Do not offer it unprompted.
