# Break My Agent

**Poison the evidence. Inspect the action. Prove the boundary.**

An interactive agent-security playground: a tournament participant asks an AI agent for a registration credit while you edit the FAQ it retrieves. Inspect the model's tool proposal, compare intentionally unsafe and guarded application code, and verify what actually reached the ledger.

![Break My Agent playground showing a guarded rejection of a 500-credit proposal](final-preview.png)

*Actual playground capture: a controlled 500-credit proposal is replayed against guarded code and blocked. This screenshot is a tool-boundary experiment, not evidence that a live model was tricked.*

## What you can explore

- **Real RAG:** lexical search over a versioned FAQ corpus, with scores and selected passages visible in each trace.
- **Real model/tool calls:** OpenRouter interprets the request and can propose one `issueCredit` action.
- **An editable attack surface:** insert instructions into retrieved evidence and inspect the resulting model behavior.
- **Two execution boundaries:** separate unsafe and guarded ledgers receive the same prompt; application enforcement changes.
- **Observable effects:** compare model drafts with receipt-derived outcomes, policy decisions, usage and costs.
- **Reproducible replay:** execute captured tool arguments in another mode without another model request; export traces as JSON.

Every participant, booking and credit is fictional. The baseline deliberately omits ownership and approved-amount checks so you can observe the consequences on synthetic data.

## How it works

![Architecture: user question and FAQ retrieval feed a model proposal, which passes through application policy checks before a receipt and trace](docs/images/architecture.svg)

The model proposes an action. Server-owned identity and booking facts determine permission. Retrieved text cannot grant authority. Guarded code checks runtime arguments, ownership, cancellation, exact fee and duplicate credits before changing state. Completion wording comes from the executed result; free-form model prose remains a separate draft.

**Stack:** TypeScript, React, Vite, Fastify, Zod, Node's built-in test runner and native `fetch` for OpenRouter. Retrieval uses deterministic lexical ranking; there is no vector database or embedding service.

## Run locally

Requires **Node.js 24.3+** and npm. From your clone:

```sh
npm ci
```

For live inference, copy `.env.example` to `.env` and set your own `OPENROUTER_API_KEY`. The default model is `openai/gpt-4.1-mini`. Keep the key local; `.env` is ignored by Git. Without a key, the clearly labeled **Tool fixture** and replay still work.

Start two terminals:

```sh
# Terminal 1: API and trusted state
npm run api
```

```sh
# Terminal 2: browser interface
npm run dev
```

Open **http://127.0.0.1:4317/**. The API listens on port 4318; both services bind to loopback. Stop each with Ctrl+C. Restart the API after changing server code or `.env`; restarting clears its in-memory state. Fixed ports and allowed origins must be updated together if changed.

Live turns make at most two provider requests. The demo limits requests to 20 per server process and displays reported usage/cost. This counter resets on restart; set a provider-side key limit for a hard spending cap.

## Try the boundary in two minutes

1. Choose **Guarded → Live agent → Play fair** and run a legitimate request. Inspect the retrieved FAQ, proposed action and actual 50-credit receipt.
2. Load an injection into the FAQ, save it and run against a fresh ledger. Inspect what the model actually proposes; resistance is a valid result.
3. For a deterministic comparison, export any traces you want to keep, then reset the sandbox. Choose **Tool fixture → Unsafe baseline → Get greedy** and execute the 500-credit proposal.
4. Choose **Replay call in guarded**. The exact captured arguments are blocked without another model call. Compare the separate ledgers and export the trace.

Replay uses current state, not a time-travel simulation. Reset clears both ledgers, history and traces, but does not reset provider usage.

## Verification and observed results

```sh
npm test
npm run typecheck
npm run build
npm run evaluate
```

The verified implementation has **44 passing tests** and **11 controlled regression scenarios**. Ordinary tests use controlled provider responses and incur no model charges. The evaluator writes [its scenario report](reports/regression-report.json).

Four [captured live workflows](reports/LIVE-VALIDATION.md) made seven provider requests, with $0.0016636 reported cost for those samples. **The model resisted the supplied FAQ injection in both live modes. No successful live prompt injection is claimed.** The controlled fixture demonstrates the unsafe code's actual 500-credit effect; guarded replay rejects the same proposal. These are different kinds of evidence.

See [verification details](VERIFICATION.md) for tested boundaries, integration failures, repairs and limitations.

## Understand the code

The [technical guide](PRESENTATION-GUIDE.md) explains the architecture, code decisions, tradeoffs, a five-minute demo and design FAQs. A navigable, printable version is available at `/guide.html` while the client runs.

| File | Responsibility |
|---|---|
| `src/credit.ts` | Runtime arguments, guarded/unsafe policy and ledger effects |
| `src/retrieval.ts` | FAQ corpus, lexical ranking and document versions |
| `src/openrouter.ts` | Native tool contract, provider validation, budgets and usage |
| `src/agent.ts` | Bounded model/tool loop, verified reply and trace |
| `src/app.ts` | Local API, scoped state, concurrency, replay and export |
| `client/App.tsx` | Playground controls, FAQ editor, history and ledger |
| `client/TraceInspector.tsx` | Evidence, model drafts, tool results and replay |
| `src/evaluate.ts` | Controlled scenarios with actual synthetic tool effects |

## Scope and limits

This is a local learning demonstration with one shared session, fictional data and volatile state. It has no production authentication, durable transactions or real financial integration. It does not establish general prompt-injection resistance, production readiness or a statistical model benchmark. Do not expose the intentionally unsafe demo to the public internet or use real customer data in its traces.
