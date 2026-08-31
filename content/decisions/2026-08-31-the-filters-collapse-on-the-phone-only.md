# Decision: The Filters Collapse on the Phone Only, and Carry Nothing They Cannot Show

## Date

2026-08-31

## Status

Accepted

## Context

On a phone the inbox filter grid ended 324px down an 844px screen before the
first ranked queue row began, so the thing the advisor opened the app for
started below a block of chrome she had not asked for. Collapsing the controls
fixes that, and raises two questions that are product calls rather than
engineering ones.

**Does the wide layout collapse too?** The queue rail is 390px wide with the
controls above the list and both on screen at once. Nothing is buried there.

**What happens to a filter with no control in the form?** `getInboxData`
narrows on `priority`, and the inbox form has no priority control - nothing in
the product produces such a link either (`grep` for `/inbox?` in `src/` returns
one hit, the hand-off redirect, which sets no filter). It can only arrive by
hand-typed URL. Collapsing the controls behind a summary makes that filter twice
as invisible: narrowing the queue from behind a fold.

## Options Considered

**On where it collapses:**

1. Collapse everywhere, one behaviour at every width.
2. Collapse below `lg` only; leave the wide layout exactly as it is.

**On the uncontrolled filter:**

1. Carry it forward in a hidden input, so pressing **Filter** preserves it.
2. Ignore it entirely: do not count it, do not carry it.
3. Count it, do not carry it, and make **Clear filters** the way out.

## Decision

Collapse below `lg` only (option 2), and count-but-do-not-carry the uncontrolled
filter (option 3).

## Reasoning

**On the collapse.** A fold costs one tap every time she wants a control. That
is worth paying where the alternative is the queue starting below the fold, and
is worth nothing where the controls and the queue already fit together. The wide
layout has no problem to fix, and "one behaviour at every width" is a
consistency argument, not a user one. It also keeps the promise that this work
changes nothing about the screen the advisor uses at the counter, which is a
promise that can be checked with a screenshot.

The mechanism follows from that. `<details>`/`<summary>` is the right semantic
and cannot do this: no author style can reopen a closed `<details>`, and the
`open` attribute is decided on the server where the viewport is unknown. So a
`<details>` that collapses on a phone collapses on the desktop too, or the
markup is written twice. A CSS-only checkbox disclosure collapses at one
breakpoint and not the other from a single copy of the form. The cost is that
assistive technology announces a checkbox named "Filters" rather than a
disclosure; it is labelled, operable, and carries `aria-controls`, and that was
judged the smaller cost than either duplicating the form or collapsing a desktop
that did not need it.

**On the uncontrolled filter.** Option 1 - the hidden input - is what the first
attempt did, and it is scaffolding for a feature that does not exist. It builds
the machinery to preserve a priority filter across submits before anything in
the product can set one, and the behaviour it creates is that pressing **Filter**
quietly keeps a constraint the advisor never chose and cannot see in the form
she just submitted.

Option 2 is worse in the other direction. An uncounted filter means a queue
short by a filter with nothing on screen accounting for it, and - the part that
matters - an empty state that says "No conversations yet" when the truth is "you
are filtered to nothing".

Option 3 tells the truth in both directions. The count reflects what is actually
narrowing the queue, so the badge and the empty state are honest; the form
submits what is on screen, so pressing **Filter** sets the queue to the controls
she can see; and **Clear filters** removes everything, which is the same exit it
already had to be for the filters that do have controls. If a priority control is
ever built, it joins the form and nothing about this has to be undone.

## Tradeoffs

- **Given up: one behaviour at every width.** Two layouts now differ in how the
  filters are reached. Accepted; they already differ in almost everything else,
  and the wide layout has no problem here.
- **Given up: `<summary>` semantics.** A checkbox disclosure, for the reason
  above. Revisit if `::details-content` support becomes safe to depend on for a
  *desktop* that must never be collapsed by a browser that does not support it.
- **Given up: the one-tap filter on a phone.** Setting a filter is now two taps.
  Reading the queue is what she opens the app for; filtering is not.
- **Given up: preserving a priority filter across a submit.** Someone who
  hand-types `/inbox?priority=URGENT` and then presses **Filter** loses it.
  They are told it is there ("1 active") and given a way out; keeping it would
  mean the form lies about what it submits.
- **Not given: a priority control.** The queue query still honours a filter the
  product cannot set. That is a real gap and the answer to it is a control in
  the form, not a hidden input - it stays unbuilt until someone can say what
  decision the advisor makes with it.

## Portfolio Notes

Both calls are the same call twice: refuse to build the thing that is only
plausible. The hidden input looks like carefulness - "do not silently drop the
user's filter" - and is actually a feature nobody asked for, given weight by
being written down. The desktop collapse looks like consistency and is actually
a regression to a screen that was working. What separated them from the correct
answers was asking, each time, what the advisor is trying to do on the screen in
front of her.
