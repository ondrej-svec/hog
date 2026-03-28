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
  brainstorm: "Zaphod (brainstorm)",
  stories: "Ford (stories)",
  test: "Arthur (tests)",
  impl: "Arthur (impl)",
  redteam: "Marvin (redteam)",
  merge: "Vogons (merge)",
};

const PHASE_MESSAGES: Record<string, string> = {
  brainstorm: "Zaphod has set the course. Two heads are better than one.",
  stories: "Ford has filed his research. The Guide entry is ready.",
  test: "Tests failing. The question is good. Proceeding.",
  impl: "Arthur has built it. Tests green.",
  redteam: "Marvin: Nothing found. I find this deeply suspicious.",
  merge: "The Vogons have approved the paperwork.",
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

  console.log("DON'T PANIC.\n");
  console.log("hog — Head of Gold — simulated pipeline run\n");
  console.log("Firing up the Infinite Improbability Drive...");

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

  console.log('Heart of Gold launched. Course: "Add greeting customization"\n');

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

    const message = PHASE_MESSAGES[phase] ?? `${label} completed`;
    process.stdout.write(`  ✓ ${message}                    \n`);
    eventBus.emit("agent:completed", {
      sessionId,
      repo: "demo/sample-project",
      issueNumber: 0,
      phase,
    });
  }

  console.log("\nPan Galactic Gargle Blaster served. Feature ready to merge.");
  console.log("\nIn a real run, each crew member is a separate Claude agent:");
  console.log("  Zaphod explores, Ford documents, Arthur builds, Marvin breaks, Vogons approve.");
  console.log("\nYou know where your towel is? Run: hog init");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
