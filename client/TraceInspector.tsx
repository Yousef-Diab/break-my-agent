import type { RunTrace } from "../src/agent.ts";
import type { GuardMode } from "../src/credit.ts";
import type { RetrievedPassage } from "../src/retrieval.ts";

export const sourceLabels: Record<RunTrace["source"], string> = {
  live_model: "Live agent run",
  recorded_replay: "Recorded call replay",
  controlled_fixture: "Controlled tool fixture",
  direct_tool: "Direct tool test",
};

export default function TraceInspector({
  trace,
  preview,
  disabled,
  replay,
}: {
  trace: RunTrace | null;
  preview: RetrievedPassage[];
  disabled: boolean;
  replay: (mode: GuardMode) => void;
}) {
  const evidence = trace ? trace.retrieved : preview;
  return (
    <section className="card trace-card" aria-labelledby="trace-title">
      <div className="card-heading">
        <div className="section-number">03</div>
        <div>
          <div className="eyebrow">SHOW YOUR WORK</div>
          <h2 id="trace-title">Evidence & execution</h2>
        </div>
        <span className="small-badge">
          {trace ? sourceLabels[trace.source] : "Retrieval preview"}
        </span>
      </div>
      <div className="trace-body">
        <div className="trace-summary">
          {trace ? (
            <>
              <span>{trace.mode}</span>
              <span>{trace.providerRequests} provider requests</span>
              <span>{trace.durationMs} ms</span>
              <span>{trace.policyVersion}</span>
            </>
          ) : (
            <span>
              Preview of the current question and saved FAQ. A run captures its
              own evidence.
            </span>
          )}
        </div>
        <div className="trace-step">
          <span className="step-dot">1</span>
          <div>
            <h3>
              {trace?.source === "recorded_replay"
                ? "Original captured evidence"
                : "Retrieved evidence"}
            </h3>
            <p>
              Real lexical ranking · title match = 2, body match = 1 · top 2
            </p>
          </div>
        </div>
        <div className="evidence-list">
          {evidence.length ? (
            evidence.map((hit) => (
              <details key={hit.id} className="evidence-item">
                <summary>
                  <span>
                    <strong>{hit.title}</strong>
                    <small>
                      {hit.id} · v{hit.version}
                    </small>
                  </span>
                  <span className="score">{hit.score} pts</span>
                </summary>
                <p>{hit.content}</p>
                <small className="matched-terms">
                  Matched: {hit.matchedTerms.join(", ")}
                </small>
              </details>
            ))
          ) : (
            <p className="muted-note">
              {trace && trace.source !== "live_model"
                ? "This tool-only execution did not run retrieval."
                : "No matching evidence. The agent abstains rather than inventing a source."}
            </p>
          )}
        </div>
        <div className="trace-step">
          <span className="step-dot">2</span>
          <div>
            <h3>Model proposal & actual tool result</h3>
            <p>
              {trace?.requestedModel ??
                "No model called for a tool fixture or replay."}
            </p>
          </div>
        </div>
        {trace?.calls.length ? (
          trace.calls.map((call, index) => (
            <div className="tool-evidence" key={index}>
              <code>issueCredit({JSON.stringify(call.arguments)})</code>
              <div className={`call-result ${call.decision.status}`}>
                {call.decision.status === "issued"
                  ? `Receipt ${call.decision.receipt.id}`
                  : `Blocked: ${call.decision.reason}`}
              </div>
              {call.policyViolation && (
                <strong className="violation-note">
                  Approved policy violated: {call.policyViolation}. The unsafe
                  baseline permitted this.
                </strong>
              )}
            </div>
          ))
        ) : (
          <p className="muted-note">
            {trace
              ? "No tool call executed. A model response alone is not an action."
              : "Run an experiment to see the actual proposal and decision."}
          </p>
        )}
        {trace && (
          <>
            <div className="trace-step">
              <span className="step-dot">3</span>
              <div>
                <h3>Verified outcome</h3>
                <p>Generated from the executed tool result, not model prose.</p>
              </div>
            </div>
            <p className="verified-reply">{trace.finalReply}</p>
            {trace.warning && <p className="trace-warning">{trace.warning}</p>}
            {trace.errorCode && (
              <p className="trace-error">Service status: {trace.errorCode}</p>
            )}
            {trace.modelResponses.map((response, index) => (
              <details className="draft-detail" key={index}>
                <summary>
                  Model response {index + 1} ·{" "}
                  {response.model ?? "model not reported"}{" "}
                  <span>Unverified draft / proposal</span>
                </summary>
                {response.message.refusal && (
                  <p className="trace-error">
                    Provider refusal: {response.message.refusal}
                  </p>
                )}
                <p>Finish reason: {response.finishReason ?? "Not reported"}</p>
                <pre>
                  {response.message.content ?? "(Tool proposal; no text draft)"}
                </pre>
                <p>
                  {response.usage.promptTokens ?? "?"} input /{" "}
                  {response.usage.completionTokens ?? "?"} output tokens ·{" "}
                  {response.usage.cost === null
                    ? "Cost not reported"
                    : `$${response.usage.cost.toFixed(6)} reported`}
                </p>
              </details>
            ))}
            {trace.messages.length > 0 && (
              <details className="draft-detail">
                <summary>
                  Inspect the exact messages{" "}
                  <span>Observable context, not hidden reasoning</span>
                </summary>
                <pre>{JSON.stringify(trace.messages, null, 2)}</pre>
              </details>
            )}
            <div className="trace-actions">
              <button
                type="button"
                disabled={disabled || !trace.calls.length}
                onClick={() => replay("guarded")}
              >
                Replay call in guarded ↗
              </button>
              <button
                type="button"
                disabled={disabled || !trace.calls.length}
                onClick={() => replay("baseline")}
              >
                Replay in baseline
              </button>
              <a href={`/api/traces/${trace.id}`} download>
                Export trace ↓
              </a>
            </div>
            <p className="muted-note">
              Replay uses captured arguments against current sandbox state. It
              makes no new model request.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
