/**
 * Brainstorm pipeline context builder — shared between conductor and cockpit.
 *
 * Constructs the prompt context and env vars that tell the brainstorm agent
 * where to write stories/architecture docs and how to advance the pipeline.
 */
import { resolvePromptForRole } from "./roles.js";
import { detectStack } from "./stack-detection.js";

export interface BrainstormLaunchContext {
  /** The full prompt to pass to Claude (skill invocation + spec + pipeline context). */
  readonly prompt: string;
  /** Env vars for the Claude session (HOG_PIPELINE, FEATURE_ID, etc.). */
  readonly env: Readonly<Record<string, string>>;
  /** Kebab-case slug derived from the title. */
  readonly slug: string;
  /** Path where stories should be written. */
  readonly storiesPath: string;
  /** Path where architecture doc should be written. */
  readonly archPath: string;
}

/**
 * Build the brainstorm prompt and env vars for a pipeline session.
 *
 * Used by both the conductor's launchBrainstormSession and the cockpit's
 * Z-key and P:new handlers. Single source of truth for pipeline context.
 */
export function buildBrainstormLaunchContext(opts: {
  title: string;
  description: string;
  featureId: string;
  /** Project directory — used for stack detection. */
  cwd?: string | undefined;
}): BrainstormLaunchContext {
  const slug = opts.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const storiesPath = `docs/stories/${slug}.md`;
  const archPath = `docs/stories/${slug}.architecture.md`;
  const spec = opts.description;

  // Detect stack for framework-aware brainstorming
  let stackLine = "";
  if (opts.cwd) {
    try {
      const stack = detectStack(opts.cwd);
      if (stack) {
        stackLine = `\nDetected stack: ${stack.framework} (${stack.runtime}). Keep this in mind for architecture decisions.\n`;
      }
    } catch { /* best-effort */ }
  }

  const pipelineContext = [
    `<hog_pipeline_context>`,
    `You are running inside a hog pipeline. Feature: "${opts.title}"`,
    `Feature ID: ${opts.featureId}`,
    ``,
    `After brainstorming, you MUST produce these artifacts:`,
    `1. Write user stories to ${storiesPath}`,
    `   - Each story: unique ID (STORY-001), description, acceptance criteria, edge cases`,
    `2. Write architecture doc to ${archPath}`,
    `   - Requirements (FR/NFR), ADRs, Dependencies, Integration Pattern, File Structure`,
    `3. Run \`hog pipeline done ${opts.featureId}\` to close brainstorm and advance the pipeline`,
    ``,
    `Do NOT skip step 3 — the pipeline cannot advance without it.`,
    `These file paths are EXACT — do not use different names.`,
    stackLine,
    `</hog_pipeline_context>`,
  ].join("\n");

  const { prompt: resolvedPrompt, usingSkill } = resolvePromptForRole("brainstorm");
  const prompt = usingSkill
    ? `${resolvedPrompt}\n\n${spec}\n\n${pipelineContext}`
    : resolvedPrompt
        .replace(/\{title\}/g, opts.title)
        .replace(/\{slug\}/g, slug)
        .replace(/\{spec\}/g, spec)
        .replace(/\{featureId\}/g, opts.featureId);

  const env: Record<string, string> = {
    HOG_PIPELINE: "1",
    FEATURE_ID: opts.featureId,
    HOG_SLUG: slug,
    STORIES_PATH: storiesPath,
    ARCH_PATH: archPath,
  };

  return { prompt, env, slug, storiesPath, archPath };
}
