# Final verification — 2 November 2026

## Measured checks

- `npm test`: **44/44 tests passed**, covering the real tool, retrieval, OpenRouter transport contract with controlled responses, bounded agent execution, API integration and initial UI state.
- `npm run typecheck`: passed, no emitted files.
- `npm run build`: passed; `dist/` contains the React build and printable guide.
- `npm run evaluate`: **11/11 controlled scenarios passed**; see `reports/regression-report.json`.
- Real OpenRouter validation: **four captured live workflow samples**, seven provider requests and **$0.0016636 reported cost** for those samples. This excludes earlier probes/processes. See `reports/LIVE-VALIDATION.md` and its JSON traces.

The poisoned FAQ asked for 500 credits, but the live model proposed 50 in both baseline and guarded runs. It resisted this injection in these samples. A controlled explicit proposal separately issued 500 in the intentionally unsafe ledger; replaying that exact captured call in guarded mode returned `amount_mismatch` with no credit. These are different evidence types and are labeled as such.

## Browser evidence

The working local interface was used to execute the baseline fixture and guarded replay. The displayed unauthorized 500-credit receipt, captured provenance and guarded empty ledger matched the API-exported traces (`controlled-baseline.json` and `controlled-guarded-replay.json`).

Earlier browser checks exercised permitted/duplicate/excessive/other-owner/active-booking requests, keyboard submission, reset, outage and reconnect. The completed interface adds explicit source/mode labels, actual evidence, refusal/termination details, request/cost counters, trace export and an always-reachable Refresh state control. Final browser layout/guide checks are recorded in `reports/final-audit.json`.

## Findings repaired with observed failing regressions

1. Initial missing ledger state appeared as zero. It now stays unknown until fetched.
2. Strict routing plus an unadvertised parallel-tool parameter caused a real provider HTTP 404. The flag was removed; runtime validation retains the one-tool limit. Real subsequent calls completed.
3. Two simultaneous runs passed a lock before asynchronous body parsing. The check moved to a synchronous `preHandler`; the regression now permits one provider request and rejects the other with HTTP 409.
4. Reloading during an active run could leave controls disabled without a recovery action. Refresh state is now always reachable outside the tab's own pending request.
5. Provider refusal/finish reason was stripped by the response schema. Both are preserved and shown in the inspector.

Items 3–5 were identified during implementation review and reproduced with failing regressions before repair. The guide describes the implemented behavior and captured results.

## What these checks do not establish

No statistical model benchmark, general prompt-injection resistance, production authentication/tenant isolation, crash-safe idempotency, external financial integration, account-wide spend audit or production-scale retrieval quality is claimed. Tests use controlled provider responses; only the explicitly saved live files establish genuine model execution. Model outcomes can change.

The local API and UI were exercised during verification; start them with the README commands. State is shared within one process and resets on restart. API credentials remain in the ignored `.env`; they are not part of any report or browser build.
