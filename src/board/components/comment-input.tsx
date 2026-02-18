import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { TextInput } from "@inkjs/ui";
import { Box, Text, useInput, useStdin } from "ink";
import { useEffect, useRef, useState } from "react";
import { getInkInstance } from "../ink-instance.js";

interface CommentInputProps {
  readonly issueNumber: number;
  readonly onSubmit: (body: string) => void;
  readonly onCancel: () => void;
  readonly onPauseRefresh?: () => void;
  readonly onResumeRefresh?: () => void;
}

function CommentInput({
  issueNumber,
  onSubmit,
  onCancel,
  onPauseRefresh,
  onResumeRefresh,
}: CommentInputProps) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const { setRawMode } = useStdin();
  // Capture stable refs to avoid stale closures in useEffect
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  const onPauseRef = useRef(onPauseRefresh);
  const onResumeRef = useRef(onResumeRefresh);
  onSubmitRef.current = onSubmit;
  onCancelRef.current = onCancel;
  onPauseRef.current = onPauseRefresh;
  onResumeRef.current = onResumeRefresh;

  useInput((_input, key) => {
    if (editing) return;
    if (key.escape) {
      onCancel();
      return;
    }
    // ctrl+e: transition to "editing" sub-state before launching editor
    if (_input === "\x05") {
      setEditing(true);
    }
  });

  // Launch editor after TextInput has unmounted (editing === true)
  useEffect(() => {
    if (!editing) return;

    const editorEnv = process.env["VISUAL"] ?? process.env["EDITOR"] ?? "vi";
    // Split to handle "code --wait" style editors
    const [cmd, ...extraArgs] = editorEnv.split(" ").filter(Boolean);
    if (!cmd) {
      setEditing(false);
      return;
    }

    let tmpDir: string | null = null;
    let tmpFile: string | null = null;

    try {
      // Pause auto-refresh before handing over the terminal
      onPauseRef.current?.();

      // Prepare temp file with current value as seed content
      tmpDir = mkdtempSync(join(tmpdir(), "hog-comment-"));
      tmpFile = join(tmpDir, "comment.md");
      writeFileSync(tmpFile, value);

      // Suspend Ink and restore terminal to cooked mode
      const inkInstance = getInkInstance();
      inkInstance?.clear();
      setRawMode(false);

      spawnSync(cmd, [...extraArgs, tmpFile], { stdio: "inherit" });

      // Read back the file content
      const content = readFileSync(tmpFile, "utf-8").trim();

      // Restore raw mode for Ink
      setRawMode(true);

      if (content) {
        onSubmitRef.current(content);
      } else {
        // Empty save — treat as cancel
        onCancelRef.current();
      }
    } finally {
      onResumeRef.current?.();
      if (tmpFile) {
        try {
          rmSync(tmpDir!, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
      setEditing(false);
    }
  }, [editing, value, setRawMode]);

  if (editing) {
    return (
      <Box>
        <Text color="cyan">Opening editor for #{issueNumber}…</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color="cyan">comment #{issueNumber}: </Text>
      <TextInput
        defaultValue={value}
        placeholder="type comment (ctrl+e for editor), Enter to post..."
        onChange={setValue}
        onSubmit={(text) => {
          if (text.trim()) onSubmit(text.trim());
          else onCancel();
        }}
      />
    </Box>
  );
}

export { CommentInput };
