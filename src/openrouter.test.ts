import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRouterClient, ModelError } from "./openrouter.ts";

const providerResponse = {
  id: "provider-response-1",
  model: "served-test-model",
  choices: [
    {
      message: {
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "issueCredit",
              arguments: '{"bookingId":"arena-101","amount":50}',
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
};

test("the provider client sends bounded native tool requests and records reported usage", async () => {
  let requested: RequestInit | undefined;
  const client = createOpenRouterClient(
    { apiKey: "unit-test-key" },
    async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      requested = options;
      return new Response(JSON.stringify(providerResponse));
    },
  );
  const completion = await client.complete(
    [{ role: "user", content: "Credit my cancelled registration." }],
    true,
  );
  const body = JSON.parse(String(requested?.body));
  assert.equal(body.max_tokens, 400);
  assert.equal("parallel_tool_calls" in body, false);
  assert.equal(body.tools[0].function.name, "issueCredit");
  assert.equal(body.tool_choice, "auto");
  assert.equal(body.provider.max_price.prompt, 1);
  assert.equal(completion.responseId, "provider-response-1");
  assert.equal(completion.usage.cost, 0.001);
  assert.equal(client.status().reportedCostUsd, 0.001);
  assert.equal(client.status().requestsUsed, 1);
  assert.equal(
    JSON.stringify(client.status()).includes("unit-test-key"),
    false,
  );
});

test("missing key makes no network request", async () => {
  let calls = 0;
  const client = createOpenRouterClient({}, async () => {
    calls++;
    throw new Error("Must not fetch");
  });
  await assert.rejects(
    client.complete([], true),
    (error) => error instanceof ModelError && error.code === "not_configured",
  );
  assert.equal(calls, 0);
});

test("provider errors are sanitized instead of echoing remote bodies or transport errors", async () => {
  const http = createOpenRouterClient(
    { apiKey: "unit-test-key" },
    async () => new Response("private-upstream-detail", { status: 401 }),
  );
  await assert.rejects(
    http.complete([], true),
    (error) =>
      error instanceof ModelError &&
      error.code === "provider_http_401" &&
      !error.message.includes("private-upstream-detail"),
  );
  const timeout = createOpenRouterClient(
    { apiKey: "unit-test-key" },
    async () => {
      throw new DOMException("private-upstream-detail", "TimeoutError");
    },
  );
  await assert.rejects(
    timeout.complete([], true),
    (error) =>
      error instanceof ModelError &&
      error.code === "provider_timeout" &&
      !error.message.includes("private-upstream-detail"),
  );
});

test("malformed provider responses and multiple tool calls are rejected before execution", async () => {
  for (const payload of [
    {},
    {
      ...providerResponse,
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              ...providerResponse.choices[0]!.message.tool_calls,
              ...providerResponse.choices[0]!.message.tool_calls,
            ],
          },
        },
      ],
    },
  ]) {
    const client = createOpenRouterClient(
      { apiKey: "unit-test-key" },
      async () => new Response(JSON.stringify(payload)),
    );
    await assert.rejects(
      client.complete([], true),
      (error) =>
        error instanceof ModelError && error.code === "invalid_model_response",
    );
  }
});

test("request budget holds across calls and final drafting disables additional tools", async () => {
  let calls = 0;
  const client = createOpenRouterClient(
    { apiKey: "unit-test-key" },
    async (_url, options) => {
      calls++;
      assert.equal(JSON.parse(String(options?.body)).tool_choice, "none");
      return new Response(
        JSON.stringify({
          ...providerResponse,
          choices: [{ message: { content: "A draft", tool_calls: [] } }],
        }),
      );
    },
  );
  for (let index = 0; index < 20; index++) await client.complete([], false);
  await assert.rejects(
    client.complete([], false),
    (error) => error instanceof ModelError && error.code === "budget_exhausted",
  );
  assert.equal(calls, 20);
});

test("strict provider routing does not request the unadvertised parallel-tool parameter", async () => {
  const client = createOpenRouterClient(
    { apiKey: "unit-test-key" },
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      if ("parallel_tool_calls" in body && body.provider.require_parameters)
        return new Response("No compatible endpoint", { status: 404 });
      return new Response(JSON.stringify(providerResponse));
    },
  );
  const response = await client.complete(
    [{ role: "user", content: "Credit the cancelled registration." }],
    true,
  );
  assert.equal(response.message.tool_calls.length, 1);
});

test("provider refusals and termination reasons remain observable rather than becoming empty text", async () => {
  const client = createOpenRouterClient(
    { apiKey: "unit-key" },
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "content_filter",
              message: {
                content: null,
                refusal: "Controlled refusal for test.",
              },
            },
          ],
          usage: { cost: 0 },
        }),
      ),
  );
  const result = await client.complete([], true);
  assert.equal(result.message.refusal, "Controlled refusal for test.");
  assert.equal(result.finishReason, "content_filter");
});
