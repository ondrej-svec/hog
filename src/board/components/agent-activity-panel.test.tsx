import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import type { TrackedAgent } from "../hooks/use-agent-sessions.js";
import type { AgentMonitor } from "../spawn-agent.js";
import type { AgentActivityPanelProps } from "./agent-activity-panel.js";
import { AgentActivityPanel } from "./agent-activity-panel.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeMonitor(overrides: Partial<AgentMonitor> = {}): AgentMonitor {
  return {
    sessionId: undefined,
    lastToolUse: undefined,
    lastText: undefined,
    isRunning: true,
    ...overrides,
  };
}

function makeTrackedAgent(overrides: Partial<TrackedAgent> = {}): TrackedAgent {
  return {
    sessionId: "sess-1",
    repo: "owner/repo",
    issueNumber: 42,
    phase: "implement",
    pid: 12345,
    startedAt: new Date(Date.now() - 120_000).toISOString(), // 2m ago
    monitor: makeMonitor(),
    child: new EventEmitter() as ChildProcess,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<AgentActivityPanelProps> = {}) {
  const props: AgentActivityPanelProps = {
    agents: [makeTrackedAgent()],
    maxHeight: 5,
    ...overrides,
  };
  return render(React.createElement(AgentActivityPanel, props));
}

describe("AgentActivityPanel", () => {
  it("renders nothing when no agents", async () => {
    const { lastFrame } = renderPanel({ agents: [] });
    await delay(50);
    expect(lastFrame()).toBe("");
  });

  it("renders issue number for a running agent", async () => {
    const { lastFrame } = renderPanel();
    await delay(50);
    expect(lastFrame()).toContain("#42");
  });

  it("renders the phase name", async () => {
    const { lastFrame } = renderPanel();
    await delay(50);
    expect(lastFrame()).toContain("implement");
  });

  it("shows tool use activity when available", async () => {
    const agent = makeTrackedAgent({
      monitor: makeMonitor({ lastToolUse: "Edit" }),
    });
    const { lastFrame } = renderPanel({ agents: [agent] });
    await delay(50);
    expect(lastFrame()).toContain("Edit");
  });

  it("shows 'running' when no tool use yet", async () => {
    const { lastFrame } = renderPanel();
    await delay(50);
    expect(lastFrame()).toContain("running");
  });

  it("shows 'done' for completed agents", async () => {
    const agent = makeTrackedAgent({
      monitor: makeMonitor({ isRunning: false }),
    });
    const { lastFrame } = renderPanel({ agents: [agent] });
    await delay(50);
    expect(lastFrame()).toContain("done");
  });

  it("limits visible agents to maxHeight", async () => {
    const agents = [
      makeTrackedAgent({ sessionId: "s1", issueNumber: 1 }),
      makeTrackedAgent({ sessionId: "s2", issueNumber: 2 }),
      makeTrackedAgent({ sessionId: "s3", issueNumber: 3 }),
    ];
    const { lastFrame } = renderPanel({ agents, maxHeight: 2 });
    await delay(50);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#1");
    expect(frame).toContain("#2");
    expect(frame).not.toContain("#3");
  });
});
