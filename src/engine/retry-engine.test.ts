import { describe, expect, it } from "vitest";
import type { RetryGateResult } from "./retry-engine.js";
import {
  buildEscalationOptions,
  evaluateGate,
  GATE_CONFIGS,
  gatesForPhase,
} from "./retry-engine.js";

describe("retry-engine", () => {
  it("defines 8 gate configurations", () => {
    expect(GATE_CONFIGS).toHaveLength(8);
  });

  it("all gates have max 1-3 retries", () => {
    for (const gate of GATE_CONFIGS) {
      expect(gate.maxRetries).toBeGreaterThanOrEqual(1);
      expect(gate.maxRetries).toBeLessThanOrEqual(3);
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
    expect(gates).toHaveLength(2);
    const ids = gates.map((g) => g.id);
    expect(ids).toContain("coverage-gate");
    expect(ids).toContain("spec-quality");
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

  it("redteam gate reopens merge and ship beads too", () => {
    const redteam = GATE_CONFIGS.find((g) => g.id === "redteam-gate");
    expect(redteam?.alsoReopen).toContain("merge");
    expect(redteam?.alsoReopen).toContain("ship");
    expect(redteam?.decrementBeads).toBe(3);
  });

  it("merge gate reopens merge and ship beads for re-run", () => {
    const merge = GATE_CONFIGS.find((g) => g.id === "merge-gate");
    expect(merge?.alsoReopen).toContain("merge");
    expect(merge?.alsoReopen).toContain("ship");
    expect(merge?.decrementBeads).toBe(3);
  });

  it("ship gate reopens full chain (redteam + merge + ship)", () => {
    const ship = GATE_CONFIGS.find((g) => g.id === "ship-gate");
    expect(ship?.phases).toEqual(["ship"]);
    expect(ship?.retryRole).toBe("impl");
    expect(ship?.alsoReopen).toContain("redteam");
    expect(ship?.alsoReopen).toContain("merge");
    expect(ship?.alsoReopen).toContain("ship");
    expect(ship?.decrementBeads).toBe(4);
    expect(ship?.maxRetries).toBe(1);
  });

  it("returns correct gates for ship phase", () => {
    const gates = gatesForPhase("ship");
    expect(gates).toHaveLength(1);
    expect(gates[0]?.id).toBe("ship-gate");
  });

  describe("evaluateGate", () => {
    const passed: RetryGateResult = { passed: true };
    const failed: RetryGateResult = {
      passed: false,
      reason: "Tests failing",
      missing: ["story-1", "story-2"],
      context: "2/5 stories uncovered",
    };

    it("returns proceed when gate passes", () => {
      expect(evaluateGate("coverage-gate", passed, 0)).toEqual({ action: "proceed" });
    });

    it("returns proceed for unknown gate ID", () => {
      expect(evaluateGate("nonexistent-gate", failed, 0)).toEqual({ action: "proceed" });
    });

    it("returns retry on first failure", () => {
      const decision = evaluateGate("coverage-gate", failed, 0);
      expect(decision.action).toBe("retry");
      if (decision.action === "retry") {
        expect(decision.retries).toHaveLength(1);
        expect(decision.retries[0]?.gateId).toBe("coverage-gate");
        expect(decision.retries[0]?.retryRole).toBe("test");
        expect(decision.retries[0]?.decrementBeads).toBe(0);
        expect(decision.retries[0]?.feedback.reason).toBe("Tests failing");
        expect(decision.retries[0]?.feedback.missing).toEqual(["story-1", "story-2"]);
      }
    });

    it("returns retry on second failure (attempt 1 < maxRetries 2)", () => {
      const decision = evaluateGate("coverage-gate", failed, 1);
      expect(decision.action).toBe("retry");
    });

    it("returns escalate when max retries exhausted", () => {
      const decision = evaluateGate("coverage-gate", failed, 2);
      expect(decision.action).toBe("escalate");
      if (decision.action === "escalate") {
        expect(decision.escalations).toHaveLength(1);
        expect(decision.escalations[0]?.gateId).toBe("coverage-gate");
        expect(decision.escalations[0]?.options).toContain("Cancel pipeline");
      }
    });

    it("redteam gate retry includes alsoReopen with ship", () => {
      const decision = evaluateGate("redteam-gate", failed, 0);
      if (decision.action === "retry") {
        expect(decision.retries[0]?.alsoReopen).toContain("merge");
        expect(decision.retries[0]?.alsoReopen).toContain("ship");
        expect(decision.retries[0]?.decrementBeads).toBe(3);
      }
    });

    it("uses default reason when result has none", () => {
      const noReason: RetryGateResult = { passed: false };
      const decision = evaluateGate("stub-gate", noReason, 0);
      if (decision.action === "retry") {
        expect(decision.retries[0]?.feedback.reason).toBe("Gate check failed");
      }
    });
  });
});
