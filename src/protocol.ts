import type { Booking, CreditDecision, CreditReceipt } from "./credit.ts";
import type { GuardMode } from "./credit.ts";
import type { RunTrace } from "./agent.ts";
import type { ModelStatus } from "./openrouter.ts";
import type { FaqDocument } from "./retrieval.ts";

export interface CreditAttempt {
  id: number;
  arguments: unknown;
  decision: CreditDecision;
}

export interface PlaygroundState {
  participantId: string;
  bookings: readonly Omit<Booking, "participantId">[];
  ledger: readonly CreditReceipt[];
  attempts: readonly CreditAttempt[];
  mode: GuardMode;
  documents: readonly FaqDocument[];
  runs: readonly RunTrace[];
  model: ModelStatus;
  running: boolean;
}
