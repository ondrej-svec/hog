---
title: "refactor: pipeline prompt overhaul — from self-attested to verified"
type: plan
date: 2026-03-29
status: complete
confidence: high
---

# Pipeline Prompt Overhaul

> The impl agent wrote a regex classifier instead of using the AI SDK the architecture doc specified.
> The tests passed. The stub detection passed. The self-check passed.
> Everything passed except the actual requirement.

**One-line summary:** Make every phase treat the architecture doc as binding law, make self-checks
executable (run commands, not self-attest), and add feedback loops so agents fix their own work
before completing.

## Problem Statement

The current pipeline prompts have three structural weaknesses:

1. **Architecture doc is advisory, not binding.** The impl agent is told "if the architecture doc
   says use library X, use it" — but there's no verification. The agent can write a regex
   classifier instead of using the AI SDK and self-certify that it "followed the architecture doc."

2. **Self-checks are self-attested.** Every phase ends with "Before finishing, verify: did you do X?"
   The agent says "yes" and moves on. There's no external verification. The agent marks its own homework.

3. **No feedback loops within phases.** Each agent runs once. If the output is incomplete, the only
   catch is a downstream phase (redteam) or a gate (stub detection). By then, the context is lost
   and the fix is expensive.

## Proposed Solution

Three changes applied to ALL 7 phase prompts:

### Change 1: Architecture doc as binding contract

Every phase prompt that references the architecture doc must treat it as **binding requirements**,
not suggestions. Specifically:

- **Dependencies listed in the architecture doc MUST be installed and imported.** If the architecture
  doc says "use @ai-sdk/anthropic", the impl MUST `import { streamText } from 'ai'` — not write
  a regex classifier. The test writer MUST write tests that verify the import exists.

- **File paths in the architecture doc are exact.** If it says `apps/web/lib/coaching/engine.ts`,
  that's where the file goes. Not `src/coaching.ts`. Not `lib/engine.ts`.

- **Integration patterns are requirements.** If the architecture doc says "constructor injection for
  testability", the impl MUST use constructor injection — not global singletons.

### Change 2: Executable self-checks (verify by running, not by asserting)

Replace declarative self-checks ("Did you use real libraries?") with executable ones:

**Test writer — before completing:**
```
1. Run the test suite — confirm ALL tests FAIL (not some pass by accident)
2. Run: grep -r "STORY-" <test-dir> — confirm every test references a story ID
3. Read the architecture doc's ## Dependencies section
4. For each dependency: verify at least one test imports from it
   (e.g., grep -r "from '@ai-sdk" <test-dir>)
5. If any check fails → fix the tests, don't self-certify
```

**Implementer — before completing:**
```
1. Run the FULL test suite — confirm ALL tests PASS
2. Read the architecture doc's ## Dependencies section
3. For each dependency: verify it's in package.json AND imported in source code
   (e.g., grep -r "from '@ai-sdk" <src-dir>)
4. If a dependency from the architecture doc is NOT imported → you built a stub.
   Go back and implement with the real library.
5. Run: grep -rn "hardcoded\|TODO\|FIXME\|stub\|placeholder\|dummy" <src-dir>
   If any matches → fix them before completing.
```

**Redteam — before completing:**
```
1. Read the architecture doc's ## Dependencies section
2. For each dependency: verify it appears in the IMPLEMENTATION (not just tests)
   If missing → write a test that imports and calls it (will fail → exposes the stub)
3. Read the architecture doc's ## Integration Pattern section
4. Verify the implementation follows the pattern (e.g., constructor injection, not globals)
   If not → write a test that verifies the pattern
5. Run ALL tests (existing + new) — confirm new tests FAIL against current impl
```

### Change 3: Feedback loops (fix before completing)

Each phase gets an explicit loop instruction:

```
After your self-check, if ANY item failed:
1. Fix the issue (don't just note it — actually fix it)
2. Re-run the self-check
3. Repeat until all checks pass or you've tried 3 times
4. If still failing after 3 attempts: complete anyway, but your summary
   MUST start with "INCOMPLETE:" followed by what's still failing
```

The conductor's summary sentiment gate will catch "INCOMPLETE:" and escalate to human.

## Implementation Tasks

### Phase A: Test Writer prompt overhaul

- [ ] A1. Add "Architecture doc is binding" section to TEST_PROMPT:
  - Read `## Dependencies` section — for each dependency, write at least one test
    that imports from it and verifies it's used correctly
  - Read `## Integration Pattern` section — write tests that verify the pattern
    (e.g., test that constructor accepts a mock, test that dependency injection works)
  - These are "architectural conformance tests" — they verify the HOW, not just the WHAT

- [ ] A2. Add executable self-check to TEST_PROMPT:
  - Run tests → all fail
  - grep STORY- in test files → all tests reference stories
  - grep each architecture doc dependency in test files → all are tested
  - If any check fails → fix and re-run

- [ ] A3. Add feedback loop instruction to TEST_PROMPT

- [ ] A4. Update TEST_CLAUDE_MD in role-context.ts to match

### Phase B: Implementer prompt overhaul

- [ ] B1. Add "Architecture doc is binding" section to IMPL_PROMPT:
  - Read `## Dependencies` section — install EVERY listed dependency
  - Import and USE every dependency (not just install it)
  - Read `## Integration Pattern` section — follow it exactly
  - If the architecture doc says "Vercel AI SDK with streamText", you MUST
    use `streamText` from the `ai` package — not write your own solution

- [ ] B2. Add executable self-check to IMPL_PROMPT:
  - Run tests → all pass
  - For each dependency in architecture doc: grep for import in source → must exist
  - grep for stub patterns (hardcoded, TODO, FIXME, placeholder, dummy) → must be zero
  - If any dependency from arch doc is NOT imported → you built a stub, go back and fix

- [ ] B3. Add feedback loop instruction to IMPL_PROMPT

- [ ] B4. Add explicit "what a stub looks like" examples:
  - "A regex classifier instead of an LLM call is a stub"
  - "A function that returns different hardcoded strings based on input is a stub"
  - "A mock/fake that's shipped as production code is a stub"

- [ ] B5. Update IMPL_CLAUDE_MD in role-context.ts to match

### Phase C: Redteam prompt overhaul

- [ ] C1. Add "Architecture conformance" as a primary category alongside security:
  - Verify each dependency from architecture doc is imported AND called in source
  - Verify integration patterns match what the architecture doc prescribes
  - Verify file structure matches architecture doc's `## File Structure`
  - Write failing tests for any architectural violations found

- [ ] C2. Add executable verification to REDTEAM_PROMPT:
  - For each dep in arch doc: grep in source → if missing, write a failing test
  - For each file path in arch doc: verify file exists at that path
  - Check that no "shortcut" libraries are used instead of specified ones

- [ ] C3. Add feedback loop instruction to REDTEAM_PROMPT

- [ ] C4. Update REDTEAM_CLAUDE_MD in role-context.ts to match

### Phase D: Scaffold prompt fix

- [ ] D1. Fix contradiction: remove "Create placeholder entry points" from SCAFFOLD_CLAUDE_MD
  (contradicts the prompt's "ZERO lines of code")

- [ ] D2. Add architecture doc dependency verification to scaffold:
  - After installing dependencies, verify they're in package.json/lock file
  - Report installed vs. missing in the context file

### Phase E: Stories prompt alignment

- [ ] E1. Add ADR requirement to STORIES_PROMPT (currently only in brainstorm):
  - Stories should reference WHY, not just WHAT — at minimum, each story should
    note which architecture doc dependency/pattern it exercises

- [ ] E2. Add "Architecture doc validation" self-check:
  - Does `## File Structure` specify exact paths (not just directories)?
  - Does `## Dependencies` list specific packages with versions?

### Phase F: Merge prompt clarity

- [ ] F1. Clarify merge agent's role: report ONLY, never execute merge
  (the Refinery handles the actual merge)

- [ ] F2. Add architecture doc verification to merge checklist:
  - All dependencies from arch doc are in package.json
  - File structure matches arch doc's `## File Structure`

### Phase G: Brainstorm — no changes needed

The brainstorm prompt was recently overhauled (ADRs, requirements, security).
No changes needed. It's the strongest prompt in the pipeline.

### Phase H: Cross-cutting fixes

- [ ] H1. Fix SCAFFOLD_CLAUDE_MD contradiction (placeholder entry points vs zero code)
- [ ] H2. Fix IMPL forbidden-docs gap (prompt says "any upstream docs", CLAUDE.md says specific paths)
- [ ] H3. Fix MERGE ambiguity (clarify: report only, don't execute merge)
- [ ] H4. Add variable substitution guard to all prompts:
  "If you see literal `{storiesPath}` or `{archPath}` in your instructions (with curly braces),
   the path was not substituted. Search for the stories/architecture files manually."

## Acceptance Criteria

- [ ] Test writer writes at least one test per architecture doc dependency (not just behavioral tests)
- [ ] Implementer's self-check verifies every arch doc dependency is imported in source
- [ ] Redteam checks architectural conformance, not just security and scaffolding
- [ ] A lazy impl that uses regex instead of the specified AI SDK would be caught by:
  (a) test writer (wrote a test that imports from @ai-sdk)
  (b) impl self-check (grep for @ai-sdk import fails → must fix)
  (c) redteam (verifies arch doc deps are in source → writes failing test)
- [ ] "INCOMPLETE:" in agent summary triggers human escalation via sentiment gate
- [ ] No contradictions between prompt and CLAUDE.md for any phase
- [ ] All prompts include variable substitution fallback guard

## Decision Rationale

### Why executable self-checks instead of a verification phase?

A separate verification agent adds latency and cost. Making each agent verify its OWN work
with concrete commands (grep, test runs) is faster, cheaper, and more effective — the agent
has full context about what it just did. The key insight: self-checking fails when it's
declarative ("did you do X?"). It succeeds when it's executable ("run this command and
check the output").

### Why "architecture doc is binding" instead of just better stub detection?

Stub detection is a symptom fix. The root cause is that the impl agent treats the architecture
doc as inspiration, not requirements. A regex classifier IS an implementation — it just doesn't
match the architecture. By making the architecture doc binding, the impl agent can't rationalize
shortcuts: "the architecture doc says AI SDK → I must import AI SDK."

### Why feedback loops instead of retries from the conductor?

Conductor retries re-spawn the agent with a fresh context window. The agent loses all the
knowledge it built during the session. An in-phase feedback loop lets the agent fix its own
work while it still has context. The conductor retry is the fallback when the loop exhausts.

### Why not add a "verification phase" between impl and redteam?

The redteam IS the verification. We just need to tell it to verify architecture compliance,
not just security. Adding another phase increases latency without adding capability.

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| Agents can run grep/find to verify their own work | Verified | All agents have Bash access |
| Architecture doc consistently uses `## Dependencies` section | Verified | BRAINSTORM_PROMPT prescribes exact section names |
| grep for import paths reliably detects dependency usage | Mostly verified | Works for JS/TS/Python imports. Rust `use` needs different pattern. |
| "INCOMPLETE:" prefix in summary triggers sentiment gate | Verified | Summary parser checks for failure patterns |
| Feedback loop (3 retries) won't cause excessive cost | Unverified | Each retry within a session is cheap (no new process). But could extend agent time. Cap at 3. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Executable self-checks add 1-2 minutes per phase | Medium | Low | grep is fast. Worth the quality improvement. |
| Agents ignore the feedback loop instruction | Low | Medium | The summary sentiment gate catches "INCOMPLETE:". Conductor retry is the fallback. |
| Architecture doc doesn't have `## Dependencies` section | Medium | Medium | Variable guard: if section not found, skip dependency verification, note in summary. |
| Over-specific prompts become brittle across languages | Medium | Medium | Use generic patterns (grep for imports) not language-specific. Agents adapt. |
