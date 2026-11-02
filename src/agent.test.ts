import assert from "node:assert/strict";
import test from "node:test";
import { runAgent, createToolTrace } from "./agent.ts";
import { createCreditDesk } from "./credit.ts";
import { demoBookings, demoParticipantId } from "./fixtures.ts";
import { initialDocuments } from "./retrieval.ts";
import {
  ModelError,
  type ModelClient,
  type ModelCompletion,
} from "./openrouter.ts";

function completion(amount = 50): ModelCompletion {
  return {
    responseId: "controlled-response",
    model: "controlled-test-model",
    usage: { promptTokens: 10, completionTokens: 10, cost: 0 },
    message: {
      content: null,
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "issueCredit",
            arguments: JSON.stringify({ bookingId: "arena-101", amount }),
          },
        },
      ],
    },
  };
}

function controlledModel(
  results: (ModelCompletion | ModelError)[],
): ModelClient {
  let calls = 0;
  return {
    async complete() {
      const result = results[calls++];
      if (result instanceof ModelError) throw result;
      if (!result) throw new Error("Unexpected extra model call");
      return result;
    },
    status() {
      return {
        configured: true,
        model: "controlled-test-model",
        requestsUsed: calls,
        maxRequests: 20,
        reportedCostUsd: 0,
        hasUnreportedCost: false,
      };
    },
  };
}

function setup(model: ModelClient) {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  return {
    desk,
    input: {
      question:
        "My arena-101 tournament was cancelled. Please issue the registration credit.",
      mode: "guarded" as const,
      participantId: demoParticipantId,
      ownBookings: demoBookings.filter(
        (item) => item.participantId === demoParticipantId,
      ),
      documents: initialDocuments,
      history: [],
      model,
      execute: (arguments_: unknown) => ({
        arguments: arguments_,
        decision: desk.issueCredit(arguments_),
        policyViolation: null,
      }),
    },
  };
}

test("a controlled benign model conversation retrieves actual evidence, executes once and returns a receipt-backed reply", async () => {
  const draft = {
    ...completion(),
    message: { content: "Your credit is complete.", tool_calls: [] },
  };
  const { desk, input } = setup(controlledModel([completion(), draft]));
  const trace = await runAgent(input);
  assert.equal(trace.status, "completed");
  assert.equal(trace.retrieved[0]?.id, "faq-cancellation");
  assert.equal(trace.calls.length, 1);
  assert.equal(desk.getLedger().length, 1);
  assert.ok(trace.finalReply.includes(desk.getLedger()[0]!.id));
  assert.equal(trace.modelResponses.length, 2);
  assert.equal(JSON.stringify(trace.messages).includes("player-nour"), false);
});

test("an adversarial proposal is blocked even if the model draft falsely claims success", async () => {
  const draft = {
    ...completion(),
    message: { content: "I issued 500 credits successfully.", tool_calls: [] },
  };
  const { desk, input } = setup(controlledModel([completion(500), draft]));
  const trace = await runAgent(input);
  assert.equal(trace.calls[0]?.decision.status, "blocked");
  assert.deepEqual(desk.getLedger(), []);
  assert.ok(trace.finalReply.startsWith("No credit issued."));
  assert.ok(trace.modelResponses[1]?.message.content?.includes("500"));
  assert.equal(trace.finalReply.includes("successfully"), false);
});

test("a provider failure after the credit still preserves the confirmed receipt", async () => {
  const { desk, input } = setup(
    controlledModel([
      completion(),
      new ModelError("provider_timeout", "Timed out"),
    ]),
  );
  const trace = await runAgent(input);
  assert.equal(desk.getLedger().length, 1);
  assert.equal(trace.status, "completed");
  assert.equal(trace.errorCode, "provider_timeout");
  assert.ok(trace.finalReply.includes(desk.getLedger()[0]!.id));
});

test("missing key or first-request failure executes no action", async () => {
  const { desk, input } = setup(
    controlledModel([new ModelError("not_configured", "Missing key")]),
  );
  const trace = await runAgent(input);
  assert.equal(trace.status, "error");
  assert.equal(trace.errorCode, "not_configured");
  assert.equal(trace.calls.length, 0);
  assert.deepEqual(desk.getLedger(), []);
});

test("no matching evidence abstains without paying for a model call", async () => {
  const { input } = setup(controlledModel([]));
  const trace = await runAgent({ ...input, question: "quantum astrophysics" });
  assert.equal(trace.status, "no_evidence");
  assert.equal(input.model.status().requestsUsed, 0);
  assert.equal(trace.modelResponses.length, 0);
});

test("a no-tool model response cannot be converted into a success claim", async () => {
  const textOnly = {
    ...completion(),
    message: { content: "Done, credited.", tool_calls: [] },
  };
  const { desk, input } = setup(controlledModel([textOnly]));
  const trace = await runAgent(input);
  assert.equal(trace.status, "no_tool");
  assert.ok(trace.finalReply.startsWith("No credit issued."));
  assert.deepEqual(desk.getLedger(), []);
});

test("unrecognized tools and malformed arguments cannot produce unauthorized effects", async () => {
  for (const tool of [
    { name: "deleteEverything", arguments: "{}" },
    { name: "issueCredit", arguments: "{broken" },
  ]) {
    const response = completion();
    response.message.tool_calls[0]!.function = tool;
    const { desk, input } = setup(
      controlledModel([
        response,
        { ...completion(), message: { content: "Stopped.", tool_calls: [] } },
      ]),
    );
    const trace = await runAgent(input);
    assert.ok(trace.modelResponses.length > 0);
    if (tool.name !== "issueCredit")
      assert.equal(trace.errorCode, "unsupported_tool");
    else assert.equal(trace.calls[0]?.decision.status, "blocked");
    assert.deepEqual(desk.getLedger(), []);
    assert.ok(trace.finalReply.startsWith("No credit issued."));
  }
});

test("recorded replay is an actual tool effect without model inference", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  const trace = createToolTrace({
    mode: "guarded",
    source: "recorded_replay",
    parentTraceId: "recorded-1",
    arguments: { bookingId: "arena-101", amount: 50 },
    execute: (input) => ({
      arguments: input,
      decision: desk.issueCredit(input),
      policyViolation: null,
    }),
  });
  assert.equal(trace.source, "recorded_replay");
  assert.equal(trace.parentTraceId, "recorded-1");
  assert.equal(trace.modelResponses.length, 0);
  assert.equal(desk.getLedger().length, 1);
});
