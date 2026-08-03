# Decision: the product is called Attend

## Date

2026-08-03

## Status

Accepted

## Context

The repository was using two product names inconsistently. The interface, the
metadata, the package name, and most documents said `CTX Chat`. The repository,
its directory, and its git remote said `ctxconnect`. A reader could not tell
which was the product and which was an artifact of how the repo happened to be
created, and neither name says what the product does. "CTX" is a regional
abbreviation and "Chat" describes the surface rather than the job.

The product's own pitch is that it reads every conversation a service advisor
has and tells her what to do next. Neither existing name carries that.

## Options Considered

1. Keep `CTX Chat` and make it consistent everywhere, including renaming the
   repository to match.
2. Standardise on `CTX Connect`, the name already on the repository.
3. Rename the product to something that describes the job it does.

## Decision

The product is **Attend**. Option 3.

The name applies to code, interface copy, and documentation. It does **not**
apply to the GitHub repository, the git remote, the repository directory, or any
URL, all of which stay `ctxconnect`.

## Reasoning

"Attend to a customer" is service-lane vocabulary, so it lands with the primary
user without being explained. "Attend" also means to pay attention, which is
literally what the product does to every thread. It reads cleanly as the subject
of the pitch:

> Attend reads every conversation a service advisor has and tells her what to do
> next.

Availability was verified before the name was proposed: npm, GitHub, domain,
existing products, and trademark.

The repository name is excluded because renaming it breaks every existing link,
including ones already pointing at it from a portfolio. That is an
outward-facing change and it is not worth the breakage to make a URL match a
brand.

## Tradeoffs

**Historical records keep the name they were written with.** Dated records in
`content/decisions/` and `content/prds/` describe what was decided on a
particular day, and on that day the product was called `CTX Chat`. Rewriting
them would make them claim a name that did not exist yet, which is the one thing
a decision log exists to prevent. Each affected record instead carries a one-line
note at the top pointing here, so a reader knows the old name refers to this
product. Living documents that describe the product as it is now - `README.md`,
`ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/` - were renamed outright.

The cost is that the repository now contains two names in prose, and a reader
has to follow one link to connect them. The alternative cost was a set of
product records that quietly lie about their own dates.

**Identifiers keep the old name.** Seeded login addresses at `ctxchat.local`,
the seeded demo password, and the demo dealership `CTX MotoWorks` are data and
identifiers rather than product names. They are listed in the rename report.
Changing them is a data migration with a production blast radius, not a rebrand.

**The repository and the product now have different names.** That is a real
papercut for anyone cloning the repo. It is accepted because link stability
matters more, and the `README.md` opens with the product name.

## Portfolio Notes

The interesting part of this decision is not the name. It is drawing the line
between a rebrand and a migration, and holding it. A rename that quietly renames
database identifiers, seeded accounts, and a git remote alongside the brand is
three changes wearing one changelog entry, and the two that were not asked for
are the two that break things.

The second call was refusing to rewrite dated records. A decision log is only
worth keeping if it says what was actually true when it was written.
