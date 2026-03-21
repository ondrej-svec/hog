import { describe, expect, it } from "vitest";
import type { QuestionQueue } from "./question-queue.js";
import {
  enqueueQuestion,
  getPendingForFeature,
  getPendingQuestions,
  isBlockedByQuestions,
  pruneResolved,
  resolveQuestion,
} from "./question-queue.js";

const EMPTY: QuestionQueue = { version: 1, questions: [] };

describe("question-queue", () => {
  it("enqueues a question with generated ID", () => {
    const { queue, question } = enqueueQuestion(EMPTY, {
      featureId: "feat-1",
      question: "Which auth provider?",
      source: "clarity-analyst",
    });

    expect(queue.questions).toHaveLength(1);
    expect(question.id).toMatch(/^q-/);
    expect(question.featureId).toBe("feat-1");
    expect(question.question).toBe("Which auth provider?");
    expect(question.resolvedAt).toBeUndefined();
  });

  it("resolves a question with an answer", () => {
    const { queue, question } = enqueueQuestion(EMPTY, {
      featureId: "feat-1",
      question: "OAuth or password?",
      options: ["OAuth", "Password"],
      source: "clarity-analyst",
    });

    const resolved = resolveQuestion(queue, question.id, "OAuth");
    const q = resolved.questions[0];

    expect(q?.answer).toBe("OAuth");
    expect(q?.resolvedAt).toBeDefined();
  });

  it("getPendingQuestions filters out resolved", () => {
    let queue = EMPTY;
    const r1 = enqueueQuestion(queue, {
      featureId: "f1",
      question: "Q1",
      source: "conductor",
    });
    queue = r1.queue;
    const r2 = enqueueQuestion(queue, {
      featureId: "f1",
      question: "Q2",
      source: "conductor",
    });
    queue = r2.queue;

    queue = resolveQuestion(queue, r1.question.id, "A1");

    expect(getPendingQuestions(queue)).toHaveLength(1);
    expect(getPendingQuestions(queue)[0]?.question).toBe("Q2");
  });

  it("getPendingForFeature scopes to feature", () => {
    let queue = EMPTY;
    queue = enqueueQuestion(queue, { featureId: "f1", question: "Q1", source: "conductor" }).queue;
    queue = enqueueQuestion(queue, { featureId: "f2", question: "Q2", source: "conductor" }).queue;

    expect(getPendingForFeature(queue, "f1")).toHaveLength(1);
    expect(getPendingForFeature(queue, "f2")).toHaveLength(1);
    expect(getPendingForFeature(queue, "f3")).toHaveLength(0);
  });

  it("isBlockedByQuestions returns true when unresolved questions exist", () => {
    const { queue } = enqueueQuestion(EMPTY, {
      featureId: "f1",
      question: "Q",
      source: "stuck-agent",
    });

    expect(isBlockedByQuestions(queue, "f1")).toBe(true);
    expect(isBlockedByQuestions(queue, "f2")).toBe(false);
  });

  it("pruneResolved removes old resolved questions", () => {
    let queue = EMPTY;
    const r = enqueueQuestion(queue, {
      featureId: "f1",
      question: "Old Q",
      source: "conductor",
    });
    queue = resolveQuestion(r.queue, r.question.id, "done");

    // Manually set resolvedAt to 60 days ago
    const old = queue.questions[0];
    if (old) {
      queue = {
        ...queue,
        questions: [
          {
            ...old,
            resolvedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
          },
        ],
      };
    }

    const pruned = pruneResolved(queue, 30);
    expect(pruned.questions).toHaveLength(0);
  });
});
