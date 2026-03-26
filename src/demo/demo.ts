/**
 * hog demo — runs a simulated pipeline with zero external dependencies.
 *
 * Uses the in-memory Beads driver and mock agents to demonstrate the
 * full pipeline lifecycle in under 2 minutes.
 */

import { MemoryBeadsClient } from "../engine/beads-memory.js";
import { EventBus } from "../engine/event-bus.js";

const PHASE_ORDER = ["brainstorm", "stories", "test", "impl", "redteam", "merge"] as const;

const PHASE_LABELS: Record<string, string> = {
  brainstorm: "Brainstorm",
  stories: "Stories",
  test: "Tests",
  impl: "Implementation",
  redteam: "Red Team",
  merge: "Merge",
};

const MOCK_TOOLS: Record<string, string[]> = {
  brainstorm: ["Read", "Grep", "Write"],
  stories: ["Read", "Write", "Glob"],
  test: ["Read", "Write", "Bash"],
  impl: ["Read", "Edit", "Write", "Bash"],
  redteam: ["Read", "Grep", "Write", "Bash"],
  merge: ["Bash", "Read"],
};

/** Run a demo pipeline with simulated agents. */
export async function runDemo(speedMultiplier = 2): Promise<void> {
  const beads = new MemoryBeadsClient();
  const eventBus = new EventBus();

  console.log("hog demo — simulated pipeline run\n");
  console.log("Creating feature DAG...");

  const dag = await beads.createFeatureDAG(
    "/tmp/hog-demo",
    "Add greeting customization",
    "Allow users to customize the greeting message with templates",
  );

  const beadIds = {
    brainstorm: dag.brainstorm.id,
    stories: dag.stories.id,
    tests: dag.tests.id,
    impl: dag.impl.id,
    redteam: dag.redteam.id,
    merge: dag.merge.id,
  };

  console.log("Pipeline created. Starting phases...\n");

  // Simulate each phase
  for (const phase of PHASE_ORDER) {
    const beadKey = phase === "test" ? "tests" : phase;
    const beadId = beadIds[beadKey as keyof typeof beadIds];
    const label = PHASE_LABELS[phase] ?? phase;
    const tools = MOCK_TOOLS[phase] ?? ["Read"];

    // Wait for bead to be ready
    const ready = await beads.ready("");
    const readyIds = new Set(ready.map((b) => b.id));
    if (!readyIds.has(beadId)) {
      console.log(`  Waiting for ${label} dependencies...`);
      await sleep(500 / speedMultiplier);
    }

    // Claim
    await beads.claim("", beadId);
    const sessionId = `demo-${phase}-${Date.now()}`;

    console.log(`  ◐ ${label} started`);
    eventBus.emit("agent:spawned", {
      sessionId,
      repo: "demo/sample-project",
      issueNumber: 0,
      phase,
    });

    // Simulate tool use
    for (const tool of tools) {
      await sleep((800 + Math.random() * 400) / speedMultiplier);
      process.stdout.write(`    using ${tool}...\r`);
      eventBus.emit("agent:progress", { sessionId, toolName: tool });
    }

    // Complete
    await sleep(300 / speedMultiplier);
    await beads.close("", beadId, `${phase} completed`);

    process.stdout.write(`  ✓ ${label} completed                    \n`);
    eventBus.emit("agent:completed", {
      sessionId,
      repo: "demo/sample-project",
      issueNumber: 0,
      phase,
    });
  }

  console.log("\nPipeline complete! All 6 phases finished.");
  console.log("In a real run, each phase spawns a Claude agent with role-specific prompts.");
  console.log('\nGet started: hog init && hog pipeline create "My feature"');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
