import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { StartPipelineOverlay } from "./start-pipeline-overlay.js";

function renderOverlay(props: Partial<Parameters<typeof StartPipelineOverlay>[0]> = {}) {
  return render(
    React.createElement(StartPipelineOverlay, {
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      beadsAvailable: true,
      ...props,
    }),
  );
}

describe("StartPipelineOverlay", () => {
  // STORY-018: As a user pressing P, I see a clear prompt
  // to describe what I want to build
  describe("STORY-018: Pipeline creation prompt", () => {
    it("shows 'What do you want to build?' prompt", () => {
      const { lastFrame } = renderOverlay();
      const frame = lastFrame() ?? "";
      expect(frame).toContain("What do you want to build?");
    });

    it("shows all 8 pipeline phases", () => {
      const { lastFrame } = renderOverlay();
      const frame = lastFrame() ?? "";
      expect(frame).toContain("brainstorm");
      expect(frame).toContain("stories");
      expect(frame).toContain("tests");
      expect(frame).toContain("impl");
      expect(frame).toContain("red team");
      expect(frame).toContain("merge");
      expect(frame).toContain("ship");
    });

    it("shows text input placeholder", () => {
      const { lastFrame } = renderOverlay();
      const frame = lastFrame() ?? "";
      expect(frame).toContain("→");
    });
  });

  // STORY-019: As a user without Beads installed,
  // I see a clear error instead of a cryptic failure
  describe("STORY-019: Beads not installed feedback", () => {
    it("shows installation guidance when beads is not available", () => {
      const { lastFrame } = renderOverlay({ beadsAvailable: false });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("not installed");
      expect(frame).toContain("beads");
    });

    it("does NOT show the text input when beads is not available", () => {
      const { lastFrame } = renderOverlay({ beadsAvailable: false });
      const frame = lastFrame() ?? "";
      expect(frame).not.toContain("What do you want to build?");
    });
  });
});
