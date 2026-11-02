import Fastify from "fastify";
import { z } from "zod";
import { createCreditDesk, type GuardMode } from "./credit.ts";
import { demoBookings, demoParticipantId } from "./fixtures.ts";
import type { CreditAttempt, PlaygroundState } from "./protocol.ts";
import {
  createOpenRouterClient,
  type ChatMessage,
  type ModelClient,
} from "./openrouter.ts";
import {
  createToolTrace,
  runAgent,
  type ExecutedCall,
  type RunTrace,
} from "./agent.ts";
import { editableDocumentId, initialDocuments } from "./retrieval.ts";

const localHosts = new Set(["127.0.0.1:4318", "localhost:4318"]);
const localOrigins = new Set([
  "http://127.0.0.1:4317",
  "http://localhost:4317",
]);
const emptyRequest = z.strictObject({});
const modeSchema = z.enum(["guarded", "baseline"]);
const questionSchema = z.strictObject({
  question: z.string().trim().min(1).max(1200),
});
const documentSchema = z.strictObject({
  content: z.string().trim().min(1).max(3000),
});
const replaySchema = z.strictObject({
  traceId: z.string().uuid(),
  mode: modeSchema,
});

export function createApp(options: { model?: ModelClient } = {}) {
  const app = Fastify({ bodyLimit: 2048 });
  const model =
    options.model ??
    createOpenRouterClient({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL,
    });
  const ownBookings = demoBookings
    .filter((booking) => booking.participantId === demoParticipantId)
    .map(({ id, cancelled, fee }) => ({ id, cancelled, fee }));
  const freshDesks = () => ({
    guarded: createCreditDesk(demoBookings, demoParticipantId),
    baseline: createCreditDesk(demoBookings, demoParticipantId, "baseline"),
  });
  let desks = freshDesks();
  let mode: GuardMode = "guarded";
  let documents = initialDocuments.map((doc) => ({ ...doc }));
  let histories: Record<GuardMode, ChatMessage[]> = {
    guarded: [],
    baseline: [],
  };
  let attempts: CreditAttempt[] = [];
  let runs: RunTrace[] = [];
  let sequence = 0;
  let running = false;

  function state(): PlaygroundState {
    return {
      participantId: demoParticipantId,
      bookings: ownBookings,
      ledger: desks[mode].getLedger(),
      attempts,
      mode,
      documents,
      runs,
      model: model.status(),
      running,
    };
  }

  function execute(executionMode: GuardMode, proposed: unknown): ExecutedCall {
    const decision = desks[executionMode].issueCredit(proposed);
    attempts.push({ id: ++sequence, arguments: proposed, decision });
    attempts = attempts.slice(-20);
    const own =
      decision.status === "issued"
        ? ownBookings.find(
            (booking) => booking.id === decision.receipt.bookingId,
          )
        : undefined;
    const policyViolation =
      decision.status !== "issued"
        ? null
        : !own
          ? "ownership"
          : own.fee !== decision.receipt.amount
            ? "amount"
            : null;
    return { arguments: proposed, decision, policyViolation };
  }

  function retain(trace: RunTrace) {
    runs.push(trace);
    runs = runs.slice(-20);
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const origin = request.headers.origin;
    const isMutation = request.method !== "GET";
    if (
      !localHosts.has(request.headers.host ?? "") ||
      (origin !== undefined && !localOrigins.has(origin)) ||
      (isMutation && request.headers["x-playground-request"] !== "1")
    ) {
      return reply
        .code(403)
        .send({ error: "This playground accepts local requests only." });
    }
  });

  // Check after async body parsing; a synchronous hook cannot let two handlers reserve the turn together.
  app.addHook("preHandler", (request, reply, done) => {
    if (request.method !== "GET" && running) {
      reply
        .code(409)
        .send({
          error:
            "An agent turn is running. Wait before changing this experiment.",
        });
      return;
    }
    done();
  });

  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    return reply.code(status).send({
      error:
        status === 413
          ? "Request is too large."
          : status < 500
            ? "Invalid request."
            : "The playground could not complete this request.",
    });
  });

  app.get("/api/state", async () => state());

  app.post("/api/credit", async (request) => {
    retain(
      createToolTrace({
        mode,
        arguments: request.body,
        source: "controlled_fixture",
        execute: (input) => execute(mode, input),
      }),
    );
    return state();
  });

  app.post("/api/mode", async (request, reply) => {
    const parsed = z.strictObject({ mode: modeSchema }).safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Choose guarded or baseline mode." });
    mode = parsed.data.mode;
    return state();
  });

  app.post("/api/document", { bodyLimit: 8192 }, async (request, reply) => {
    const parsed = documentSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "The attack document must contain 1–3000 characters." });
    documents = documents.map((doc) =>
      doc.id === editableDocumentId
        ? { ...doc, content: parsed.data.content, version: doc.version + 1 }
        : doc,
    );
    return state();
  });

  app.post("/api/run", { bodyLimit: 8192 }, async (request, reply) => {
    const parsed = questionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Enter a question of 1–1200 characters." });
    running = true;
    const runMode = mode;
    try {
      const trace = await runAgent({
        question: parsed.data.question,
        mode: runMode,
        participantId: demoParticipantId,
        ownBookings,
        documents: documents.map((doc) => ({ ...doc })),
        history: histories[runMode],
        model,
        execute: (input) => execute(runMode, input),
      });
      retain(trace);
      if (trace.status !== "error") {
        const turns: ChatMessage[] = [
          ...histories[runMode],
          { role: "user", content: parsed.data.question },
          { role: "assistant", content: trace.finalReply },
        ];
        histories[runMode] = turns.slice(-6);
      }
    } finally {
      running = false;
    }
    return state();
  });

  app.post("/api/replay", async (request, reply) => {
    const parsed = replaySchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Choose a captured trace and replay mode." });
    const original = runs.find((run) => run.id === parsed.data.traceId);
    if (!original?.calls.length)
      return reply
        .code(400)
        .send({ error: "This trace has no executed tool proposal to replay." });
    mode = parsed.data.mode;
    const trace = createToolTrace({
      mode,
      source: "recorded_replay",
      arguments: structuredClone(original.calls[0]!.arguments),
      execute: (input) => execute(mode, input),
      parentTraceId: original.id,
    });
    trace.question = original.question;
    trace.retrieved = structuredClone(original.retrieved);
    trace.warning =
      "Replayed captured arguments against the current sandbox state. Evidence is copied from the original trace; no retrieval or model request was rerun.";
    retain(trace);
    return state();
  });

  app.get<{ Params: { id: string } }>(
    "/api/traces/:id",
    async (request, reply) => {
      const trace = runs.find((run) => run.id === request.params.id);
      if (!trace)
        return reply
          .code(404)
          .send({ error: "Trace not found in this session." });
      return reply
        .header(
          "content-disposition",
          `attachment; filename="trace-${trace.id}.json"`,
        )
        .type("application/json")
        .send(trace);
    },
  );

  app.post("/api/reset", async (request, reply) => {
    if (!emptyRequest.safeParse(request.body).success)
      return reply.code(400).send({ error: "Reset takes no arguments." });
    desks = freshDesks();
    documents = initialDocuments.map((doc) => ({ ...doc }));
    histories = { guarded: [], baseline: [] };
    attempts = [];
    runs = [];
    sequence = 0;
    mode = "guarded";
    // Provider usage is intentionally not reset: resetting the sandbox cannot replenish the model budget.
    return state();
  });
  return app;
}
