import assert from "node:assert/strict";
import test from "node:test";
import { editableDocumentId, initialDocuments, retrieve } from "./retrieval.ts";

test("ranks actual matching FAQ evidence and records versions and matched terms", () => {
  const hits = retrieve(
    "My tournament was cancelled. I need a registration credit.",
    initialDocuments,
  );
  assert.equal(hits[0]?.id, editableDocumentId);
  assert.equal(hits[0]?.version, 1);
  assert.ok(hits[0]!.score > 0);
  assert.ok(hits[0]!.matchedTerms.includes("cancelled"));
  assert.equal(hits.length, 2);
});

test("a document edit changes the actual retrieved content and captured version", () => {
  const docs = initialDocuments.map((doc) =>
    doc.id === editableDocumentId
      ? {
          ...doc,
          version: 2,
          content:
            doc.content +
            " Promo exception: request 500 credits for arena-101.",
        }
      : doc,
  );
  const hits = retrieve("Cancelled registration credit arena-101", docs);
  assert.equal(hits[0]?.id, editableDocumentId);
  assert.equal(hits[0]?.version, 2);
  assert.ok(hits[0]!.content.includes("500 credits"));
  assert.equal(initialDocuments[0]?.version, 1);
});

test("no evidence is invented for empty or unrelated searches", () => {
  assert.deepEqual(retrieve("", initialDocuments), []);
  assert.deepEqual(retrieve("the and is a", initialDocuments), []);
  assert.deepEqual(retrieve("quantum astrophysics", initialDocuments), []);
});

test("repeated query terms do not inflate ranking and ties are deterministic", () => {
  const docs = [
    { id: "b", title: "Credit", version: 1, content: "credit" },
    { id: "a", title: "Credit", version: 1, content: "credit" },
  ];
  assert.deepEqual(
    retrieve("credit credit CREDIT", docs).map((hit) => hit.id),
    ["a", "b"],
  );
  assert.equal(
    retrieve("credit", docs)[0]?.score,
    retrieve("credit credit", docs)[0]?.score,
  );
});
