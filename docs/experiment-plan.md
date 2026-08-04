# Attend experiment plan

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
| **Test idea** | Randomly withhold the brief on a share of eligible conversations. Compare response time on conversations where the advisor had a brief against conversations where she did not. |
| **Unit of randomization** | Conversation, assigned when the pass first finds the thread eligible, before anyone has seen a brief for it. Not staff member - advisors talk to each other and would contaminate a per-person split. |

The test idea originally read "compare conversations where the advisor accepts an AI
suggestion against conversations where the AI brief is ignored." That is not an
experiment. Acceptance happens after the brief exists and is chosen by the advisor,
so it is an outcome, not an assignment: the threads she accepts on are the ones she
already judged worth acting on, and they would have resolved faster than the ones she
ignored whether or not the AI existed. Splitting on it measures her judgement and
calls it the model's effect.

Assignment therefore has to be made before acceptance can occur, and by the system
rather than by the advisor. Accept and dismiss stay in the plan as **outcome
measures** of whether a brief was useful, never as the thing that sorts conversations
into arms.

The honest cost of this design, stated because it is a real one: the control arm means
deliberately withholding a brief from an advisor on live customer conversations. That
is a decision about degrading the product for some threads to learn whether it works
on the others, and it should be taken explicitly rather than assumed. The cheaper
alternative is to accept an observational comparison and drop the causal claim, which
answers a weaker question.

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
