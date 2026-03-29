import { describe, expect, it } from "vitest";
import { buildEscalationOptions, GATE_CONFIGS, gatesForPhase } from "./retry-engine.js";

describe("retry-engine", () => {
  it("defines 5 gate configurations", () => {
    expect(GATE_CONFIGS).toHaveLength(5);
  });

  it("all gates have max 2 retries", () => {
    for (const gate of GATE_CONFIGS) {
      expect(gate.maxRetries).toBe(2);
    }
  });

  it("returns correct gates for impl phase", () => {
    const gates = gatesForPhase("impl");
    const ids = gates.map((g) => g.id);
    expect(ids).toContain("stub-gate");
    expect(ids).toContain("green-gate");
    expect(ids).not.toContain("coverage-gate");
  });

  it("returns correct gates for test phase", () => {
    const gates = gatesForPhase("test");
    expect(gates).toHaveLength(1);
    expect(gates[0]?.id).toBe("coverage-gate");
  });

  it("returns correct gates for redteam phase", () => {
    const gates = gatesForPhase("redteam");
    expect(gates).toHaveLength(1);
    expect(gates[0]?.id).toBe("redteam-gate");
  });

  it("returns correct gates for merge phase", () => {
    const gates = gatesForPhase("merge");
    expect(gates).toHaveLength(1);
    expect(gates[0]?.id).toBe("merge-gate");
  });

  it("returns no gates for brainstorm phase", () => {
    expect(gatesForPhase("brainstorm")).toHaveLength(0);
  });

  it("builds escalation options for each gate", () => {
    for (const gate of GATE_CONFIGS) {
      const options = buildEscalationOptions(gate.id);
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options).toContain("Cancel pipeline");
    }
  });

  it("redteam gate reopens merge bead too", () => {
    const redteam = GATE_CONFIGS.find((g) => g.id === "redteam-gate");
    expect(redteam?.alsoReopen).toContain("merge");
    expect(redteam?.decrementBeads).toBe(2);
  });

  it("merge gate reopens merge bead (itself) for re-run", () => {
    const merge = GATE_CONFIGS.find((g) => g.id === "merge-gate");
    expect(merge?.alsoReopen).toContain("merge");
    expect(merge?.decrementBeads).toBe(2);
  });
});
