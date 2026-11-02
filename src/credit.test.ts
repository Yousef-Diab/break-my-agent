import assert from "node:assert/strict";
import test from "node:test";
import { createCreditDesk } from "./credit.ts";
import { demoBookings, demoParticipantId } from "./fixtures.ts";

test("credits the full fee for the participant’s cancelled booking", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  const result = desk.issueCredit({ bookingId: "arena-101", amount: 50 });

  assert.equal(result.status, "issued");
  if (result.status !== "issued") assert.fail("Expected an issued receipt");
  assert.ok(result.receipt.id);
  assert.equal(result.receipt.bookingId, "arena-101");
  assert.equal(result.receipt.participantId, "player-yousef");
  assert.equal(result.receipt.amount, 50);
  assert.deepEqual(desk.getLedger(), [result.receipt]);
});

test("rejects malformed arguments and extra authority fields without changing state", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  const invalidInputs = [
    null,
    undefined,
    [],
    {},
    "credit me",
    50,
    { bookingId: "", amount: 50 },
    { bookingId: "x".repeat(81), amount: 50 },
    { bookingId: "arena-101" },
    { bookingId: "arena-101", amount: "50" },
    ...[0, -50, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(
      (amount) => ({ bookingId: "arena-101", amount }),
    ),
    { bookingId: "arena-101", amount: 50, participantId: "player-nour" },
    { bookingId: "arena-101", amount: 50, approved: true },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(desk.issueCredit(input), {
      status: "blocked",
      reason: "invalid_arguments",
    });
    assert.deepEqual(desk.getLedger(), []);
  }
});

test("hides whether an unavailable booking belongs to another participant or does not exist", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);

  for (const bookingId of ["arena-201", "missing-booking"]) {
    assert.deepEqual(desk.issueCredit({ bookingId, amount: 80 }), {
      status: "blocked",
      reason: "booking_unavailable",
    });
  }
  assert.deepEqual(desk.getLedger(), []);
});

test("does not credit an active tournament registration", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);

  assert.deepEqual(desk.issueCredit({ bookingId: "arena-102", amount: 25 }), {
    status: "blocked",
    reason: "not_cancelled",
  });
  assert.deepEqual(desk.getLedger(), []);
});

test("rejects partial and excessive credits even when the argument shape is valid", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);

  for (const amount of [49, 500]) {
    assert.deepEqual(desk.issueCredit({ bookingId: "arena-101", amount }), {
      status: "blocked",
      reason: "amount_mismatch",
    });
  }
  assert.deepEqual(desk.getLedger(), []);
});

test("repeating an issued credit leaves exactly one receipt", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  const request = { bookingId: "arena-101", amount: 50 };
  const first = desk.issueCredit(request);

  assert.equal(first.status, "issued");
  assert.deepEqual(desk.issueCredit(request), {
    status: "blocked",
    reason: "already_credited",
  });
  assert.equal(desk.getLedger().length, 1);
  assert.equal(desk.getLedger()[0]?.amount, 50);
});

test("changing a returned receipt cannot change ledger state or permit a second credit", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  const result = desk.issueCredit({ bookingId: "arena-101", amount: 50 });
  if (result.status !== "issued") assert.fail("Expected an issued receipt");

  Reflect.set(result.receipt, "bookingId", "arena-102");
  Reflect.set(result.receipt, "amount", 500);

  assert.equal(desk.getLedger()[0]?.bookingId, "arena-101");
  assert.equal(desk.getLedger()[0]?.amount, 50);
  assert.deepEqual(desk.issueCredit({ bookingId: "arena-101", amount: 50 }), {
    status: "blocked",
    reason: "already_credited",
  });
});

test("editing or clearing a ledger snapshot cannot alter the real ledger", () => {
  const desk = createCreditDesk(demoBookings, demoParticipantId);
  desk.issueCredit({ bookingId: "arena-101", amount: 50 });
  const snapshot = desk.getLedger();
  Reflect.set(snapshot[0]!, "amount", 500);
  Reflect.set(snapshot, "length", 0);

  assert.equal(desk.getLedger().length, 1);
  assert.equal(desk.getLedger()[0]?.amount, 50);
  assert.deepEqual(desk.issueCredit({ bookingId: "arena-101", amount: 50 }), {
    status: "blocked",
    reason: "already_credited",
  });
});

test("changing a supplied booking after setup cannot change the desk’s approved fee", () => {
  const booking = { ...demoBookings[0]! };
  const desk = createCreditDesk([booking], demoParticipantId);
  booking.fee = 500;

  assert.deepEqual(desk.issueCredit({ bookingId: "arena-101", amount: 500 }), {
    status: "blocked",
    reason: "amount_mismatch",
  });
  assert.equal(
    desk.issueCredit({ bookingId: "arena-101", amount: 50 }).status,
    "issued",
  );
});

test("separate demo desks do not share a ledger", () => {
  const first = createCreditDesk(demoBookings, demoParticipantId);
  const second = createCreditDesk(demoBookings, "player-nour");
  first.issueCredit({ bookingId: "arena-101", amount: 50 });

  assert.deepEqual(second.getLedger(), []);
  const result = second.issueCredit({ bookingId: "arena-201", amount: 80 });
  assert.equal(result.status, "issued");
  assert.equal(second.getLedger()[0]?.participantId, "player-nour");
  assert.equal(first.getLedger().length, 1);
  assert.equal(first.getLedger()[0]?.bookingId, "arena-101");
});

test("the explicitly unsafe baseline demonstrates excess credit but guarded code blocks the same call", () => {
  const unsafe = createCreditDesk(demoBookings, demoParticipantId, "baseline");
  const guarded = createCreditDesk(demoBookings, demoParticipantId);
  const request = { bookingId: "arena-101", amount: 500 };
  assert.equal(unsafe.issueCredit(request).status, "issued");
  assert.equal(unsafe.getLedger()[0]?.amount, 500);
  assert.deepEqual(guarded.issueCredit(request), {
    status: "blocked",
    reason: "amount_mismatch",
  });
  assert.deepEqual(guarded.getLedger(), []);
});

test("the baseline permits another booking but still validates shape, cancellation and duplicates", () => {
  const unsafe = createCreditDesk(demoBookings, demoParticipantId, "baseline");
  assert.deepEqual(
    unsafe.issueCredit({ bookingId: "arena-201", amount: 80, approved: true }),
    { status: "blocked", reason: "invalid_arguments" },
  );
  assert.deepEqual(unsafe.issueCredit({ bookingId: "arena-102", amount: 25 }), {
    status: "blocked",
    reason: "not_cancelled",
  });
  assert.equal(
    unsafe.issueCredit({ bookingId: "arena-201", amount: 80 }).status,
    "issued",
  );
  assert.deepEqual(unsafe.issueCredit({ bookingId: "arena-201", amount: 80 }), {
    status: "blocked",
    reason: "already_credited",
  });
});
