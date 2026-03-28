import { describe, expect, it } from "vitest";
import { checkSummaryForFailure } from "./summary-parser.js";

describe("Summary Sentiment Parser", () => {
  describe("detects failure signals", () => {
    it("catches CANNOT PROCEED", () => {
      const result = checkSummaryForFailure(
        "I CANNOT PROCEED without the API key configured.",
        "merge",
      );
      expect(result.failed).toBe(true);
      expect(result.matchedPattern).toBe("CANNOT PROCEED");
    });

    it("catches 'requires clarification'", () => {
      const result = checkSummaryForFailure(
        "The spec requires clarification on the auth flow.",
        "impl",
      );
      expect(result.failed).toBe(true);
    });

    it("catches 'manual intervention'", () => {
      const result = checkSummaryForFailure(
        "This needs manual intervention to configure the database.",
        "impl",
      );
      expect(result.failed).toBe(true);
    });

    it("catches 'unable to complete'", () => {
      const result = checkSummaryForFailure(
        "I was unable to complete the implementation due to missing dependencies.",
        "impl",
      );
      expect(result.failed).toBe(true);
    });

    it("catches FAILED in impl context", () => {
      const result = checkSummaryForFailure("The build FAILED with 3 errors.", "impl");
      expect(result.failed).toBe(true);
    });

    it("catches 'blocked' in impl context", () => {
      const result = checkSummaryForFailure(
        "Implementation is blocked by missing API credentials.",
        "impl",
      );
      expect(result.failed).toBe(true);
    });
  });

  describe("phase-aware exclusions", () => {
    it("does NOT flag FAILED in redteam context (tests are supposed to fail)", () => {
      const result = checkSummaryForFailure(
        "3 tests FAILED against the implementation — security vulnerabilities found.",
        "redteam",
      );
      expect(result.failed).toBe(false);
    });

    it("does NOT flag FAILED in test context (RED state means tests fail)", () => {
      const result = checkSummaryForFailure(
        "Wrote 12 tests — all FAILED as expected (RED state confirmed).",
        "test",
      );
      expect(result.failed).toBe(false);
    });

    it("does NOT flag 'blocked' in redteam context", () => {
      const result = checkSummaryForFailure(
        "The implementation blocked XSS attempts correctly.",
        "redteam",
      );
      expect(result.failed).toBe(false);
    });

    it("still catches CANNOT PROCEED in redteam context", () => {
      const result = checkSummaryForFailure(
        "I CANNOT PROCEED — the codebase has no test framework.",
        "redteam",
      );
      expect(result.failed).toBe(true);
    });
  });

  describe("false positive avoidance", () => {
    it("does not flag normal completion summaries", () => {
      const result = checkSummaryForFailure(
        "Implementation complete. All 12 tests pass. Created 5 files.",
        "impl",
      );
      expect(result.failed).toBe(false);
    });

    it("does not flag 'the FAILED test now passes' (past tense context)", () => {
      // This is borderline — the word FAILED is present. But in impl context
      // it should flag. The parser is conservative — better to ask than miss.
      const result = checkSummaryForFailure(
        "Fixed the issue. The previously FAILED test now passes.",
        "impl",
      );
      // This WILL match because FAILED is present in impl context.
      // That's the correct behavior — better to ask than assume success.
      expect(result.failed).toBe(true);
    });

    it("handles undefined summary", () => {
      const result = checkSummaryForFailure(undefined, "impl");
      expect(result.failed).toBe(false);
    });

    it("handles empty string summary", () => {
      const result = checkSummaryForFailure("", "impl");
      expect(result.failed).toBe(false);
    });
  });

  describe("case insensitivity", () => {
    it("catches lowercase 'cannot proceed'", () => {
      const result = checkSummaryForFailure("I cannot proceed without setup.", "merge");
      expect(result.failed).toBe(true);
    });

    it("catches mixed case 'Unable To Complete'", () => {
      const result = checkSummaryForFailure("Unable To Complete the task.", "impl");
      expect(result.failed).toBe(true);
    });
  });
});
