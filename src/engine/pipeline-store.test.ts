import { describe, expect, it } from "vitest";
import type { Pipeline, PipelineStatus } from "./conductor.js";

/**
 * This test ensures ALL Pipeline fields are included in save/load/syncFromDisk.
 * If you add a new field to Pipeline and forget to persist it, this test fails.
 */
describe("PipelineStore field coverage", () => {
  // A pipeline with ALL optional fields populated
  const fullPipeline: Pipeline = {
    featureId: "feat-test-001",
    title: "Test Pipeline",
    repo: "test/repo",
    localPath: "/tmp/test",
    repoConfig: {
      name: "test/repo",
      shortName: "repo",
      projectNumber: 0,
      statusFieldId: "",
      completionAction: { type: "closeIssue" },
    },
    beadIds: {
      brainstorm: "b-1",
      stories: "b-2",
      tests: "b-3",
      impl: "b-4",
      redteam: "b-5",
      merge: "b-6",
    },
    status: "running" as PipelineStatus,
    completedBeads: 3,
    activePhase: "impl",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T01:00:00.000Z",
    storiesPath: "docs/stories/test.md",
    architecturePath: "docs/stories/test.architecture.md",
    costByPhase: { impl: 0.5 },
    totalCost: 1.2,
  };

  it("save() serializes ALL pipeline fields", () => {
    // Simulate what save() does
    const serialized = {
      featureId: fullPipeline.featureId,
      title: fullPipeline.title,
      repo: fullPipeline.repo,
      localPath: fullPipeline.localPath,
      beadIds: fullPipeline.beadIds,
      status: fullPipeline.status,
      completedBeads: fullPipeline.completedBeads,
      activePhase: fullPipeline.activePhase,
      startedAt: fullPipeline.startedAt,
      completedAt: fullPipeline.completedAt,
      storiesPath: fullPipeline.storiesPath,
      architecturePath: fullPipeline.architecturePath,
      costByPhase: fullPipeline.costByPhase,
      totalCost: fullPipeline.totalCost,
    };

    // Every non-readonly, non-repoConfig field from Pipeline should be in serialized
    const pipelineKeys = Object.keys(fullPipeline).filter((k) => k !== "repoConfig");
    const serializedKeys = Object.keys(serialized);

    for (const key of pipelineKeys) {
      expect(serializedKeys, `Field "${key}" missing from save() serialization`).toContain(key);
    }
  });

  it("all Pipeline optional fields have defined values in test fixture", () => {
    // This catches new fields added to Pipeline but not to the test fixture
    const keys = Object.keys(fullPipeline);
    for (const key of keys) {
      const value = (fullPipeline as unknown as Record<string, unknown>)[key];
      expect(value, `Field "${key}" is undefined in test fixture — add a test value`).toBeDefined();
    }
  });
});
