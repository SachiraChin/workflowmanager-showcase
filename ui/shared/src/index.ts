/**
 * @wfm/shared - Shared UI components for workflow manager
 *
 * This package provides reusable rendering components that can be used by:
 * - webui: Full workflow execution UI
 * - editor: Visual workflow editor with mock previews
 */

// Types - Core API types (from types/index.ts)
export type {
  WorkflowStatus,
  InteractionType,
  MessageLevel,
  SSEEventType,
  SelectOption,
  InteractionRequest,
  WorkflowProgress,
  StartWorkflowRequest,
  StartWorkflowByVersionRequest,
  WorkflowVersion,
  WorkflowTemplate,
  WorkflowTemplatesResponse,
  InteractionResponseData,
  RespondRequest,
  ModelInfo,
  ProviderConfig,
  ModelsResponse,
  WorkflowResponse,
  WorkflowStatusResponse,
  SelectionItem,
  InteractionMode,
  CompletedInteraction,
  InteractionHistoryResponse,
  VersionDiffChange,
  VersionDiff,
  VersionConfirmationResult,
  SSEEventData,
  SSEStartedData,
  SSEProgressData,
  SSEInteractionData,
  SSECompleteData,
  SSEErrorData,
  SSEStateSnapshotData,
  SSEStateUpdateData,
  GroupOrigin,
  ModuleMetadata,
  ModuleConfig,
  StepDefinition,
  WorkflowDefinition,
  SubActionRequest,
  SubActionDef,
  TreeNodeIcon,
  TreeNodeMetadata,
  FileTreeNode,
  FileTree,
  WorkflowFile,
  WorkflowFileContent,
  ValidationConfig,
  ValidationMessage,
  ValidationResult,
  SSEValidationFailedData,
} from "./types/index";

// Types - Schema types
export * from "./types/schema";

// Types - Interaction state types
export * from "./types/interaction-state";

// Contexts
export * from "./contexts/RenderContext";
export * from "./contexts/WorkflowStateContext";
export * from "./contexts/MediaAdapterContext";
export {
  SubActionProvider,
  useSubAction,
  useSubActionOptional,
  type SubActionExecutor,
  type SubActionState,
  type SubActionContextValue,
} from "./contexts/sub-action-context";
export {
  InteractionProvider,
  useInteraction,
  useInteractionHostInternal,
  ActionSlotTarget,
  type InteractionContextValue,
} from "./contexts/interaction-context";
export {
  ValidationProviderWithRequest,
  useValidation,
  useValidationOptional,
  validateResponse,
  getValidationsForAction,
  type ValidationContextValue,
  type WarningPopupState,
} from "./contexts/validation-context";

// Utils - Explicit exports to avoid conflicts
export { cn } from "./utils/cn";
export { renderTemplate } from "./utils/template-service";
export { getUx } from "./utils/ux-utils";
export {
  formatLabel,
  getItemAddon,
  formatTimeAgo,
  getDecorators,
  type DecoratorInfo,
} from "./utils/schema-utils";
export {
  childrenToArray,
  filterByAttr,
  filterByAttrExists,
  filterExcludingRenderAs,
  getAttr,
  getIndexFromPath,
} from "./utils/layout-utils";
export {
  formatTimeAgo as formatInteractionTimeAgo,
  getTimeBasedColor,
  isValidHexColor,
  normalizeHexColor,
  hexToStyle,
  hexToSwatchStyle,
  getHighlightClasses,
  getHighlightStyle,
  parseSelectionInput,
} from "./utils/interaction-utils";

// Renderers - Explicit exports
export { TextRenderer } from "./renderers/TextRenderer";
export { ColorRenderer } from "./renderers/ColorRenderer";
export { UrlRenderer } from "./renderers/UrlRenderer";
export { DateTimeRenderer } from "./renderers/DateTimeRenderer";
export { NumberRenderer } from "./renderers/NumberRenderer";
export { ImageRenderer } from "./renderers/ImageRenderer";
export { ErrorRenderer } from "./renderers/ErrorRenderer";
export { CopyButton, ColorSwatch, ExternalLink } from "./renderers/nudges";
export { DecoratorBadges } from "./renderers/DecoratorBadges";
export { TextareaInputRenderer } from "./renderers/TextareaInputRenderer";
export {
  SelectInputRenderer,
  buildOptionsFromSchema,
} from "./renderers/SelectInputRenderer";
export { SliderInputRenderer } from "./renderers/SliderInputRenderer";

// Layouts - Explicit exports
export { registerLayout, getLayout } from "./layouts/registry";
export type { LayoutProps, LayoutComponent } from "./layouts/types";

// Schema rendering
export { SchemaRenderer } from "./schema/SchemaRenderer";
export { ObjectSchemaRenderer } from "./schema/ObjectSchemaRenderer";
export { ArraySchemaRenderer } from "./schema/ArraySchemaRenderer";
export { TableSchemaRenderer } from "./schema/TableSchemaRenderer";
export { ContentPanelSchemaRenderer } from "./schema/ContentPanelSchemaRenderer";

// Schema selection
export {
  SelectionProvider,
  useSelection,
  useSelectionOptional,
  type SelectionContextValue,
  type InteractionMode as SelectionInteractionMode,
  type VariantStyle,
} from "./schema/selection/SelectionContext";
export { SelectableWrapper } from "./schema/selection/SelectableWrapper";
export { useSelectable, isSelectable, type SelectableState } from "./schema/selection/useSelectable";

// Schema tabs
export { TabsContext, type TabInfo, type TabsContextValue } from "./schema/tabs/TabsContext";
export { TabLayout } from "./schema/tabs/TabLayout";

// Schema input
export {
  InputSchemaActionsContext,
  InputSchemaStateContext,
  useInputSchema,
  useInputSchemaOptional,
  useInputSchemaActions,
  useInputSchemaActionsOptional,
  useInputSchemaState,
  useInputSchemaStateOptional,
  pathToKey,
  type InputSchemaContextValue,
  type InputSchemaActions,
  type InputSchemaState,
  type InputSchema,
  type DynamicOption,
} from "./schema/input/InputSchemaContext";
export { InputSchemaRenderer } from "./schema/input/InputSchemaRenderer";
export { InputSchemaComposer } from "./schema/input/InputSchemaComposer";

// Interactions
export { InteractionHost } from "./interactions/InteractionHost";
export { SchemaInteractionHost } from "./interactions/SchemaInteractionHost";
export type { SchemaInteractionState, SchemaInteractionResult } from "./interactions/SchemaInteractionHost";
export { TerminalRenderer } from "./interactions/TerminalRenderer";
export { InputRenderer } from "./interactions/InputRenderer";

// Interaction types
export { TextInputEnhanced } from "./interactions/types/text-input";
export { FileInputDropzone } from "./interactions/types/file-input";
export { FileDownload } from "./interactions/types/file-download";
export { StructuredSelect } from "./interactions/types/structured-select";
export { ReviewGrouped } from "./interactions/types/review-grouped";
export { FormInput } from "./interactions/types/form-input";
export { MediaGenerationHost } from "./interactions/types/media-generation";

// Core - API and config
export { api, ApiClient, ApiError, setAccessDeniedHandler } from "./core/api";
export { API_URL, IS_DEV, IS_PROD, getApiUrl, toMediaUrl } from "./core/config";
export {
  validateAgainstSchema,
  validateSchema,
  validateField,
  formatErrorsForDisplay,
  type ValidationError as CoreValidationError,
  type ValidationResult as CoreValidationResult,
} from "./core/validation";

// State management
export {
  useWorkflowStore,
  type ViewMode,
  type WorkflowExecutionState,
  type WorkflowActions,
  type WorkflowEvent,
  selectWorkflowRunId,
  selectStatus,
  selectProgress,
  selectCurrentInteraction,
  selectCompletedInteractions,
  selectIsProcessing,
  selectError,
  selectModuleOutputs,
  selectViewMode,
  selectCurrentViewIndex,
  selectModelsConfig,
  selectSelectedProvider,
  selectSelectedModel,
  selectAccessDenied,
} from "./state/workflow-store";

// State hooks
export { useWorkflowState as useWorkflowStateHook } from "./state/hooks/useWorkflowState";
export {
  useWorkflowExecution,
  setCapabilities,
  getCapabilities,
  type VersionConfirmationState,
} from "./state/hooks/useWorkflowExecution";
export { useDebugMode, getDebugMode } from "./state/hooks/useDebugMode";

// Workflow state features
export { StateTreeView } from "./features/workflow-state/StateTreeView";
export { FilesTreeView } from "./features/workflow-state/FilesTreeView";
export { MediaPreviewDialog } from "./features/workflow-state/MediaPreviewDialog";
export { ExecutionStatus } from "./features/workflow-state/ExecutionStatus";

// UI Components - Re-export all shadcn components
export * from "./components/ui/accordion";
export * from "./components/ui/alert";
export * from "./components/ui/badge";
export * from "./components/ui/button";
export * from "./components/ui/card";
export * from "./components/ui/checkbox";
export * from "./components/ui/collapsible";
export * from "./components/ui/dialog";
export * from "./components/ui/dropdown-menu";
export * from "./components/ui/input";
export * from "./components/ui/json-editor-dialog";
export * from "./components/ui/json-tree-view";
export * from "./components/ui/label";
export * from "./components/ui/magnetic-scroll-container";
export * from "./components/ui/popover";
export * from "./components/ui/progress";
export * from "./components/ui/radio-group";
export * from "./components/ui/scroll-area";
export * from "./components/ui/select";
export * from "./components/ui/separator";
export * from "./components/ui/skeleton";
export * from "./components/ui/slider";
export * from "./components/ui/switch";
export * from "./components/ui/table";
export * from "./components/ui/tabs";
export * from "./components/ui/textarea";
