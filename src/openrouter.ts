import { z } from "zod";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ModelCompletion {
  message: {
    content: string | null;
    tool_calls: ToolCall[];
    refusal?: string | null;
  };
  finishReason?: string | null;
  responseId: string | null;
  model: string | null;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    cost: number | null;
  };
}

export interface ModelStatus {
  configured: boolean;
  model: string;
  requestsUsed: number;
  maxRequests: number;
  reportedCostUsd: number;
  hasUnreportedCost: boolean;
}

export interface ModelClient {
  complete(
    messages: readonly ChatMessage[],
    allowTool: boolean,
  ): Promise<ModelCompletion>;
  status(): ModelStatus;
}

export class ModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const creditTool = {
  type: "function" as const,
  function: {
    name: "issueCredit",
    description:
      "Request one full registration-fee credit for the current participant’s cancelled booking. Application code authorizes the action.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        bookingId: { type: "string", minLength: 1, maxLength: 80 },
        amount: { type: "integer", minimum: 1 },
      },
      required: ["bookingId", "amount"],
    },
  },
};

export function createOpenRouterClient(
  config: { apiKey?: string; model?: string },
  transport: typeof fetch = fetch,
): ModelClient {
  const apiKey = config.apiKey?.trim() ?? "";
  const model = config.model?.trim() || "openai/gpt-4.1-mini";
  let requestsUsed = 0;
  let reportedCostUsd = 0;
  let hasUnreportedCost = false;
  const responseSchema = z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    choices: z
      .array(
        z.object({
          finish_reason: z.string().nullable().optional(),
          message: z.object({
            content: z.string().max(6000).nullable().optional(),
            refusal: z.string().max(6000).nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  id: z.string().min(1),
                  type: z.literal("function"),
                  function: z.object({
                    name: z.string().max(80),
                    arguments: z.string().max(6000),
                  }),
                }),
              )
              .max(1)
              .optional(),
          }),
        }),
      )
      .min(1)
      .max(1),
    usage: z
      .object({
        prompt_tokens: z.int().nonnegative().optional(),
        completion_tokens: z.int().nonnegative().optional(),
        cost: z.number().nonnegative().nullable().optional(),
      })
      .optional(),
  });

  return {
    async complete(messages, allowTool) {
      if (!apiKey)
        throw new ModelError(
          "not_configured",
          "Add your OpenRouter key to the local .env file.",
        );
      if (requestsUsed >= 20)
        throw new ModelError(
          "budget_exhausted",
          "This server session has reached its 20 model-request limit.",
        );
      if (JSON.stringify(messages).length > 24000)
        throw new ModelError(
          "context_limit",
          "The selected context exceeds the demo limit. Shorten the question or document.",
        );
      requestsUsed++;
      try {
        const response = await transport(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              tools: [creditTool],
              tool_choice: allowTool ? "auto" : "none",
              max_tokens: 400,
              temperature: 0,
              provider: {
                require_parameters: true,
                max_price: { prompt: 1, completion: 4, request: 0 },
              },
            }),
            signal: AbortSignal.timeout(25000),
          },
        );
        if (!response.ok)
          throw new ModelError(
            `provider_http_${response.status}`,
            `OpenRouter returned HTTP ${response.status}. Check the local key, balance and model configuration.`,
          );
        let raw: unknown;
        try {
          raw = await response.json();
        } catch {
          throw new ModelError(
            "invalid_model_response",
            "OpenRouter returned unreadable JSON. No new tool call was executed.",
          );
        }
        const parsed = responseSchema.safeParse(raw);
        if (!parsed.success)
          throw new ModelError(
            "invalid_model_response",
            "OpenRouter returned an unsupported response shape. No new tool call was executed.",
          );
        const data = parsed.data;
        const message = data.choices[0]!.message;
        const cost = data.usage?.cost ?? null;
        if (cost === null) hasUnreportedCost = true;
        else reportedCostUsd += cost;
        return {
          message: {
            content: message.content ?? null,
            tool_calls: message.tool_calls ?? [],
            refusal: message.refusal ?? null,
          },
          finishReason: data.choices[0]!.finish_reason ?? null,
          model: data.model ?? null,
          responseId: data.id ?? null,
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? null,
            completionTokens: data.usage?.completion_tokens ?? null,
            cost,
          },
        };
      } catch (error) {
        hasUnreportedCost = true;
        if (error instanceof ModelError) throw error;
        if (
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
        )
          throw new ModelError(
            "provider_timeout",
            "OpenRouter did not respond within the request deadline.",
          );
        throw new ModelError(
          "provider_unavailable",
          "The model service could not be reached. No automatic retry was made.",
        );
      }
    },
    status() {
      return {
        configured: Boolean(apiKey),
        model,
        requestsUsed,
        maxRequests: 20,
        reportedCostUsd,
        hasUnreportedCost,
      };
    },
  };
}
