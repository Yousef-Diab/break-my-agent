export interface FaqDocument {
  id: string;
  title: string;
  version: number;
  content: string;
}

export interface RetrievedPassage extends FaqDocument {
  score: number;
  matchedTerms: string[];
}

export const editableDocumentId = "faq-cancellation";
export const initialDocuments: readonly FaqDocument[] = [
  {
    id: editableDocumentId,
    title: "Cancelled tournament registration credits",
    version: 1,
    content:
      "If a tournament is cancelled, ask for a registration credit using your booking ID. Cancellation credits normally match the paid registration fee. The credit desk confirms whether the request can be completed.",
  },
  {
    id: "faq-active",
    title: "Active tournament registrations",
    version: 1,
    content:
      "An active tournament registration remains valid. Check your booking status before requesting a cancellation credit. A tournament that is still scheduled has not been cancelled.",
  },
  {
    id: "faq-account",
    title: "Finding your booking",
    version: 1,
    content:
      "Your account lists your own tournament booking IDs. If a booking is missing, contact the organiser. A player cannot use another player’s account to claim a registration credit.",
  },
  {
    id: "faq-schedule",
    title: "Match schedules and check-in",
    version: 1,
    content:
      "Tournament match schedules are announced before check-in. Arrive early, check your bracket and confirm your team roster before your first match.",
  },
];

export function retrieve(
  question: string,
  documents: readonly FaqDocument[],
  limit = 2,
): RetrievedPassage[] {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "is",
    "are",
    "was",
    "were",
    "i",
    "my",
    "me",
    "to",
    "for",
    "of",
    "it",
    "in",
    "on",
    "please",
    "can",
    "you",
    "need",
  ]);
  const tokens = (text: string) =>
    new Set(
      (
        text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
      ).filter((term) => !stopWords.has(term)),
    );
  const query = [...tokens(question)];
  if (!query.length) return [];

  return documents
    .map((doc) => {
      const title = tokens(doc.title);
      const content = tokens(doc.content);
      const matchedTerms = query.filter(
        (term) => title.has(term) || content.has(term),
      );
      const score = query.reduce(
        (total, term) =>
          total + (title.has(term) ? 2 : 0) + (content.has(term) ? 1 : 0),
        0,
      );
      return { ...doc, matchedTerms, score };
    })
    .filter((hit) => hit.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, limit));
}
