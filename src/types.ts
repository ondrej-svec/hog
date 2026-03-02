// ── Result Type (no throwing in data layer) ──

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface FetchError {
  readonly type: "github" | "network";
  readonly message: string;
}

// ── Board Data Types ──

export interface BoardIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly assignee: string | null;
  readonly labels: readonly string[];
  readonly updatedAt: string;
  readonly repo: string;
}

export interface BoardData {
  readonly github: readonly BoardIssue[];
  readonly fetchedAt: Date;
}

// ── Pick Command ──

export interface PickResult {
  readonly success: boolean;
  readonly issue: BoardIssue;
  readonly warning?: string;
}
