import { describe, expect, it } from "vitest";
import { buildClaudeSettings, DENY_RULES } from "./safety-rules.js";

describe("Safety Rules", () => {
  describe("DENY_RULES", () => {
    it("blocks rm -rf with dangerous targets", () => {
      expect(DENY_RULES).toContain("Bash(rm -rf /*)");
      expect(DENY_RULES).toContain("Bash(rm -rf ~*)");
    });

    it("blocks force push", () => {
      expect(DENY_RULES).toContain("Bash(git push --force*)");
      expect(DENY_RULES).toContain("Bash(git push -f*)");
    });

    it("blocks sudo", () => {
      expect(DENY_RULES).toContain("Bash(sudo *)");
    });

    it("blocks pipe-to-shell", () => {
      expect(DENY_RULES).toContain("Bash(curl * | sh*)");
      expect(DENY_RULES).toContain("Bash(curl * | bash*)");
    });

    it("blocks credential exposure", () => {
      expect(DENY_RULES).toContain("Bash(cat */.ssh/*)");
      expect(DENY_RULES).toContain("Bash(cat */.aws/*)");
    });

    it("has at least 20 rules", () => {
      expect(DENY_RULES.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe("buildClaudeSettings", () => {
    it("creates settings with deny rules from scratch", () => {
      const settings = buildClaudeSettings();
      expect(settings.permissions?.deny).toBeDefined();
      expect(settings.permissions?.deny?.length).toBeGreaterThan(0);
      expect(settings.permissions?.deny).toContain("Bash(sudo *)");
    });

    it("merges with existing deny rules without duplicates", () => {
      const existing = {
        permissions: {
          deny: ["Bash(sudo *)", "Bash(custom-dangerous-cmd)"],
        },
      };
      const settings = buildClaudeSettings(existing);
      // Should have our rules + custom rule, no duplicate sudo
      const sudoCount = settings.permissions?.deny?.filter((r) => r === "Bash(sudo *)").length;
      expect(sudoCount).toBe(1);
      expect(settings.permissions?.deny).toContain("Bash(custom-dangerous-cmd)");
    });

    it("preserves existing allow rules", () => {
      const existing = {
        permissions: {
          allow: ["Bash(npm test)"],
          deny: [],
        },
      };
      const settings = buildClaudeSettings(existing);
      expect(settings.permissions?.allow).toContain("Bash(npm test)");
    });

    it("preserves other settings fields", () => {
      const existing = {
        someOtherField: true,
        permissions: { deny: [] },
      } as any;
      const settings = buildClaudeSettings(existing);
      expect((settings as any).someOtherField).toBe(true);
    });
  });
});
