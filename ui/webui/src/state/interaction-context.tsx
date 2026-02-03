/**
 * InteractionContext - Unified context for interaction components.
 *
 * Provides three mechanisms:
 * 1. Provider pattern - children register getResponse/getState, host pulls data on submit
 * 2. Feedback popup - children can trigger feedback popup, host manages it
 * 3. Action slots - children can contribute buttons to the host's footer via ActionSlot
 *
 * All action buttons (Continue, Retry All, Retry Selected) are rendered by InteractionHost.
 * Children can add custom actions (Download, etc.) via ActionSlot component.
 */

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import type { InteractionRequest, InteractionResponseData, InteractionMode } from "@/core/types";

// =============================================================================
// Types
// =============================================================================

/** Parameters passed to getResponse when action button is clicked */
export interface ResponseParams {
  action: "continue" | "retry_all" | "retry_selected";
  feedbackByGroup: Record<string, string>;
  globalFeedback: string;
}

/** State reported by child for button enabling */
export interface ProviderState {
  isValid: boolean;
  selectedCount: number;
  selectedGroupIds: string[];
  /** Number of generations (for media generation validation) */
  generationsCount?: number;
}

/** Configuration provided by child component */
export interface ProviderConfig {
  /** Build response in correct format - called when action button clicked */
  getResponse: (params: ResponseParams) => InteractionResponseData;
  /** Get current state for button enabling */
  getState: () => ProviderState;
}

/** Context for feedback popup */
export interface FeedbackPopupState {
  groupId: string;
  groupLabel: string;
  existingFeedback: string;
}

/** What child components see */
export interface InteractionContextValue {
  /** The interaction request data */
  request: InteractionRequest;
  /** Whether interaction is disabled */
  disabled: boolean;
  /** Interaction mode - active (interactive) or readonly (history view) */
  mode: InteractionMode;
  /** Register provider config - call when state changes */
  updateProvider: (config: ProviderConfig) => void;
  /** Trigger feedback popup for a specific group */
  openFeedbackPopup: (groupId: string, groupLabel: string) => void;
  /** Get existing feedback for a group (for display) */
  getFeedback: (groupId: string) => string | undefined;
  /** Register an action button to appear in footer (used by ActionSlot) */
  registerAction: (id: string, element: ReactNode) => void;
  /** Unregister an action button (used by ActionSlot cleanup) */
  unregisterAction: (id: string) => void;
}

/** Internal state for InteractionHost */
export interface InteractionHostInternalState {
  providerState: ProviderState;
  feedbackByGroup: Record<string, string>;
  globalFeedback: string;
  feedbackPopup: FeedbackPopupState | null;
  /** Actions registered by child components via ActionSlot (ref to avoid re-render cascade) */
  slotActionsRef: React.RefObject<Map<string, ReactNode>>;
  /** Version counter to trigger re-render of ActionSlotTarget */
  slotVersion: number;
  setGlobalFeedback: (feedback: string) => void;
  handleAction: (
    action: "continue" | "retry_all" | "retry_selected",
    options?: { actionId?: string; confirmedWarnings?: string[] }
  ) => void;
  handleFeedbackSubmit: (feedback: string) => void;
  handleFeedbackCancel: () => void;
}

// =============================================================================
// Context
// =============================================================================

const InteractionContext = createContext<InteractionContextValue | null>(null);
const HostInternalContext = createContext<InteractionHostInternalState | null>(null);

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook for child components to access interaction context.
 * Use this to register provider and trigger feedback popup.
 */
export function useInteraction(): InteractionContextValue {
  const ctx = useContext(InteractionContext);
  if (!ctx) {
    throw new Error("useInteraction must be used within InteractionHost");
  }
  return ctx;
}

/**
 * Hook for InteractionHost internal components (buttons, feedback modal).
 * Not for use by child interaction components.
 */
export function useInteractionHostInternal(): InteractionHostInternalState {
  const ctx = useContext(HostInternalContext);
  if (!ctx) {
    throw new Error("useInteractionHostInternal must be used within InteractionHost");
  }
  return ctx;
}

// =============================================================================
// Provider Component
// =============================================================================

interface InteractionProviderProps {
  request: InteractionRequest;
  disabled?: boolean;
  /** Interaction mode - defaults to active */
  mode?: InteractionMode;
  onSubmit: (response: InteractionResponseData) => void;
  children: ReactNode;
}

const DEFAULT_MODE: InteractionMode = { type: "active" };

export function InteractionProvider({
  request,
  disabled = false,
  mode = DEFAULT_MODE,
  onSubmit,
  children,
}: InteractionProviderProps) {
  // Provider registration
  const providerRef = useRef<ProviderConfig | null>(null);
  const [providerState, setProviderState] = useState<ProviderState>({
    isValid: false,
    selectedCount: 0,
    selectedGroupIds: [],
    generationsCount: 0,
  });

  // Feedback collection
  const [feedbackByGroup, setFeedbackByGroup] = useState<Record<string, string>>({});
  const [globalFeedback, setGlobalFeedback] = useState("");
  const [feedbackPopup, setFeedbackPopup] = useState<FeedbackPopupState | null>(null);

  // Action slot - child buttons that appear in footer
  // Use ref + version counter to avoid re-render cascade
  const slotActionsRef = useRef<Map<string, ReactNode>>(new Map());
  const [slotVersion, setSlotVersion] = useState(0);

  // === Child API ===

  const updateProvider = useCallback((config: ProviderConfig) => {
    providerRef.current = config;
    setProviderState(config.getState());
  }, []);

  const openFeedbackPopup = useCallback(
    (groupId: string, groupLabel: string) => {
      setFeedbackPopup({
        groupId,
        groupLabel,
        existingFeedback: feedbackByGroup[groupId] || "",
      });
    },
    [feedbackByGroup]
  );

  const getFeedback = useCallback(
    (groupId: string): string | undefined => {
      return feedbackByGroup[groupId];
    },
    [feedbackByGroup]
  );

  const registerAction = useCallback((id: string, element: ReactNode) => {
    const hadSlots = slotActionsRef.current.size > 0;
    slotActionsRef.current.set(id, element);
    // Only trigger re-render if we went from no slots to having slots
    if (!hadSlots && slotActionsRef.current.size > 0) {
      setSlotVersion((v) => v + 1);
    }
  }, []);

  const unregisterAction = useCallback((id: string) => {
    const hadSlots = slotActionsRef.current.size > 0;
    slotActionsRef.current.delete(id);
    // Only trigger re-render if we went from having slots to no slots
    if (hadSlots && slotActionsRef.current.size === 0) {
      setSlotVersion((v) => v + 1);
    }
  }, []);

  // === Host Internal API ===

  const handleAction = useCallback(
    (
      action: "continue" | "retry_all" | "retry_selected",
      options?: { actionId?: string; confirmedWarnings?: string[] }
    ) => {
      if (providerRef.current) {
        const response = providerRef.current.getResponse({
          action,
          feedbackByGroup,
          globalFeedback,
        });
        // Add validation fields if provided
        if (options?.actionId) {
          response.action_id = options.actionId;
        }
        if (options?.confirmedWarnings) {
          response.confirmed_warnings = options.confirmedWarnings;
        }
        onSubmit(response);
      }
    },
    [feedbackByGroup, globalFeedback, onSubmit]
  );

  const handleFeedbackSubmit = useCallback((feedback: string) => {
    if (feedbackPopup) {
      setFeedbackByGroup((prev) => ({
        ...prev,
        [feedbackPopup.groupId]: feedback,
      }));
      setFeedbackPopup(null);
    }
  }, [feedbackPopup]);

  const handleFeedbackCancel = useCallback(() => {
    setFeedbackPopup(null);
  }, []);

  // === Context values ===

  const childContext = useMemo<InteractionContextValue>(
    () => ({
      request,
      disabled,
      mode,
      updateProvider,
      openFeedbackPopup,
      getFeedback,
      registerAction,
      unregisterAction,
    }),
    [request, disabled, mode, updateProvider, openFeedbackPopup, getFeedback, registerAction, unregisterAction]
  );

  const hostInternalState = useMemo<InteractionHostInternalState>(
    () => ({
      providerState,
      feedbackByGroup,
      globalFeedback,
      feedbackPopup,
      slotActionsRef,
      slotVersion,
      setGlobalFeedback,
      handleAction,
      handleFeedbackSubmit,
      handleFeedbackCancel,
    }),
    [
      providerState,
      feedbackByGroup,
      globalFeedback,
      feedbackPopup,
      slotVersion,
      handleAction,
      handleFeedbackSubmit,
      handleFeedbackCancel,
    ]
  );

  return (
    <InteractionContext.Provider value={childContext}>
      <HostInternalContext.Provider value={hostInternalState}>
        {children}
      </HostInternalContext.Provider>
    </InteractionContext.Provider>
  );
}

// =============================================================================
// ActionSlot Component
// =============================================================================

interface ActionSlotProps {
  /** Unique identifier for this action */
  id: string;
  /** The button/action to render in the host's footer */
  children: ReactNode;
}

/**
 * Renders children into the InteractionHost footer alongside Continue button.
 * Use this for interaction-specific actions like Download, Copy, etc.
 *
 * @example
 * ```tsx
 * <ActionSlot id="download">
 *   <Button onClick={handleDownload}>Download</Button>
 * </ActionSlot>
 * ```
 */
export function ActionSlot({ id, children }: ActionSlotProps) {
  const { registerAction, unregisterAction } = useInteraction();

  // Store children in ref to avoid re-registering on every render
  const childrenRef = useRef<ReactNode>(children);
  childrenRef.current = children;

  // Register on mount only, unregister on unmount
  // Children updates are handled via ref (avoids render loop)
  useEffect(() => {
    registerAction(id, childrenRef.current);
    return () => unregisterAction(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, registerAction, unregisterAction]);

  // Renders nothing in place - content appears in ActionSlotTarget
  return null;
}

/**
 * Renders all registered slot actions. Used by InteractionHost footer.
 */
export function ActionSlotTarget() {
  // slotVersion in deps triggers re-render when slots change (ref itself doesn't trigger re-renders)
  const { slotActionsRef, slotVersion: _ } = useInteractionHostInternal();
  void _; // Prevent unused variable warning

  const slotActions = slotActionsRef.current;
  if (!slotActions || slotActions.size === 0) return null;

  return <>{Array.from(slotActions.values())}</>;
}
