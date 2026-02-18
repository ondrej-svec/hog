import type { HogConfig } from "../../config.js";
import type { GitHubIssue, LabelOption, StatusOption } from "../../github.js";
import type { UIState } from "../hooks/use-ui-state.js";
import type { BulkAction } from "./bulk-action-menu.js";
import { BulkActionMenu } from "./bulk-action-menu.js";
import { CommentInput } from "./comment-input.js";
import { ConfirmPrompt } from "./confirm-prompt.js";
import { CreateIssueForm } from "./create-issue-form.js";
import type { FocusEndAction } from "./focus-mode.js";
import { FocusMode } from "./focus-mode.js";
import { HelpOverlay } from "./help-overlay.js";
import { LabelPicker } from "./label-picker.js";
import { SearchBar } from "./search-bar.js";
import { StatusPicker } from "./status-picker.js";

export interface OverlayRendererProps {
  readonly uiState: UIState;
  readonly config: HogConfig;
  // Status picker
  readonly selectedRepoStatusOptions: StatusOption[];
  readonly currentStatus: string | undefined;
  readonly onStatusSelect: (optionId: string) => void;
  readonly onExitOverlay: () => void;
  // Create issue
  readonly defaultRepo: string | null;
  readonly onCreateIssue: (repo: string, title: string, labels?: string[]) => void;
  // Confirm pick
  readonly onConfirmPick: () => void;
  readonly onCancelPick: () => void;
  // Bulk action
  readonly multiSelectCount: number;
  readonly multiSelectType: "github" | "ticktick" | "mixed";
  readonly onBulkAction: (action: BulkAction) => void;
  // Focus mode
  readonly focusLabel: string | null;
  readonly focusKey: number;
  readonly onFocusExit: () => void;
  readonly onFocusEndAction: (action: FocusEndAction) => void;
  // Search
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly onSearchSubmit: () => void;
  // Comment
  readonly selectedIssue: GitHubIssue | null;
  readonly onComment: (body: string) => void;
  // Help
  readonly onToggleHelp: () => void;
  // Label picker
  readonly labelCache: Record<string, LabelOption[]>;
  readonly onLabelConfirm: (addLabels: string[], removeLabels: string[]) => void;
  readonly onLabelError: (msg: string) => void;
  // NL create overlay (placeholder — implemented in Phase 4)
  readonly onNlCreateCancel: () => void;
}

/** Renders whichever overlay is active based on uiMode. */
function OverlayRenderer({
  uiState,
  config,
  selectedRepoStatusOptions,
  currentStatus,
  onStatusSelect,
  onExitOverlay,
  defaultRepo,
  onCreateIssue,
  onConfirmPick,
  onCancelPick,
  multiSelectCount,
  multiSelectType,
  onBulkAction,
  focusLabel,
  focusKey,
  onFocusExit,
  onFocusEndAction,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  selectedIssue,
  onComment,
  onToggleHelp,
  labelCache,
  onLabelConfirm,
  onLabelError,
}: OverlayRendererProps) {
  const { mode, helpVisible } = uiState;

  return (
    <>
      {/* Help overlay (stacks on top of any mode) */}
      {helpVisible ? (
        <HelpOverlay currentMode={mode} onClose={onToggleHelp} />
      ) : null}

      {/* Status picker overlay */}
      {mode === "overlay:status" && selectedRepoStatusOptions.length > 0 ? (
        <StatusPicker
          options={selectedRepoStatusOptions}
          currentStatus={currentStatus}
          onSelect={onStatusSelect}
          onCancel={onExitOverlay}
        />
      ) : null}

      {/* Create issue form overlay */}
      {mode === "overlay:create" ? (
        <CreateIssueForm
          repos={config.repos}
          defaultRepo={defaultRepo}
          onSubmit={onCreateIssue}
          onCancel={onExitOverlay}
          labelCache={labelCache}
        />
      ) : null}

      {/* Confirm pick prompt (after issue create) */}
      {mode === "overlay:confirmPick" ? (
        <ConfirmPrompt
          message="Pick this issue?"
          onConfirm={onConfirmPick}
          onCancel={onCancelPick}
        />
      ) : null}

      {/* Bulk action menu overlay */}
      {mode === "overlay:bulkAction" ? (
        <BulkActionMenu
          count={multiSelectCount}
          selectionType={multiSelectType}
          onSelect={onBulkAction}
          onCancel={onExitOverlay}
        />
      ) : null}

      {/* Focus mode overlay */}
      {mode === "focus" && focusLabel ? (
        <FocusMode
          key={focusKey}
          label={focusLabel}
          durationSec={config.board.focusDuration ?? 1500}
          onExit={onFocusExit}
          onEndAction={onFocusEndAction}
        />
      ) : null}

      {/* Label picker overlay */}
      {mode === "overlay:label" && selectedIssue ? (
        <LabelPicker
          repo={defaultRepo ?? ""}
          currentLabels={selectedIssue.labels.map((l) => l.name)}
          labelCache={labelCache}
          onConfirm={onLabelConfirm}
          onCancel={onExitOverlay}
          onError={onLabelError}
        />
      ) : null}

      {/* Search bar */}
      {mode === "search" ? (
        <SearchBar
          defaultValue={searchQuery}
          onChange={onSearchChange}
          onSubmit={onSearchSubmit}
        />
      ) : null}

      {/* Comment input */}
      {mode === "overlay:comment" && selectedIssue ? (
        <CommentInput
          issueNumber={selectedIssue.number}
          onSubmit={onComment}
          onCancel={onExitOverlay}
        />
      ) : null}
    </>
  );
}

export { OverlayRenderer };
