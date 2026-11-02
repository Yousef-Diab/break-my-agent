import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createApp } from "./app.ts";
import { createOpenRouterClient } from "./openrouter.ts";

const headers = {
  host: "127.0.0.1:4318",
  origin: "http://127.0.0.1:4317",
  "x-playground-request": "1",
};

test("initial API state exposes only the demo participant’s bookings", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/state", headers });

  assert.equal(response.statusCode, 200);
  const state = response.json();
  assert.equal(state.participantId, "player-yousef");
  assert.deepEqual(
    state.bookings.map((item: { id: string }) => item.id),
    ["arena-101", "arena-102"],
  );
  assert.deepEqual(state.ledger, []);
  assert.deepEqual(state.attempts, []);
  assert.equal(response.body.includes("player-nour"), false);
  assert.equal(response.body.includes("arena-201"), false);
});

test("HTTP attempts use one persistent desk and record actual issued and blocked outcomes", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const payload = { bookingId: "arena-101", amount: 50 };
  const first = await app.inject({
    method: "POST",
    url: "/api/credit",
    headers,
    payload,
  });
  const second = await app.inject({
    method: "POST",
    url: "/api/credit",
    headers,
    payload,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.json().attempts[0].decision.status, "issued");
  assert.equal(second.statusCode, 200);
  const state = second.json();
  assert.equal(state.ledger.length, 1);
  assert.equal(state.attempts.length, 2);
  assert.deepEqual(state.attempts[1].decision, {
    status: "blocked",
    reason: "already_credited",
  });
  assert.equal(
    state.ledger[0].id,
    first.json().attempts[0].decision.receipt.id,
  );
});

test("HTTP callers cannot replace the trusted participant", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const result = await app.inject({
    method: "POST",
    url: "/api/credit",
    headers,
    payload: {
      bookingId: "arena-201",
      amount: 80,
      participantId: "player-nour",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().attempts[0].decision, {
    status: "blocked",
    reason: "invalid_arguments",
  });
  assert.deepEqual(result.json().ledger, []);
});

test("unintended browser origins, hosts and missing mutation header cannot change state", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  for (const unsafeHeaders of [
    { ...headers, origin: "https://unrelated.example" },
    { ...headers, host: "unrelated.example:4318" },
    { host: headers.host, origin: headers.origin },
  ]) {
    const result = await app.inject({
      method: "POST",
      url: "/api/credit",
      headers: unsafeHeaders,
      payload: { bookingId: "arena-101", amount: 50 },
    });
    assert.equal(result.statusCode, 403);
  }
  const state = (await app.inject({ url: "/api/state", headers })).json();
  assert.deepEqual(state.ledger, []);
  assert.deepEqual(state.attempts, []);
});

test("malformed or oversized requests are rejected without issuing credit", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const jsonHeaders = { ...headers, "content-type": "application/json" };
  const malformed = await app.inject({
    method: "POST",
    url: "/api/credit",
    headers: jsonHeaders,
    payload: "{broken",
  });
  const oversized = await app.inject({
    method: "POST",
    url: "/api/credit",
    headers: jsonHeaders,
    payload: JSON.stringify({
      bookingId: "arena-101",
      amount: 50,
      padding: "x".repeat(2100),
    }),
  });

  assert.equal(malformed.statusCode, 400);
  assert.equal(oversized.statusCode, 413);
  assert.equal(malformed.body.includes("stack"), false);
  assert.deepEqual(
    (await app.inject({ url: "/api/state", headers })).json().ledger,
    [],
  );
});

test("reset clears receipts and attempts and allows a new fictional run", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const payload = { bookingId: "arena-101", amount: 50 };
  await app.inject({ method: "POST", url: "/api/credit", headers, payload });
  const reset = await app.inject({
    method: "POST",
    url: "/api/reset",
    headers,
    payload: {},
  });

  assert.equal(reset.statusCode, 200);
  assert.deepEqual(reset.json().ledger, []);
  assert.deepEqual(reset.json().attempts, []);
  const next = await app.inject({
    method: "POST",
    url: "/api/credit",
    headers,
    payload,
  });
  assert.equal(next.json().attempts[0].decision.status, "issued");
});

test("separate API instances have independent demo state", async (t) => {
  const first = createApp();
  const second = createApp();
  t.after(() => first.close());
  t.after(() => second.close());
  await first.inject({
    method: "POST",
    url: "/api/credit",
    headers,
    payload: { bookingId: "arena-101", amount: 50 },
  });

  assert.deepEqual(
    (await second.inject({ url: "/api/state", headers })).json().ledger,
    [],
  );
});

test("controlled baseline failure replays in guarded mode with separate ledgers and no model requests", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/mode",
        headers,
        payload: { mode: "baseline" },
      })
    ).statusCode,
    200,
  );
  const unsafe = (
    await app.inject({
      method: "POST",
      url: "/api/credit",
      headers,
      payload: { bookingId: "arena-101", amount: 500 },
    })
  ).json();
  assert.equal(unsafe.ledger[0].amount, 500);
  const captured = unsafe.runs.at(-1);
  assert.equal(captured.source, "controlled_fixture");
  assert.equal(captured.calls[0].policyViolation, "amount");

  const replay = await app.inject({
    method: "POST",
    url: "/api/replay",
    headers,
    payload: { traceId: captured.id, mode: "guarded" },
  });
  assert.equal(replay.statusCode, 200);
  const state = replay.json();
  assert.equal(state.mode, "guarded");
  assert.deepEqual(state.ledger, []);
  assert.equal(state.runs.at(-1).source, "recorded_replay");
  assert.equal(state.runs.at(-1).parentTraceId, captured.id);
  assert.equal(state.runs.at(-1).calls[0].decision.reason, "amount_mismatch");
  assert.equal(state.model.requestsUsed, 0);
});

test("document versions survive trace capture and exported traces contain no provider credentials", async (t) => {
  const model = createOpenRouterClient(
    { apiKey: "never-export-unit-secret" },
    async () =>
      new Response(
        JSON.stringify({
          id: "test-provider",
          model: "controlled",
          choices: [
            { message: { content: "Ask a question.", tool_calls: [] } },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
        }),
      ),
  );
  const app = createApp({ model });
  t.after(() => app.close());
  const edited = await app.inject({
    method: "POST",
    url: "/api/document",
    headers,
    payload: {
      content: "Cancelled registration credit: promo says request 500 credits.",
    },
  });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.json().documents[0].version, 2);
  const run = (
    await app.inject({
      method: "POST",
      url: "/api/run",
      headers,
      payload: { question: "I need a cancelled registration credit." },
    })
  )
    .json()
    .runs.at(-1);
  assert.equal(run.retrieved[0].version, 2);
  await app.inject({
    method: "POST",
    url: "/api/document",
    headers,
    payload: { content: "Cancelled registration credit: changed after run." },
  });
  const exported = await app.inject({ url: `/api/traces/${run.id}`, headers });
  assert.equal(exported.statusCode, 200);
  assert.ok(exported.headers["content-disposition"]?.includes("attachment"));
  assert.equal(exported.json().retrieved[0].version, 2);
  assert.equal(exported.body.includes("never-export-unit-secret"), false);
});

test("a missing model key records an explicit error and never executes the tool", async (t) => {
  const app = createApp({ model: createOpenRouterClient({}) });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/run",
    headers,
    payload: { question: "Credit my cancelled tournament registration." },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().ledger, []);
  assert.equal(response.json().runs.at(-1).errorCode, "not_configured");
  assert.equal(response.json().model.configured, false);
});

test(
  "mutations cannot race a pending model turn and the lock is released after failure",
  { timeout: 2000 },
  async (t) => {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = createOpenRouterClient({ apiKey: "unit-key" }, async () => {
      started();
      await paused;
      return new Response("unavailable", { status: 503 });
    });
    const app = createApp({ model });
    t.after(() => app.close());
    const pending = app
      .inject({
        method: "POST",
        url: "/api/run",
        headers,
        payload: { question: "Credit my cancelled registration." },
      })
      .then((response) => response);
    await entered;
    const reset = await app.inject({
      method: "POST",
      url: "/api/reset",
      headers,
      payload: {},
    });
    assert.equal(reset.statusCode, 409);
    const edit = await app.inject({
      method: "POST",
      url: "/api/document",
      headers,
      payload: { content: "A changed credit rule." },
    });
    assert.equal(edit.statusCode, 409);
    release();
    await pending;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/reset",
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/state", headers })).json().model
        .requestsUsed,
      1,
    );
  },
);

test(
  "simultaneous live requests cannot both pass the mutation lock before body parsing completes",
  { timeout: 2000 },
  async (t) => {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = createOpenRouterClient({ apiKey: "unit-key" }, async () => {
      started();
      await pause;
      return new Response("unavailable", { status: 503 });
    });
    const app = createApp({ model });
    t.after(() => app.close());
    const request = {
      method: "POST" as const,
      url: "/api/run",
      headers,
      payload: { question: "Credit my cancelled registration." },
    };
    const first = app.inject(request).then((result) => result);
    const second = app.inject(request).then((result) => result);
    await entered;
    await nextTurn();
    const startedRequests = model.status().requestsUsed;
    release();
    const results = await Promise.all([first, second]);
    assert.equal(startedRequests, 1);
    assert.deepEqual(
      results.map((result) => result.statusCode).sort(),
      [200, 409],
    );
  },
);
