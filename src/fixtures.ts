import type { Booking } from "./credit.ts";

export const demoParticipantId = "player-yousef";

export const demoBookings: readonly Booking[] = [
  { id: "arena-101", participantId: "player-yousef", cancelled: true, fee: 50 },
  {
    id: "arena-102",
    participantId: "player-yousef",
    cancelled: false,
    fee: 25,
  },
  { id: "arena-201", participantId: "player-nour", cancelled: true, fee: 80 },
];
