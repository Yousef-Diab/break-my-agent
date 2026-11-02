import { randomUUID } from "node:crypto";
import { z } from "zod";

const creditArguments = z.strictObject({
  bookingId: z.string().min(1).max(80),
  amount: z.int().positive(),
});

export interface Booking {
  readonly id: string;
  readonly participantId: string;
  readonly cancelled: boolean;
  readonly fee: number;
}

export interface CreditReceipt {
  readonly id: string;
  readonly bookingId: string;
  readonly participantId: string;
  readonly amount: number;
}

export type CreditDecision =
  | { status: "issued"; receipt: CreditReceipt }
  | {
      status: "blocked";
      reason:
        | "invalid_arguments"
        | "booking_unavailable"
        | "not_cancelled"
        | "amount_mismatch"
        | "already_credited";
    };

export type GuardMode = "guarded" | "baseline";

export function createCreditDesk(
  bookings: readonly Booking[],
  participantId: string,
  mode: GuardMode = "guarded",
) {
  const approvedBookings = bookings.map((booking) => ({ ...booking }));
  const ledger: CreditReceipt[] = [];

  return {
    issueCredit(input: unknown): CreditDecision {
      const parsed = creditArguments.safeParse(input);
      if (!parsed.success)
        return { status: "blocked", reason: "invalid_arguments" };

      const { bookingId, amount } = parsed.data;
      // Identity comes from the trusted desk setup, never from tool arguments or FAQ text.
      const booking = approvedBookings.find(
        (item) =>
          item.id === bookingId &&
          (mode === "baseline" || item.participantId === participantId),
      );
      if (!booking) return { status: "blocked", reason: "booking_unavailable" };
      if (!booking.cancelled)
        return { status: "blocked", reason: "not_cancelled" };
      if (mode !== "baseline" && amount !== booking.fee)
        return { status: "blocked", reason: "amount_mismatch" };
      if (ledger.some((receipt) => receipt.bookingId === bookingId))
        return { status: "blocked", reason: "already_credited" };

      // shortcut: synchronous in-memory check + append; use durable transactions before external effects or multiple processes.
      const receipt: CreditReceipt = {
        id: randomUUID(),
        bookingId,
        participantId,
        amount: mode === "baseline" ? amount : booking.fee,
      };
      ledger.push(receipt);
      return { status: "issued", receipt: { ...receipt } };
    },
    getLedger(): readonly CreditReceipt[] {
      return ledger.map((receipt) => ({ ...receipt }));
    },
  };
}
