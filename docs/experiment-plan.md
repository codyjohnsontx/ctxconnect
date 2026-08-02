# CTX Chat experiment plan

## Why this lives in a doc and not on a screen

This content used to render inside the product, as an `Experiment Readiness` card
on the Command Center, alongside a `Recommended demo path` callout that told the
viewer which buttons to press.

Both were removed from the UI on 2026-08-02. The reasoning:

- No dealership employee will ever act on a hypothesis card. It is a product
  management artifact wearing product clothing, and it occupied roughly a third of
  the first viewport on the Command Center.
- A product executive reads "Recommended demo path" as stage directions. It breaks
  the fiction that you are looking at software people use, at the exact moment you
  need them thinking about the product rather than the demo.

In a document this reads as rigour. On screen it read as a mock-up. Nothing here was
deleted - it moved.

## Experiment readiness

Status: **not running.** Instrumentation exists. No live randomization has been run
and no experiment results are claimed.

| | |
|---|---|
| **Hypothesis** | AI-suggested replies reduce time from inbound customer message to staff response. |
| **Primary metric** | Average response time after AI brief generation. |
| **Guardrail metric** | Failed outbound messages, or dismissed AI recommendations. |
| **Test idea** | Compare conversations where the service advisor accepts an AI suggestion against conversations where the AI brief is ignored. |
| **Unit of randomization** | Conversation. Not staff member - advisors talk to each other and would contaminate a per-person split. |

The test idea originally read "conversations where the GM accepts an AI suggestion."
The primary user is the service advisor, so the acceptor is the advisor.

## What is already instrumented

Every AI interaction writes a `ProductEvent` row, so the metrics above are
computable today without new tracking:

| Event | Written when |
|---|---|
| `AI_INSIGHT_REQUESTED` | A brief is asked for, by a person or by the ambient pass |
| `AI_INSIGHT_GENERATED` | A brief is successfully produced and saved |
| `AI_INSIGHT_FAILED` | No key, provider error, or demo cap reached - with the reason in `metadata` |
| `AI_RECOMMENDATION_ACCEPTED` | The advisor accepts the recommendation |
| `AI_RECOMMENDATION_DISMISSED` | The advisor dismisses it |
| `AI_REPLY_COPIED` | The suggested reply is copied to the clipboard |
| `AI_FOLLOW_UP_CREATED` / `AI_NOTE_CREATED` | The recommendation is converted into a task or an internal note |

The accept/dismiss loop is the part that matters: it measures whether the
recommendation was *useful*, not just whether it was *generated*.

## Honest limits

- Response-time figures currently average over a handful of seeded messages. An
  average over n=1 is not a metric, it is a number. Nothing should be claimed from
  the current dataset.
- There are no real users, so there is no adoption, retention, or conversion data,
  and none should be invented.
- What can honestly be said today: the instrumentation is in place, the events are
  written on the real code paths, and the experiment above could be run on the first
  day the product has traffic.

## The demo narrative

The `Recommended demo path` callout was the app narrating its own demo. The
narrative itself was sound - it just belongs in a script the presenter reads, not in
chrome the audience reads. It now lives in [demo-script.md](./demo-script.md).
