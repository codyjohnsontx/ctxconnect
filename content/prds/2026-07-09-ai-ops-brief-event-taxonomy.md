# AI Ops Brief Event Taxonomy

## Date

2026-07-09

## Events

| Event name | Trigger | Actor | Required parameters | Optional parameters | Product question answered |
|---|---|---|---|---|---|
| `ai_insight_requested` | GM clicks `Generate brief` | Authenticated staff user | `userId`, `conversationId`, `createdAt` | `source`, `existingInsightCount` | How often do operators ask AI to help triage conversations? |
| `ai_insight_generated` | AI response is validated and persisted | System on behalf of staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `model`, `riskLevel`, `escalationRecommended` | How often does the AI workflow complete successfully? |
| `ai_insight_failed` | AI is not configured or provider generation fails | System on behalf of staff user | `userId`, `conversationId`, `createdAt`, `reason` | `model`, `message` | Where does the AI workflow break before value is delivered? |
| `ai_recommendation_accepted` | GM clicks `Accept` | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Are operators willing to endorse AI recommendations? |
| `ai_recommendation_dismissed` | GM clicks `Dismiss` | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Which recommendations are ignored or judged unhelpful? |
| `ai_note_created` | GM uses the AI suggestion as an internal note draft | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Do AI suggestions convert into internal operational documentation? |
| `ai_follow_up_created` | GM uses the AI suggestion as a follow-up draft | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Do AI suggestions convert into follow-up workflow? |
| `ai_reply_copied` | GM copies the suggested customer reply | Authenticated staff user | `userId`, `conversationId`, `aiInsightId`, `createdAt` | `action` | Are AI reply drafts useful enough to move into staff messaging? |

## Portfolio-Safe Notes

No live usage metrics yet. These events make the workflow measurable so future analysis can compare accepted versus ignored AI suggestions, response time after brief generation, and high-risk thread resolution patterns.
