import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_DIR } from "../config.js";

// ── Types ──

const QUESTION_SCHEMA = z.object({
  id: z.string(),
  featureId: z.string(),
  question: z.string(),
  context: z.string().optional(),
  options: z.array(z.string()).optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  answer: z.string().optional(),
  source: z.enum(["clarity-analyst", "stuck-agent", "conductor"]),
});

const QUEUE_SCHEMA = z.object({
  version: z.literal(1),
  questions: z.array(QUESTION_SCHEMA).default([]),
});

export type Question = z.infer<typeof QUESTION_SCHEMA>;
export type QuestionQueue = z.infer<typeof QUEUE_SCHEMA>;

// ── Persistence ──

const QUEUE_FILE = join(CONFIG_DIR, "question-queue.json");
const EMPTY_QUEUE: QuestionQueue = { version: 1, questions: [] };

export function loadQuestionQueue(): QuestionQueue {
  if (!existsSync(QUEUE_FILE)) return { ...EMPTY_QUEUE, questions: [] };
  try {
    const raw: unknown = JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
    const result = QUEUE_SCHEMA.safeParse(raw);
    return result.success ? result.data : { ...EMPTY_QUEUE, questions: [] };
  } catch {
    return { ...EMPTY_QUEUE, questions: [] };
  }
}

export function saveQuestionQueue(queue: QuestionQueue): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${QUEUE_FILE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, QUEUE_FILE);
}

// ── Operations ──

function generateQuestionId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Add a question to the queue. Returns the question with ID. */
export function enqueueQuestion(
  queue: QuestionQueue,
  opts: {
    featureId: string;
    question: string;
    context?: string;
    options?: string[];
    source: Question["source"];
  },
): { queue: QuestionQueue; question: Question } {
  const question: Question = {
    id: generateQuestionId(),
    featureId: opts.featureId,
    question: opts.question,
    createdAt: new Date().toISOString(),
    source: opts.source,
    ...(opts.context ? { context: opts.context } : {}),
    ...(opts.options ? { options: opts.options } : {}),
  };

  return {
    queue: { ...queue, questions: [...queue.questions, question] },
    question,
  };
}

/** Resolve a question with an answer. */
export function resolveQuestion(
  queue: QuestionQueue,
  questionId: string,
  answer: string,
): QuestionQueue {
  return {
    ...queue,
    questions: queue.questions.map((q) =>
      q.id === questionId ? { ...q, resolvedAt: new Date().toISOString(), answer } : q,
    ),
  };
}

/** Get all pending (unresolved) questions. */
export function getPendingQuestions(queue: QuestionQueue): Question[] {
  return queue.questions.filter((q) => !q.resolvedAt);
}

/** Get pending questions for a specific feature. */
export function getPendingForFeature(queue: QuestionQueue, featureId: string): Question[] {
  return queue.questions.filter((q) => !q.resolvedAt && q.featureId === featureId);
}

/** Check if a feature has unresolved questions blocking it. */
export function isBlockedByQuestions(queue: QuestionQueue, featureId: string): boolean {
  return queue.questions.some((q) => !q.resolvedAt && q.featureId === featureId);
}

/** Remove unresolved questions for pipelines that no longer exist. */
export function pruneOrphaned(
  queue: QuestionQueue,
  activeFeatureIds: ReadonlySet<string>,
): QuestionQueue {
  return {
    ...queue,
    questions: queue.questions.filter((q) => {
      // Keep resolved questions (they're historical)
      if (q.resolvedAt) return true;
      // Keep questions for active pipelines
      return activeFeatureIds.has(q.featureId);
    }),
  };
}

/** Clean up resolved questions older than the given age in days. */
export function pruneResolved(queue: QuestionQueue, maxAgeDays: number = 30): QuestionQueue {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  return {
    ...queue,
    questions: queue.questions.filter((q) => {
      if (!q.resolvedAt) return true;
      return new Date(q.resolvedAt).getTime() > cutoff;
    }),
  };
}
