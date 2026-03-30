/**
 * Cockpit — the pipeline-focused TUI.
 *
 * This replaces dashboard.tsx as the primary Ink component.
 * It renders only pipeline-related views: PipelineView, StartPipelineOverlay,
 * and generic overlays (toast, help, confirm). No GitHub board browsing.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TextInput } from "@inkjs/ui";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useRef, useState } from "react";
import type { HogConfig, RepoConfig } from "../../config.js";
import { PIPELINE_ROLES, resolvePromptForRole } from "../../engine/roles.js";
import { usePipelineData } from "../hooks/use-pipeline-data.js";
import { useToast } from "../hooks/use-toast.js";
import { launchClaude } from "../launch-claude.js";
import { PipelineView } from "./pipeline-view.js";
import { StartPipelineOverlay } from "./start-pipeline-overlay.js";
import { ToastContainer } from "./toast-container.js";

// ── Types ──

interface CockpitProps {
  readonly config: HogConfig;
}

type CockpitMode = "normal" | "overlay:startPipeline" | "help" | "decisionText";

// ── Help Overlay ──

function HelpOverlay({ onClose }: { readonly onClose: () => void }) {
  useInput((_input, key) => {
    if (key.escape || _input === "?" || _input === "q") {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Pipeline Cockpit — Keyboard Shortcuts</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="cyan" bold>
            P
          </Text>{" "}
          New pipeline
        </Text>
        <Text>
          <Text color="cyan" bold>
            j/k
          </Text>{" "}
          Navigate pipelines
        </Text>
        <Text>
          <Text color="cyan" bold>
            x
          </Text>{" "}
          Pause / resume selected
        </Text>
        <Text>
          <Text color="cyan" bold>
            d
          </Text>{" "}
          Cancel selected pipeline
        </Text>
        <Text>
          <Text color="cyan" bold>
            Z
          </Text>{" "}
          Open brainstorm session (tmux)
        </Text>
        <Text>
          <Text color="cyan" bold>
            r
          </Text>{" "}
          Retry failed phase
        </Text>
        <Text>
          <Text color="cyan" bold>
            l
          </Text>{" "}
          Open pipeline log (tmux)
        </Text>
        <Text>
          <Text color="cyan" bold>
            1-9
          </Text>{" "}
          Answer pending decision
        </Text>
        <Text>
          <Text color="cyan" bold>
            ?
          </Text>{" "}
          Toggle this help
        </Text>
        <Text>
          <Text color="cyan" bold>
            q
          </Text>{" "}
          Quit
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press ? or Esc to close</Text>
      </Box>
    </Box>
  );
}

// ── Cockpit Component ──

export function Cockpit({ config }: CockpitProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { toasts, toast } = useToast();
  const pipelineData = usePipelineData(config, toast);

  const [mode, setMode] = useState<CockpitMode>("normal");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [termSize, setTermSize] = useState({
    cols: stdout?.columns ?? 120,
    rows: stdout?.rows ?? 40,
  });

  // Track terminal resize
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setTermSize({
        cols: stdout.columns ?? 120,
        rows: stdout.rows ?? 40,
      });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Free-text decision input
  const decisionTextRef = useRef("");

  // Activity log for selected pipeline (from hook's accumulated events)
  const selected = pipelineData.pipelines[selectedIndex];
  const activityEntries = selected
    ? (pipelineData.activityLog.get(selected.featureId) ?? [])
    : [];

  // ── Keyboard Handling ──

  useInput(
    (input, key) => {
      // Esc closes overlays
      if (key.escape) {
        if (mode === "overlay:startPipeline" || mode === "help") {
          setMode("normal");
        }
        return;
      }

      if (mode !== "normal") return;

      // P — start new pipeline
      if (input === "P") {
        setMode("overlay:startPipeline");
        return;
      }

      // ? — toggle help
      if (input === "?") {
        setMode("help");
        return;
      }

      // q — quit
      if (input === "q") {
        exit();
        return;
      }

      // j/k — navigate
      if (input === "j" || key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, pipelineData.pipelines.length - 1));
        return;
      }
      if (input === "k" || key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      // x — pause/resume
      if (input === "x") {
        const selected = pipelineData.pipelines[selectedIndex];
        if (selected) {
          if (selected.status === "running") {
            pipelineData.pausePipeline(selected.featureId);
            toast.info(`Paused: ${selected.title}`);
          } else if (selected.status === "paused") {
            pipelineData.resumePipeline(selected.featureId);
            toast.info(`Resumed: ${selected.title}`);
          }
        }
        return;
      }

      // d — cancel pipeline
      if (input === "d") {
        const selected = pipelineData.pipelines[selectedIndex];
        if (selected) {
          pipelineData.cancelPipeline(selected.featureId);
          toast.info(`Cancelled: ${selected.title}`);
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        }
        return;
      }

      // Z — brainstorm session
      if (input === "Z") {
        const selected = pipelineData.pipelines[selectedIndex];
        if (selected?.activePhase === "brainstorm") {
          const localPath = selected.localPath;
          if (!localPath) {
            toast.error("Pipeline has no localPath configured");
            return;
          }
          const slug = selected.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const spec = selected.description ?? selected.title;
          const { prompt: resolvedBsPrompt, usingSkill: bsUsingSkill } =
            resolvePromptForRole("brainstorm");
          const brainstormPrompt = bsUsingSkill
            ? resolvedBsPrompt
            : resolvedBsPrompt
                .replace(/\{title\}/g, selected.title)
                .replace(/\{slug\}/g, slug)
                .replace(/\{spec\}/g, spec)
                .replace(/\{featureId\}/g, selected.featureId);

          const result = launchClaude({
            localPath,
            issue: { number: 0, title: selected.title, url: "" },
            promptTemplate: brainstormPrompt,
            launchMode: config.pipeline.launchMode ?? "auto",
            ...(config.pipeline.terminalApp ? { terminalApp: config.pipeline.terminalApp } : {}),
          });
          if (result.ok) {
            toast.info("Brainstorm session opened");
          } else {
            toast.error(result.error.message);
          }
        }
        return;
      }

      // l — open log
      if (input === "l") {
        const selected = pipelineData.pipelines[selectedIndex];
        if (selected) {
          // Try per-pipeline event log first, fall back to shared log
          const pipelinesDir = join(process.env["HOME"] ?? "", ".config", "hog", "pipelines");
          const perPipelineLog = join(pipelinesDir, `${selected.featureId}.events.jsonl`);
          const sharedLog = join(pipelinesDir, "events.jsonl");
          const logFile = existsSync(perPipelineLog)
            ? perPipelineLog
            : existsSync(sharedLog)
              ? sharedLog
              : null;

          if (logFile) {
            // Try tmux first, fall back to spawning in a new terminal
            const isInTmux = !!process.env["TMUX"];
            if (isInTmux) {
              try {
                const child = spawn(
                  "tmux",
                  ["new-window", "-n", "pipeline-log", "tail", "-f", logFile],
                  { stdio: "ignore", detached: true },
                );
                child.unref();
                toast.info("Log opened in tmux window");
              } catch {
                toast.error("Failed to open log in tmux");
              }
            } else {
              // Without tmux, just show the path
              toast.info(`Log: ${logFile}`);
            }
          } else {
            toast.info("No log file yet");
          }
        }
        return;
      }

      // r — retry failed phase (reopen the bead via pipeline.done)
      if (input === "r") {
        const selected = pipelineData.pipelines[selectedIndex];
        if (selected && (selected.status === "blocked" || selected.status === "failed")) {
          // Resume the pipeline — the conductor will re-tick and re-spawn
          pipelineData.resumePipeline(selected.featureId).then((ok) => {
            if (ok) {
              toast.info("Retrying failed phase...");
            }
          });
        }
        return;
      }

      // D — enter free-text decision mode (Newport: beyond numbered options)
      if (input === "D" && pipelineData.pendingDecisions.length > 0) {
        setMode("decisionText");
        return;
      }

      // 1-9 — answer pending decision with preset option
      if (/^[1-9]$/.test(input) && pipelineData.pendingDecisions.length > 0) {
        const decision = pipelineData.pendingDecisions[0];
        if (decision?.options) {
          const idx = parseInt(input, 10) - 1;
          const answer = decision.options[idx];
          if (answer) {
            pipelineData.resolveDecision(decision.id, answer);
            toast.info(`Decision resolved: ${answer}`);
          }
        }
        return;
      }
    },
    { isActive: mode === "normal" },
  );

  // If we're in decisionText mode but the decision was resolved externally,
  // reset to normal mode via an effect (not during render).
  const hasDecision = pipelineData.pendingDecisions.length > 0;
  useEffect(() => {
    if (mode === "decisionText" && !hasDecision) {
      setMode("normal");
    }
  }, [mode, hasDecision]);

  // ── Render ──

  // Free-text decision input mode
  if (mode === "decisionText") {
    const decision = pipelineData.pendingDecisions[0];
    if (!decision) {
      return null;
    }
    return (
      <Box flexDirection="column" height={termSize.rows} paddingX={2} paddingY={1}>
        <Text bold>Answer Decision</Text>
        <Box marginTop={1}>
          <Text>{decision.question}</Text>
        </Box>
        {decision.options ? (
          <Box marginTop={1} flexDirection="column">
            {decision.options.map((opt, i) => (
              <Text key={opt} dimColor>
                [{i + 1}] {opt}
              </Text>
            ))}
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text color="cyan">Answer: </Text>
          <TextInput
            placeholder="Type your answer..."
            onChange={(val) => {
              decisionTextRef.current = val;
            }}
            onSubmit={() => {
              const answer = decisionTextRef.current.trim();
              if (answer) {
                pipelineData.resolveDecision(decision.id, answer);
                toast.info(`Decision resolved: ${answer}`);
                decisionTextRef.current = "";
              }
              setMode("normal");
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to submit, Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Start pipeline overlay
  if (mode === "overlay:startPipeline") {
    return (
      <Box flexDirection="column" height={termSize.rows}>
        <StartPipelineOverlay
          beadsAvailable={pipelineData.beadsAvailable}
          onSubmit={(description) => {
            const cwd = process.cwd();
            let targetRepo = config.repos.find((r) => r.localPath && cwd.startsWith(r.localPath));
            let repoName: string;
            if (targetRepo) {
              repoName = targetRepo.name;
            } else {
              const dirName = cwd.split("/").pop() ?? "project";
              repoName = dirName;
              targetRepo = {
                name: dirName,
                shortName: dirName,
                projectNumber: 0,
                statusFieldId: "",
                localPath: cwd,
                completionAction: { type: "closeIssue" },
              } as RepoConfig;
            }
            const title =
              description
                .split(/[.!?\n]/)[0]
                ?.trim()
                .slice(0, 60) ?? description.slice(0, 60);
            pipelineData
              .startPipeline(repoName, targetRepo, title, description)
              .then((result) => {
                setMode("normal");
                if ("error" in result) {
                  toast.error(`Pipeline failed: ${result.error}`);
                  return;
                }
                // Auto-launch brainstorm session — no Z step needed
                if (!("error" in result)) {
                  const pipeline = result;
                  const localPath = pipeline.localPath || cwd;
                  const slug = pipeline.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "");
                  const spec = description;
                  const { prompt: resolvedBsPrompt2, usingSkill: bsUsingSkill2 } =
                    resolvePromptForRole("brainstorm");
                  const brainstormPrompt = bsUsingSkill2
                    ? `${resolvedBsPrompt2}\n\n${spec}`
                    : resolvedBsPrompt2
                        .replace(/\{title\}/g, pipeline.title)
                        .replace(/\{slug\}/g, slug)
                        .replace(/\{spec\}/g, spec)
                        .replace(/\{featureId\}/g, pipeline.featureId);

                  const launchResult = launchClaude({
                    localPath,
                    issue: { number: 0, title: pipeline.title, url: "" },
                    promptTemplate: brainstormPrompt,
                    launchMode: config.pipeline.launchMode ?? "auto",
                    ...(config.pipeline.terminalApp
                      ? { terminalApp: config.pipeline.terminalApp }
                      : {}),
                  });
                  if (launchResult.ok) {
                    toast.info("Brainstorm session opened");
                  } else {
                    toast.error(
                      `Brainstorm launch failed: ${launchResult.error.message}. Press Z to retry.`,
                    );
                  }
                }
              })
              .catch(() => setMode("normal"));
          }}
          onCancel={() => setMode("normal")}
        />
        <ToastContainer toasts={toasts} />
      </Box>
    );
  }

  // Help overlay
  if (mode === "help") {
    return (
      <Box flexDirection="column" height={termSize.rows}>
        <HelpOverlay onClose={() => setMode("normal")} />
      </Box>
    );
  }

  // Build context-sensitive hints
  const hasDecisions = pipelineData.pendingDecisions.length > 0;
  const hasPipelines = pipelineData.pipelines.length > 0;
  const canPauseResume = selected?.status === "running" || selected?.status === "paused";

  // Normal: pipeline view + hint bar
  return (
    <Box flexDirection="column" height={termSize.rows}>
      <PipelineView
        data={{
          pipelines: pipelineData.pipelines,
          agents: pipelineData.agents,
          pendingDecisions: pipelineData.pendingDecisions,
          mergeQueue: pipelineData.mergeQueue,
          selectedIndex,
          activityEntries,
        }}
        cols={termSize.cols}
        rows={termSize.rows - 4}
      />
      <ToastContainer toasts={toasts} />
      {/* Hint bar — always visible, context-sensitive (lazygit pattern) */}
      <Box flexShrink={0} height={1}>
        <Text dimColor wrap="truncate">
          {[
            "P:new",
            hasPipelines ? "j/k:nav" : "",
            selected?.activePhase === "brainstorm" ? "Z:brainstorm" : "",
            canPauseResume ? `x:${selected?.status === "paused" ? "resume" : "pause"}` : "",
            selected?.status === "blocked" || selected?.status === "failed" ? "r:retry" : "",
            hasPipelines ? "d:cancel" : "",
            hasPipelines ? "l:log" : "",
            hasDecisions ? "D:answer" : "",
            hasDecisions ? "1-9:pick" : "",
            "?:help",
            "q:quit",
          ]
            .filter(Boolean)
            .join("  ")}
        </Text>
      </Box>
    </Box>
  );
}
