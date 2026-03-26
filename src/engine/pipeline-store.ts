/**
 * PipelineStore — Zod-validated pipeline persistence.
 *
 * Extracted from Conductor to reduce God Object (Fowler recommendation).
 * Replaces 50+ lines of manual typeof checks with Zod safeParse (Cherny recommendation).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { HogConfig, RepoConfig } from "../config.js";
import { CONFIG_DIR } from "../config.js";
import type { Pipeline, PipelineStatus } from "./conductor.js";

// ── Zod Schema ──

const BEAD_IDS_SCHEMA = z.object({
  brainstorm: z.string(),
  stories: z.string(),
  tests: z.string(),
  impl: z.string(),
  redteam: z.string(),
  merge: z.string(),
});

const PIPELINE_SCHEMA = z.object({
  featureId: z.string(),
  title: z.string().default(""),
  repo: z.string(),
  localPath: z.string().default(""),
  beadIds: BEAD_IDS_SCHEMA,
  status: z.enum(["running", "paused", "blocked", "completed", "failed"]).default("running"),
  completedBeads: z.number().default(0),
  activePhase: z.string().optional(),
  startedAt: z.string().default(() => new Date().toISOString()),
  completedAt: z.string().optional(),
});

export type PipelineData = z.infer<typeof PIPELINE_SCHEMA>;

// ── Readonly snapshot type for TUI consumers (Cherny) ──

export interface PipelineSnapshot {
  readonly featureId: string;
  readonly title: string;
  readonly repo: string;
  readonly localPath: string;
  readonly repoConfig: RepoConfig;
  readonly beadIds: {
    readonly brainstorm: string;
    readonly stories: string;
    readonly tests: string;
    readonly impl: string;
    readonly redteam: string;
    readonly merge: string;
  };
  readonly status: PipelineStatus;
  readonly completedBeads: number;
  readonly activePhase?: string | undefined;
  readonly startedAt: string;
  readonly completedAt?: string;
}

// ── PipelineStore ──

const PIPELINES_FILE = `${CONFIG_DIR}/pipelines.json`;

const isTest = (): boolean =>
  process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true";

export class PipelineStore {
  private readonly config: HogConfig;
  private readonly pipelines: Map<string, Pipeline> = new Map();

  constructor(config: HogConfig) {
    this.config = config;
    this.load();
  }

  // ── Public API ──

  get(featureId: string): Pipeline | undefined {
    return this.pipelines.get(featureId);
  }

  set(featureId: string, pipeline: Pipeline): void {
    this.pipelines.set(featureId, pipeline);
  }

  delete(featureId: string): boolean {
    return this.pipelines.delete(featureId);
  }

  getAll(): Pipeline[] {
    return [...this.pipelines.values()];
  }

  has(featureId: string): boolean {
    return this.pipelines.has(featureId);
  }

  /** Get all pipelines as readonly snapshots for external consumers. */
  getSnapshots(): PipelineSnapshot[] {
    return [...this.pipelines.values()];
  }

  /** Count active (running/paused/blocked) pipelines. */
  activeCount(): number {
    return [...this.pipelines.values()].filter(
      (p) => p.status === "running" || p.status === "paused" || p.status === "blocked",
    ).length;
  }

  // ── Persistence ──

  save(): void {
    if (isTest()) return;
    try {
      const data = [...this.pipelines.values()].map((p) => ({
        featureId: p.featureId,
        title: p.title,
        repo: p.repo,
        localPath: p.localPath,
        beadIds: p.beadIds,
        status: p.status,
        completedBeads: p.completedBeads,
        activePhase: p.activePhase,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
      }));
      mkdirSync(CONFIG_DIR, { recursive: true });
      const tmp = `${PIPELINES_FILE}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, PIPELINES_FILE);
    } catch {
      // best-effort
    }
  }

  load(): void {
    if (isTest()) return;
    if (!existsSync(PIPELINES_FILE)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(PIPELINES_FILE, "utf-8"));
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        const result = PIPELINE_SCHEMA.safeParse(entry);
        if (!result.success) continue;

        const data = result.data;

        // Skip completed/failed
        if (data.status === "completed" || data.status === "failed") continue;

        // Auto-expire stale pipelines (>7 days old with no progress)
        const ageDays = (Date.now() - new Date(data.startedAt).getTime()) / 86_400_000;
        if (ageDays > 7 && data.completedBeads === 0) continue;

        // Re-resolve repoConfig from current config
        const repoConfig =
          this.config.repos.find((r) => r.name === data.repo) ??
          ({
            name: data.repo,
            shortName: data.repo,
            projectNumber: 0,
            statusFieldId: "",
            localPath: data.localPath,
            completionAction: { type: "closeIssue" },
          } as RepoConfig);

        const pipeline: Pipeline = {
          featureId: data.featureId,
          title: data.title,
          repo: data.repo,
          localPath: data.localPath || repoConfig.localPath || "",
          repoConfig,
          beadIds: data.beadIds,
          status: data.status,
          completedBeads: data.completedBeads,
          ...(data.activePhase !== undefined ? { activePhase: data.activePhase } : {}),
          startedAt: data.startedAt,
          ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
        };
        this.pipelines.set(pipeline.featureId, pipeline);
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  /** Sync from disk — pick up pipelines created by other processes. */
  syncFromDisk(): void {
    if (isTest()) return;
    if (!existsSync(PIPELINES_FILE)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(PIPELINES_FILE, "utf-8"));
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        const result = PIPELINE_SCHEMA.safeParse(entry);
        if (!result.success) continue;
        const data = result.data;

        // Only add pipelines we don't already have
        if (this.pipelines.has(data.featureId)) continue;
        if (data.status === "completed" || data.status === "failed") continue;

        const repoConfig =
          this.config.repos.find((r) => r.name === data.repo) ??
          ({
            name: data.repo,
            shortName: data.repo,
            projectNumber: 0,
            statusFieldId: "",
            localPath: data.localPath,
            completionAction: { type: "closeIssue" },
          } as RepoConfig);

        this.pipelines.set(data.featureId, {
          featureId: data.featureId,
          title: data.title,
          repo: data.repo,
          localPath: data.localPath || repoConfig.localPath || "",
          repoConfig,
          beadIds: data.beadIds,
          status: data.status,
          completedBeads: data.completedBeads,
          ...(data.activePhase !== undefined ? { activePhase: data.activePhase } : {}),
          startedAt: data.startedAt,
          ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
        });
      }
    } catch {
      // best-effort
    }
  }
}
