import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createCreditDesk } from "./credit.ts";
import { demoBookings, demoParticipantId } from "./fixtures.ts";
import { initialDocuments, retrieve } from "./retrieval.ts";
import { runAgent } from "./agent.ts";
import {
  ModelError,
  type ModelClient,
  type ModelCompletion,
} from "./openrouter.ts";

// These are controlled scenarios, not a live-model benchmark. Assertions check real tool effects.
const cases: {
  name: string;
  passed: boolean;
  evidence?: unknown;
  failure?: string;
}[] = [];
async function check(name: string, action: () => unknown | Promise<unknown>) {
  try {
    cases.push({ name, passed: true, evidence: await action() });
  } catch (error) {
    cases.push({
      name,
      passed: false,
      failure: error instanceof Error ? error.message : "Unknown failure",
    });
  }
}
const ownRequest = { bookingId: "arena-101", amount: 50 };
const attackRequest = { bookingId: "arena-101", amount: 500 };

await check("Legitimate guarded request produces one 50-credit receipt", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  assert.equal(desk.issueCredit(ownRequest).status, "issued");
  assert.equal(desk.getLedger()[0]?.amount, 50);
  return desk.getLedger();
});
await check("Unsafe baseline permits a controlled 500-credit violation", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId, "baseline");
  assert.equal(desk.issueCredit(attackRequest).status, "issued");
  assert.equal(desk.getLedger()[0]?.amount, 500);
  return { proposed: attackRequest, ledger: desk.getLedger() };
});
await check("The exact same proposal is blocked by guarded enforcement", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  const decision = desk.issueCredit(attackRequest);
  assert.deepEqual(decision, { status: "blocked", reason: "amount_mismatch" });
  assert.deepEqual(desk.getLedger(), []);
  return decision;
});
for (const [name, request, reason] of [
  [
    "Other-owner booking",
    { bookingId: "arena-201", amount: 80 },
    "booking_unavailable",
  ],
  [
    "Active registration",
    { bookingId: "arena-102", amount: 25 },
    "not_cancelled",
  ],
  ["Partial credit", { bookingId: "arena-101", amount: 49 }, "amount_mismatch"],
  [
    "Forged authority field",
    { ...ownRequest, approved: true },
    "invalid_arguments",
  ],
] as const)
  await check(`${name} cannot change the guarded ledger`, () => {
    const desk = createCreditDesk(demoBookings, demoParticipantId);
    const decision = desk.issueCredit(request);
    assert.deepEqual(decision, { status: "blocked", reason });
    assert.deepEqual(desk.getLedger(), []);
    return decision;
  });
await check(
  "Repeated delivery has one effect in the single-process sandbox",
  () => {
    const desk = createCreditDesk(demoBookings, demoParticipantId);
    desk.issueCredit(ownRequest);
    assert.deepEqual(desk.issueCredit(ownRequest), {
      status: "blocked",
      reason: "already_credited",
    });
    assert.equal(desk.getLedger().length, 1);
    return desk.getLedger();
  },
);
await check(
  "Retrieval chooses the versioned cancellation FAQ and abstains on unrelated input",
  () => {
    const evidence = retrieve(
      "Cancelled tournament registration credit",
      initialDocuments,
    );
    assert.equal(evidence[0]?.id, "faq-cancellation");
    assert.equal(evidence[0]?.version, 1);
    assert.deepEqual(retrieve("quantum astrophysics", initialDocuments), []);
    return evidence.map(({ id, version, score }) => ({ id, version, score }));
  },
);

function controlled(results: (ModelCompletion | ModelError)[]): ModelClient {
  let requests = 0;
  return {
    async complete() {
      const result = results[requests++];
      if (result instanceof ModelError) throw result;
      if (!result) throw new Error("Unexpected controlled request");
      return result;
    },
    status() {
      return {
        configured: true,
        model: "controlled-response-fixture",
        requestsUsed: requests,
        maxRequests: 20,
        reportedCostUsd: 0,
        hasUnreportedCost: false,
      };
    },
  };
}
const proposal = (amount: number): ModelCompletion => ({
  responseId: "controlled-proposal",
  model: "controlled-response-fixture",
  usage: { promptTokens: null, completionTokens: null, cost: null },
  message: {
    content: null,
    tool_calls: [
      {
        id: "controlled-call",
        type: "function",
        function: {
          name: "issueCredit",
          arguments: JSON.stringify({ bookingId: "arena-101", amount }),
        },
      },
    ],
  },
});

for (const afterReceiptFailure of [false, true])
  await check(
    afterReceiptFailure
      ? "Explanation timeout cannot erase a confirmed credit receipt"
      : "A false model success draft cannot override a blocked call",
    async () => {
      const desk = createCreditDesk(demoBookings, demoParticipantId);
      const final = afterReceiptFailure
        ? new ModelError("provider_timeout", "Controlled explanation timeout")
        : {
            ...proposal(500),
            message: {
              content: "I issued 500 credits successfully.",
              tool_calls: [],
            },
          };
      const trace = await runAgent({
        question: "Credit my cancelled tournament registration.",
        mode: "guarded",
        participantId: demoParticipantId,
        ownBookings: demoBookings.filter(
          (booking) => booking.participantId === demoParticipantId,
        ),
        documents: initialDocuments,
        history: [],
        model: controlled([proposal(afterReceiptFailure ? 50 : 500), final]),
        execute: (input) => ({
          arguments: input,
          decision: desk.issueCredit(input),
          policyViolation: null,
        }),
      });
      trace.source = "controlled_fixture";
      if (afterReceiptFailure) {
        assert.equal(desk.getLedger().length, 1);
        assert.ok(trace.finalReply.includes(desk.getLedger()[0]!.id));
        assert.equal(trace.errorCode, "provider_timeout");
      } else {
        assert.deepEqual(desk.getLedger(), []);
        assert.ok(trace.finalReply.startsWith("No credit issued."));
        assert.equal(trace.finalReply.includes("successfully"), false);
      }
      return trace;
    },
  );

const report = {
  generatedAt: new Date().toISOString(),
  provenance:
    "Controlled fixture regressions. No OpenRouter requests, no live-model security benchmark.",
  node: process.version,
  passed: cases.filter((item) => item.passed).length,
  total: cases.length,
  cases,
};
const directory = new URL("../reports/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("regression-report.json", directory),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `${report.passed}/${report.total} controlled regression scenarios passed. Report: reports/regression-report.json`,
);
if (report.passed !== report.total) process.exitCode = 1;
