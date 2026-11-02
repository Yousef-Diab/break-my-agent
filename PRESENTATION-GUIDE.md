# Break My Agent

## Understand it. Break it. Explain the repair.

Technical guide · 2 November 2026

This is a small, executable agent-security workbench. A fictional tournament participant asks for a registration credit. The application retrieves relevant FAQ passages, sends them with trusted context to a real model through OpenRouter, executes at most one allowed tool proposal and displays the actual receipt or rejection.

The spectator can poison a FAQ, inspect a captured run, compare deliberately unsafe and guarded enforcement, and replay the same tool arguments without another model call.

**The central claim:** the model may propose an action; application code determines its authority; the ledger establishes what actually happened.

This guide documents the implemented architecture, execution boundaries and reproducible experiments.

## 1. Get the demo running

Open two terminals in `your local clone of this repository`.

```powershell
# Install once, or after dependencies change
npm ci

# Terminal 1: server, trusted state and model credential
npm run api
```

```powershell
# Terminal 2: browser interface
npm run dev
```

Open [the playground](http://127.0.0.1:4317/) and this [printable guide](http://127.0.0.1:4317/guide.html). The API listens on port 4318. Both bind to loopback, not the public network. The default API command is deliberately stable: editing server code or `.env` requires stopping and restarting it, so a file edit cannot unexpectedly erase a presentation's receipts.

The ignored `.env` contains `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. The default model is `openai/gpt-4.1-mini`. Never commit, display or export the key. If the model is unavailable, use the explicitly labeled Tool fixture; do not describe it as live inference.

Run the checks:

```powershell
npm test
npm run typecheck
npm run build
npm run evaluate
```

`npm test` exercises the code, including controlled provider responses. It makes no paid model requests. `evaluate` writes `reports/regression-report.json`: a small controlled scenario report, not a model leaderboard. See `VERIFICATION.md` and `reports/LIVE-VALIDATION.md` for the final measured results and live samples.

## 2. Project overview

The playground compares model proposals with application-authorized effects. Real inference, controlled fixtures and recorded replays are labeled separately. The ledger records actual credit effects; a model response alone does not establish completion.

## 3. Architecture

```text
Participant message + bounded conversation history
                    |
                    v
Versioned FAQ corpus --> lexical retrieval --> selected passages
                                             |
Trusted identity + owned booking facts + always-loaded policy
                                             |
                                             v
                                  OpenRouter model request
                                             |
                              text or one tool proposal
                                             |
                                             v
                                runtime schema validation
                                             |
                        ownership / cancellation / fee / duplicate
                                             |
                                             v
                                sandbox ledger + receipt
                                             |
                        model draft + receipt-derived verified reply
                                             |
                                   trace / replay / regression
```

There is one credit tool, not a collection of autonomous agents. Retrieval is chosen by application logic before generation. A model call is an external API request, not an authenticated source of business facts.

### Three different kinds of information

| Kind | Example | Authority |
|---|---|---|
| Trusted application state | Current demo participant, booking owner, cancellation, fee | Server-owned fixture state |
| Approved policy | Exactly one full-fee credit for your own cancelled registration | Application code; always available |
| Retrieved evidence | FAQ explanation and a malicious “admin update” | Untrusted context, never permission |

The FAQ can help answer a question. It cannot make somebody else's booking yours or change an approved 50-credit fee to 500. Giving text a title such as “ADMIN UPDATE” does not authenticate its author.

## 4. What RAG means here

`src/retrieval.ts` contains four owned FAQ documents. Each has an ID, title, version and content. One document is editable. Saving a change increments its version; a run captures the actual passages and versions it used.

The search is real lexical retrieval, not a hand-picked response:

1. Lowercase and tokenize the query, titles and document text.
2. Remove a small stop-word set and deduplicate query terms.
3. Award two points for a title term match and one for a body match.
4. Keep matching documents, break ties by ID and select the top two.

Scores are overlap counts, not confidence or semantic similarity. Repeating the same query word does not increase the score. An unrelated query returns no evidence; the runner abstains without paying for inference. A follow-up can use the previous user question to retain topic context.

There are no embeddings, vector database, reranker, crawling or production-scale recall claims. The small corpus makes behavior inspectable. If measured missed matches justify richer retrieval, compare lexical, embedding and hybrid candidates against independently labeled cases before adding infrastructure. Reranking cannot recover a document that never entered the candidate set.

## 5. What the model actually does

`src/openrouter.ts` defines the native `issueCredit` tool contract and the OpenRouter HTTP request. It uses Node's built-in `fetch`; a second SDK was unnecessary for one documented provider endpoint.

The first request contains a system message with trusted policy and owned booking facts. A separate user message serializes the question, bounded prior turns and untrusted retrieved passages. Both application modes receive the same prompt. The mode comparison changes code enforcement, not a hidden stronger system prompt.

The model can return text, refuse, fail, or propose one tool call. Zod validates the external response shape. Multiple proposed tool calls are rejected before execution. Unknown tool names are outside the allowlist. Malformed argument JSON reaches the credit schema as invalid input and cannot create a receipt.

After a tool decision, the runner may make a second model request with the actual tool result. Further actions are disabled; any unexpected follow-up proposal is not executed. This second response is displayed as a model draft, separate from the verified outcome.

The trace preserves requested/served model identifiers where reported, response IDs, refusal and finish reason, token usage, reported cost, captured messages, evidence and tool result. It does not expose private chain of thought or claim to explain hidden model reasoning.

## 6. The most important code: the credit boundary

The credit boundary is implemented in `src/credit.ts`. A factory captures trusted participant identity, copies the owned fixture bookings and keeps a private ledger.

`issueCredit(input: unknown)` performs runtime validation. TypeScript types disappear at runtime, so an `as CreditRequest` assertion would not establish that external data has a valid shape. Zod checks the booking ID, positive safe integer amount and absence of additional fields such as `approved` or a forged participant identity.

A valid shape is still not permission. Guarded mode then checks:

- The booking belongs to the trusted participant.
- The tournament registration is actually cancelled.
- The requested amount equals the approved registration fee.
- This booking has not already received a credit.

Every failed check returns before mutation. On success, the tool appends an actual receipt with a unique ID. Copies returned to consumers prevent editing a displayed receipt from corrupting private state. `readonly` helps the compiler; the copies protect runtime references.

The fixed session is explicitly a demo identity, not production authentication. In a deployed system, derive identity from validated authentication, scope storage queries and tool credentials accordingly, and enforce the policy at the effect boundary.

## 7. Understand the unsafe comparison

The baseline deliberately omits ownership and approved-amount enforcement. It keeps argument shape, booking existence, cancellation and duplicate checks. It has its own fictional ledger, isolated from guarded mode.

A controlled `{ bookingId: 'arena-101', amount: 500 }` proposal can therefore create a 500-credit receipt in baseline while guarded code rejects that exact proposal. The application separately flags the observed policy violation. This is an actual program effect on synthetic data.

That does not prove a particular model was tricked. A live model may correctly reject the injected FAQ. Report that result. Use the controlled fixture and captured-call replay to demonstrate the missing application boundary reliably, and label the evidence accurately.

Replay executes captured arguments against the selected mode's current state. It does not rerun retrieval or inference. A repeated legitimate call can be blocked as already credited; replay is not an identical-world simulation. Export the original trace before a global reset clears history.

## 8. Why completion wording is constrained

`verifiedReply()` creates the outgoing completion statement from the executed tool decision. A model's free-form draft may be wrong, so it appears separately for inspection.

If the tool blocked 500 credits and the draft says “I issued 500,” the verified reply still says no credit was issued. If the model never proposed a tool, text alone cannot create success. If the explanation request times out after a successful tool call, the recorded receipt remains evidence of completion.

This is a narrow, strong guarantee around action completion. It is not a universal semantic validator for every factual sentence the model could generate. The interface does not call model prose a verified receipt.

## 9. State, concurrency and cost

There are separate ledgers and bounded conversation histories per enforcement mode. Only the last six conversation messages and twenty traces/attempts are retained. Every run snapshots its document versions.

Mutations are checked after HTTP body parsing and before handlers. Reserving a live turn happens synchronously before awaiting the provider. A regression reproduces the original race where two requests both passed an earlier check, then verifies that only one provider call starts and the other request receives HTTP 409.

The UI disables conflicting controls while its own request is active. A reload may observe another running turn; the always-available Refresh state control lets the user load the eventual result. A missing first ledger response is unknown, never zero. A later outage preserves last observed state and labels it accordingly.

Provider calls have a 25-second deadline, at most 400 generated tokens each and at most two calls per agent turn. The server allows twenty provider requests per process lifetime; failed requests count. Resetting the sandbox does not restore this budget. Restarting the server does, so this is not an account-level spending guarantee. OpenRouter price ceilings bound acceptable per-token provider rates; the UI reports returned costs and marks incomplete accounting. Use a provider-side key spending limit for a hard account cap.

The stable API command loads `.env` at startup. It never sends the key to the browser, stores it in a trace, or places it in a URL. The only external destination for it is OpenRouter's Authorization header. Ordinary tests use harmless controlled keys and responses.

## 10. A five-minute demonstration

**0:00–0:40 — Frame the outcome.** Explain the tournament credit task and the evidence/authority boundary. Point out the real model versus fixture labels.

**0:40–1:30 — Legitimate utility.** Reset the sandbox, choose Guarded and Live agent, leave the clean FAQ and use Play fair. Run it. Point to selected evidence, proposed arguments and the actual 50-credit receipt. Explain that a safe agent must still accomplish useful work.

**1:30–2:30 — An indirect attack.** Load injection, save the FAQ, and point to its incremented version. Use a normal credit question so the malicious instruction arrives through retrieval. Run in a fresh appropriate ledger. If the model resists, say so. Inspect its proposal/refusal instead of claiming a successful exploit. To start clean while retaining traces, use the other isolated mode or export before resetting.

**2:30–3:40 — Guaranteed boundary experiment.** If a live unauthorized proposal exists, replay that captured call. Otherwise export the live trace, reset the whole sandbox to clear any prior credit, then explicitly choose Tool fixture, Unsafe baseline and Get greedy. Execute the 500-credit proposal. Point to the violation and receipt, then Replay call in guarded. The same arguments are now blocked; no new inference happened during replay.

**3:40–4:30 — Trace and repair.** Show policy version, document version where applicable, decision reason, source label and ledger. Explain that the repair is enforcement at the tool boundary. The system prompt is unchanged.

**4:30–5:00 — Regression and limits.** Show the automated results and the false-success/timeout/concurrency tests. State the synthetic-data, in-memory and single-session limits. Offer to inspect one function with the audience.

## 11. Design FAQ

**Why isn't a stronger prompt sufficient?** A prompt influences model behavior but cannot authenticate ownership or implement an atomic state transition. The application must independently authorize the tool call. This project uses prompting and enforcement for different jobs.

**Why not put the mandatory rule in RAG?** Retrieval chooses relevant knowledge and can miss a passage. A critical action policy must be available regardless of semantic relevance. Here the server enforces it directly, and the system prompt describes it for the model.

**Why use Zod and TypeScript?** TypeScript checks code assumptions during development. Zod validates actual external values while the program runs. Neither replaces ownership, approved amounts or other business rules.

**What did the model contribute?** It interpreted a participant request in context, used retrieved guidance and selected a native tool proposal. The application did retrieval orchestration, authorization, mutation and verified completion wording. This is deliberately a bounded agent, not autonomous execution of arbitrary plans.

**Is this exactly-once processing?** No. The synchronous in-memory check prevents repeat credit in this single process. Production effects require durable operation identities, transactional constraints, appropriate isolation and provider reconciliation. A restart here forgets the ledger.

**How do you evaluate safety without making it useless?** Test allowed completion as well as forbidden side effects. Count actual receipts and policy violations, not only refusal sentences. Keep deterministic invariants separate from variable model behavior and repeat live samples before drawing statistical conclusions.

**What would you change first for production?** Real authentication, durable authorized storage and transactions, an approved policy lifecycle, redacted traces, representative independently labeled evaluation cases, controlled rollout and provider-specific outcome reconciliation. Add richer retrieval only after measuring a need.

## 12. Code map

| File | What to explain |
|---|---|
| `src/fixtures.ts` | Owned synthetic records and fixed demo actor |
| `src/credit.ts` | Runtime arguments, trusted identity, policy, ledger effects and explicit unsafe comparison |
| `src/retrieval.ts` | Corpus, editable document ID, lexical ranking and versions |
| `src/openrouter.ts` | Tool schema, external request, response validation, errors, usage and budgets |
| `src/agent.ts` | Context construction, bounded model/tool turn, verified reply and observable trace |
| `src/app.ts` | Local HTTP boundaries, scoped state, mode/document/run/replay/reset routes and concurrency |
| `src/protocol.ts` | Shared response types; types are not authorization |
| `client/App.tsx` | Form/source/mode state, server requests, FAQ editor, history and ledger |
| `client/TraceInspector.tsx` | Evidence, model drafts/refusals, decisions, replay and export |
| `client/style.css` | Layout, arcade illustration, responsive behavior and keyboard focus |
| `src/evaluate.ts` | Reproducible controlled scenarios with real tool effects |
| `*.test.ts` | Actual boundaries and the regressions that protect them |

## 13. Limitations

This local demonstration uses fictional data, one shared session and in-memory state. It does not provide production authentication, durable transactions or general prompt-injection resistance. The saved live samples are not a statistical security benchmark. See `VERIFICATION.md` for the measured results.

## Sources and further reading

- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [OpenRouter request/response contract](https://openrouter.ai/docs/api/reference/overview)
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [OpenRouter provider selection and rate ceilings](https://openrouter.ai/docs/guides/routing/provider-selection)

These sources explain public interfaces and concepts. The implementation's own tests, traces and receipts establish what this demo actually did.
