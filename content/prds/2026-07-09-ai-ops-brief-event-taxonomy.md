# AI Ops Brief Event Taxonomy

## Status

Built

## Date

2026-07-09

## Events

| Event name | Trigger | Actor | Required parameters | Optional parameters | Product question answered |
|---|---|---|---|---|---|
| `ai_insight_requested` | A brief is asked for: an advisor clicks `Generate brief`, or the ambient pass selects the conversation | Authenticated staff user, or the system when no person asked | `conversationId`, `createdAt`, `source` | `userId` (null for an unattended pass), `existingInsightCount` | How often is AI asked to help triage conversations? |
| `ai_insight_generated` | AI response is validated and persisted | System on behalf of a staff user or of the ambient pass | `conversationId`, `aiInsightId`, `createdAt`, `source` | `userId` (null for an unattended pass), `model`, `riskLevel`, `escalationRecommended` | How often does the AI workflow complete successfully? |
| `ai_insight_failed` | AI is not configured or provider generation fails | System on behalf of a staff user or of the ambient pass | `conversationId`, `createdAt`, `reason`, `source` | `userId` (null for an unattended pass), `model`, `message` | Where does the AI workflow break before value is delivered? |
| `ai_recommendation_accepted` | The advisor clicks `Accept` | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Are operators willing to endorse AI recommendations? |
| `ai_recommendation_dismissed` | The advisor clicks `Dismiss` | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Which recommendations are ignored or judged unhelpful? |
| `ai_note_created` | The advisor saves an internal note after using an AI suggestion | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `source` | Do AI suggestions convert into internal operational documentation? |
| `ai_follow_up_created` | The advisor creates a follow-up after using an AI suggestion | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `source` | Do AI suggestions convert into follow-up workflow? |
| `ai_reply_copied` | The advisor copies the suggested customer reply | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Are AI reply drafts useful enough to send to the customer? |

`source` on the three insight events is one of `inbox` (a person clicked), `ambient_pass`
(the scheduled or on-demand pass), or `seed` (demo data regeneration).

## What seeded data emits

The demo seed does not simulate the whole lifecycle. Of the three insight events it
writes only `ai_insight_generated`: it never writes `ai_insight_requested` or
`ai_insight_failed`, because no request was made and nothing failed.

Those seeded `ai_insight_generated` rows come in two shapes, and the `userId` rule
follows the `source`:

| Shape | `source` | `userId` | Why |
|---|---|---|---|
| Briefs presented as staff-requested | `seed` | a seeded staff user | Stands in for a person having clicked `Generate brief` |
| Briefs presented as pass-produced | `ambient_pass` | `null` | Nobody asked; this is the unattended pass having run before the advisor arrived |

`userId` is null exactly when no person triggered the event, which is the same rule
the live code follows.

The demo AI quota depends on this. `remainingDemoBriefQuota` excludes seeded briefs
by matching `source: seed` on the event, deliberately not by the insight's `model`
column, because seed-time regeneration overwrites that column with the real model
name. The `ambient_pass` seeded rows need no exclusion: they carry `userId: null`, so
they can never count against any user's quota.

The seed also writes the downstream action events (`ai_recommendation_accepted`,
`ai_recommendation_dismissed`, `ai_reply_copied`, `ai_note_created`,
`ai_follow_up_created`) for some conversations, so the demo shows a closed loop
rather than briefs nobody acted on.

## Portfolio-Safe Notes

No live usage metrics yet. These events make the workflow measurable so future analysis can compare accepted versus ignored AI suggestions, response time after brief generation, and high-risk thread resolution patterns.
