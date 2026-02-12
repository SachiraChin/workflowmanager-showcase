/**
 * VirtualRuntime - Core runtime for virtual workflow execution.
 *
 * New simplified state model:
 * - Single virtualDb and state (not per-module checkpoints)
 * - Tracks furthestModuleIndex to know if target needs execution
 * - Hash workflow slice [0, furthestModuleIndex] for change detection
 * - Stores interaction history for rendering completed interactive modules
 *
 * Key behavior:
 * - Backward navigation (target ≤ furthestModuleIndex): NO API call, use cached data
 * - Forward navigation (target > furthestModuleIndex): Call /virtual/resume/confirm
 * - Workflow changed before target: Reset with /virtual/start (fresh)
 */

import type {
  WorkflowDefinition,
  InteractionResponseData,
  InteractionRequest,
} from "@wfm/shared";
import {
  virtualStart,
  virtualRespond,
  virtualResumeConfirm,
  virtualGetState,
  virtualGetInteractionHistory,
} from "./virtual-api";
import { buildAutoSelectionResponse } from "./auto-select";
import type {
  ModuleLocation,
  ModuleSelection,
  VirtualWorkflowResponse,
  VirtualStateResponse,
  CompletedInteraction,
  RuntimeStatus,
  RunResult,
} from "./types";

// =============================================================================
// Hashing Utilities
// =============================================================================

/**
 * Simple string hash function (djb2 algorithm).
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Compute hash of a value (JSON serialized).
 */
async function computeHash(value: unknown): Promise<string> {
  const json = JSON.stringify(value, null, 0);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(json);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fall through to simple hash
    }
  }

  return simpleHash(json);
}

// =============================================================================
// Module Ordering
// =============================================================================

/**
 * Get all modules in workflow order as flat list of locations.
 */
function getModuleOrder(workflow: WorkflowDefinition): ModuleLocation[] {
  const locations: ModuleLocation[] = [];
  for (const step of workflow.steps) {
    for (const module of step.modules) {
      locations.push({
        step_id: step.step_id,
        module_name: module.name ?? "",
      });
    }
  }
  return locations;
}

/**
 * Get index of a module in the workflow order.
 * Returns -1 if not found.
 */
function getModuleIndex(
  workflow: WorkflowDefinition,
  location: ModuleLocation
): number {
  const order = getModuleOrder(workflow);
  return order.findIndex(
    (loc) =>
      loc.step_id === location.step_id &&
      loc.module_name === location.module_name
  );
}

/**
 * Get a slice of workflow containing only modules [0, endIndex].
 * Used for hashing to detect changes in modules before a target.
 */
function getWorkflowSlice(
  workflow: WorkflowDefinition,
  endIndex: number
): unknown {
  const moduleOrder = getModuleOrder(workflow);
  const modulesInSlice = moduleOrder.slice(0, endIndex + 1);

  // Build a simplified structure for hashing
  const sliceData: Array<{ step_id: string; module: unknown }> = [];

  for (const loc of modulesInSlice) {
    const step = workflow.steps.find((s) => s.step_id === loc.step_id);
    const module = step?.modules.find((m) => m.name === loc.module_name);
    if (module) {
      sliceData.push({
        step_id: loc.step_id,
        module,
      });
    }
  }

  return sliceData;
}

// =============================================================================
// Session Storage for Selections
// =============================================================================

/**
 * Generate a unique session ID for storing selections.
 */
function generateSessionId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// =============================================================================
// VirtualRuntime Class
// =============================================================================

export class VirtualRuntime {
  // ---------------------------------------------------------------------------
  // Core State (replaces per-module checkpoints)
  // ---------------------------------------------------------------------------

  /** The virtual database blob (opaque, for sending to server) */
  private virtualDb: string | null = null;

  /** Virtual run ID */
  private virtualRunId: string | null = null;

  /** State from /virtual/state endpoint */
  private state: VirtualStateResponse | null = null;

  /** Interaction history from /virtual/interaction-history endpoint */
  private interactionHistory: Map<string, CompletedInteraction> = new Map();

  /** Pending interaction (if workflow is awaiting input) */
  private pendingInteraction: Record<string, unknown> | null = null;

  /** Furthest module index we've executed to (-1 means nothing executed) */
  private furthestModuleIndex: number = -1;

  /** Hashes of workflow slices for change detection. Key is module index. */
  private workflowSliceHashes: Map<number, string> = new Map();

  /** Session ID for storing selections in sessionStorage */
  private sessionId: string;

  // ---------------------------------------------------------------------------
  // UI State
  // ---------------------------------------------------------------------------

  /** Current runtime status */
  private status: RuntimeStatus = "idle";

  /** Last response from server (for UI to access) */
  private lastResponse: VirtualWorkflowResponse | null = null;

  /** Last error message */
  private lastError: string | null = null;

  /** Whether the preview panel is open */
  private panelOpen: boolean = false;

  /** Whether the state panel is open */
  private statePanelOpen: boolean = false;

  /** Callback when panel state changes (for React integration) */
  private onPanelChange: ((open: boolean) => void) | null = null;

  /** Callback when state panel state changes (for React integration) */
  private onStatePanelChange: ((open: boolean) => void) | null = null;

  /** Current target module (the module we're trying to reach) */
  private currentTarget: ModuleLocation | null = null;

  /**
   * Module to filter state display to (for module-specific State button).
   * When set, StatePanel should only show state available to this module.
   * When null, show all state.
   */
  private stateUpToModule: ModuleLocation | null = null;

  /**
   * Whether to use mock mode (default: true).
   * When true, modules return mock data instead of making real API calls.
   */
  private mockMode: boolean = true;

  /** Callback when mock mode changes (for React integration) */
  private onMockModeChange: ((mockMode: boolean) => void) | null = null;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor() {
    this.sessionId = generateSessionId();
  }

  // ===========================================================================
  // Public API - Getters
  // ===========================================================================

  getStatus(): RuntimeStatus {
    return this.status;
  }

  getLastResponse(): VirtualWorkflowResponse | null {
    return this.lastResponse;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getCurrentTarget(): ModuleLocation | null {
    return this.currentTarget;
  }

  getStateUpToModule(): ModuleLocation | null {
    return this.stateUpToModule;
  }

  getVirtualDb(): string | null {
    return this.virtualDb;
  }

  /**
   * Update the virtualDb state.
   * Called when a sub-action completes and returns updated state.
   */
  setVirtualDb(virtualDb: string): void {
    this.virtualDb = virtualDb;
  }

  getVirtualRunId(): string | null {
    return this.virtualRunId;
  }

  getState(): VirtualStateResponse | null {
    return this.state;
  }

  getMockMode(): boolean {
    return this.mockMode;
  }

  setMockMode(mockMode: boolean): void {
    if (this.mockMode !== mockMode) {
      this.mockMode = mockMode;
      this.onMockModeChange?.(mockMode);
    }
  }

  setOnMockModeChange(callback: ((mockMode: boolean) => void) | null): void {
    this.onMockModeChange = callback;
  }

  /**
   * Get interaction data for a specific module (for rendering preview).
   */
  getInteractionForModule(location: ModuleLocation): CompletedInteraction | null {
    const key = this.locationKey(location);
    return this.interactionHistory.get(key) ?? null;
  }

  /**
   * Get pending interaction if workflow is awaiting input.
   */
  getPendingInteraction(): Record<string, unknown> | null {
    return this.pendingInteraction;
  }

  /**
   * Check if we have state covering a given module.
   * Returns true if targetIndex ≤ furthestModuleIndex.
   */
  hasStateFor(workflow: WorkflowDefinition, target: ModuleLocation): boolean {
    const targetIndex = getModuleIndex(workflow, target);
    if (targetIndex === -1) return false;
    return targetIndex <= this.furthestModuleIndex;
  }

  // ===========================================================================
  // Panel Control
  // ===========================================================================

  isPanelOpen(): boolean {
    return this.panelOpen;
  }

  openPanel(): void {
    if (!this.panelOpen) {
      this.panelOpen = true;
      this.onPanelChange?.(true);
    }
  }

  closePanel(): void {
    if (this.panelOpen) {
      this.panelOpen = false;
      this.onPanelChange?.(false);
    }
  }

  setPanelOpen(open: boolean): void {
    if (this.panelOpen !== open) {
      this.panelOpen = open;
      this.onPanelChange?.(open);
    }
  }

  setOnPanelChange(callback: ((open: boolean) => void) | null): void {
    this.onPanelChange = callback;
  }

  isStatePanelOpen(): boolean {
    return this.statePanelOpen;
  }

  openStatePanel(): void {
    if (!this.statePanelOpen) {
      this.statePanelOpen = true;
      this.onStatePanelChange?.(true);
    }
  }

  openFullStatePanel(): void {
    this.stateUpToModule = null;
    this.openStatePanel();
  }

  closeStatePanel(): void {
    if (this.statePanelOpen) {
      this.statePanelOpen = false;
      this.onStatePanelChange?.(false);
    }
  }

  setStatePanelOpen(open: boolean): void {
    if (this.statePanelOpen !== open) {
      this.statePanelOpen = open;
      this.onStatePanelChange?.(open);
    }
  }

  setOnStatePanelChange(callback: ((open: boolean) => void) | null): void {
    this.onStatePanelChange = callback;
  }

  // ===========================================================================
  // Core Execution Methods
  // ===========================================================================

  /**
   * Run workflow to a target module.
   *
   * Logic:
   * 1. Check if workflow changed before target → reset if needed
   * 2. Check if target ≤ furthestModuleIndex → use cached data (no API call)
   * 3. Otherwise → execute forward to target
   */
  async runToModule(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    selections: ModuleSelection[],
    options?: { openPanel?: "preview" | "state" | "none" }
  ): Promise<RunResult> {
    const { openPanel = "preview" } = options ?? {};

    console.log("[VirtualRuntime] runToModule:", {
      target,
      furthestModuleIndex: this.furthestModuleIndex,
      openPanel,
    });

    this.status = "running";
    this.lastError = null;
    this.currentTarget = target;

    if (openPanel === "state") {
      this.stateUpToModule = target;
    }

    if (openPanel === "preview") {
      this.openPanel();
    } else if (openPanel === "state") {
      this.openStatePanel();
    }

    try {
      const targetIndex = getModuleIndex(workflow, target);
      if (targetIndex === -1) {
        throw new Error(`Module not found: ${target.step_id}/${target.module_name}`);
      }

      // Check if we need to reset (workflow changed before target)
      const needsReset = await this.checkNeedsReset(workflow, targetIndex);

      if (needsReset) {
        console.log("[VirtualRuntime] Workflow changed, resetting...");
        await this.resetAndStart(workflow, target, selections);
      } else if (targetIndex <= this.furthestModuleIndex) {
        // Already have state for this target - no API call needed
        console.log("[VirtualRuntime] Already have state, using cache");
        this.status = "completed";
        return { status: "completed", response: this.lastResponse ?? undefined };
      } else {
        // Need to execute forward
        console.log("[VirtualRuntime] Executing forward to target...");
        await this.executeForward(workflow, target, selections);
      }

      // Fetch state and interaction history after execution
      await this.fetchStateAndHistory();

      // Update furthest position and store hash
      const newFurthestIndex = Math.max(this.furthestModuleIndex, targetIndex);
      if (newFurthestIndex > this.furthestModuleIndex) {
        this.furthestModuleIndex = newFurthestIndex;
      }
      // Store hash for this target index
      const targetHash = await computeHash(
        getWorkflowSlice(workflow, targetIndex)
      );
      this.workflowSliceHashes.set(targetIndex, targetHash);

      return { status: this.status, response: this.lastResponse ?? undefined };
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      return { status: "error", error: this.lastError };
    }
  }

  /**
   * Run workflow to a target module for state inspection only.
   * Opens the state panel instead of the preview panel.
   */
  async runToModuleForState(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    selections: ModuleSelection[]
  ): Promise<RunResult> {
    console.log("[VirtualRuntime] runToModuleForState:", target);

    this.stateUpToModule = target;

    // Check if we already have state covering this module
    if (this.hasStateFor(workflow, target) && this.state) {
      console.log("[VirtualRuntime] Already have state, opening panel");
      this.openStatePanel();
      return {
        status: this.status === "idle" ? "completed" : this.status,
        response: this.lastResponse ?? undefined,
      };
    }

    return this.runToModule(workflow, target, selections, {
      openPanel: "state",
    });
  }

  /**
   * Submit a response to the current interaction.
   */
  async submitResponse(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    response: InteractionResponseData
  ): Promise<RunResult> {
    if (this.status !== "awaiting_input" || !this.lastResponse) {
      return {
        status: "error",
        error: "No pending interaction to respond to",
      };
    }

    if (!this.virtualDb || !this.virtualRunId) {
      return {
        status: "error",
        error: "No virtual database state",
      };
    }

    this.status = "running";
    this.openPanel();

    try {
      const serverResponse = await virtualRespond({
        workflow,
        virtual_db: this.virtualDb,
        virtual_run_id: this.virtualRunId,
        target_step_id: target.step_id,
        target_module_name: target.module_name,
        interaction_id: this.lastResponse.interaction_request!.interaction_id,
        response,
        mock: this.mockMode,
      });

      this.lastResponse = serverResponse;
      this.virtualDb = serverResponse.virtual_db;

      if (serverResponse.status === "error") {
        this.status = "error";
        this.lastError = serverResponse.error ?? "Unknown error";
        return { status: "error", error: this.lastError };
      }

      if (
        serverResponse.status === "completed" ||
        serverResponse.status === "target_reached"
      ) {
        this.status = "completed";
        await this.fetchStateAndHistory();
        
        // Update furthest position and store hash
        const targetIndex = getModuleIndex(workflow, target);
        if (targetIndex > this.furthestModuleIndex) {
          this.furthestModuleIndex = targetIndex;
        }
        const targetHash = await computeHash(
          getWorkflowSlice(workflow, targetIndex)
        );
        this.workflowSliceHashes.set(targetIndex, targetHash);
        
        return { status: "completed", response: serverResponse };
      }

      if (serverResponse.status === "awaiting_input") {
        this.status = "awaiting_input";
        return { status: "awaiting_input", response: serverResponse };
      }

      this.status = "error";
      this.lastError = `Unexpected status: ${serverResponse.status}`;
      return { status: "error", error: this.lastError };
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      return { status: "error", error: this.lastError };
    }
  }

  /**
   * Reset the runtime, clearing all state.
   */
  reset(closePanels: boolean = false): void {
    this.virtualDb = null;
    this.virtualRunId = null;
    this.state = null;
    this.interactionHistory.clear();
    this.pendingInteraction = null;
    this.furthestModuleIndex = -1;
    this.workflowSliceHashes.clear();
    this.status = "idle";
    this.lastResponse = null;
    this.lastError = null;
    this.currentTarget = null;
    this.stateUpToModule = null;

    if (closePanels) {
      this.closePanel();
      this.closeStatePanel();
    }
  }

  /**
   * Reload the current target with a different mock mode.
   * Resets state and re-runs to the current target.
   * @returns Promise that resolves when reload is complete
   */
  async reloadWithMockMode(
    workflow: WorkflowDefinition,
    mockMode: boolean,
    selections: ModuleSelection[]
  ): Promise<RunResult> {
    const target = this.currentTarget;
    if (!target) {
      return { status: "error", error: "No current target to reload" };
    }

    // Update mock mode
    this.setMockMode(mockMode);

    // Reset state but keep panels open
    this.virtualDb = null;
    this.virtualRunId = null;
    this.state = null;
    this.interactionHistory.clear();
    this.pendingInteraction = null;
    this.furthestModuleIndex = -1;
    this.workflowSliceHashes.clear();
    this.lastResponse = null;
    this.lastError = null;

    // Re-run to target
    return this.runToModule(workflow, target, selections, { openPanel: "preview" });
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  private locationKey(location: ModuleLocation | ModuleSelection): string {
    return `${location.step_id}/${location.module_name}`;
  }

  /**
   * Check if workflow has changed before the target, requiring a reset.
   */
  private async checkNeedsReset(
    workflow: WorkflowDefinition,
    targetIndex: number
  ): Promise<boolean> {
    // If we haven't executed anything yet, no reset needed (will do fresh start)
    if (this.furthestModuleIndex < 0) {
      return false;
    }

    // If target is within what we've already executed, check if that slice changed
    const checkUpToIndex = Math.min(targetIndex, this.furthestModuleIndex);
    
    // Find the stored hash for the checkUpToIndex or the closest index we have
    const storedHash = this.workflowSliceHashes.get(checkUpToIndex);
    
    if (!storedHash) {
      // We don't have a hash for this exact index, compute the current hash
      // and compare against what we'd expect based on stored hashes
      // If we have a hash for a larger index, we need to compute fresh
      const currentSliceHash = await computeHash(
        getWorkflowSlice(workflow, checkUpToIndex)
      );
      
      // Store it for future comparisons
      this.workflowSliceHashes.set(checkUpToIndex, currentSliceHash);
      
      // No stored hash means this is a new target in an already-executed range
      // We trust the current workflow state since no previous hash to compare
      return false;
    }
    
    const currentSliceHash = await computeHash(
      getWorkflowSlice(workflow, checkUpToIndex)
    );

    // If slice hash changed, we need to reset
    if (currentSliceHash !== storedHash) {
      console.log("[VirtualRuntime] Workflow slice changed:", {
        checkUpToIndex,
        oldHash: storedHash.substring(0, 8),
        newHash: currentSliceHash.substring(0, 8),
      });
      return true;
    }

    return false;
  }

  /**
   * Reset and start fresh.
   */
  private async resetAndStart(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    selections: ModuleSelection[]
  ): Promise<void> {
    // Clear previous state
    this.virtualDb = null;
    this.virtualRunId = null;
    this.state = null;
    this.interactionHistory.clear();
    this.pendingInteraction = null;
    this.furthestModuleIndex = -1;
    this.workflowSliceHashes.clear();

    // Start fresh
    const response = await virtualStart({
      workflow,
      virtual_db: null,
      target_step_id: target.step_id,
      target_module_name: target.module_name,
      mock: this.mockMode,
    });

    console.log("[VirtualRuntime] resetAndStart - received response", {
      status: response.status,
      hasVirtualDb: !!response.virtual_db,
      virtualDbLength: response.virtual_db?.length,
      virtualRunId: response.virtual_run_id,
    });

    this.lastResponse = response;
    this.virtualDb = response.virtual_db;
    this.virtualRunId = response.virtual_run_id;

    // Handle response
    await this.processExecutionResponse(workflow, target, response, selections);
  }

  /**
   * Execute forward from current position to target.
   */
  private async executeForward(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    selections: ModuleSelection[]
  ): Promise<void> {
    if (!this.virtualDb) {
      // No existing state, do fresh start
      return this.resetAndStart(workflow, target, selections);
    }

    const requestPayload = {
      workflow,
      virtual_db: this.virtualDb,
      target_step_id: target.step_id,
      target_module_name: target.module_name,
      mock: this.mockMode,
    };
    
    console.log("[VirtualRuntime] executeForward - calling /resume/confirm", {
      hasVirtualDb: !!this.virtualDb,
      virtualDbLength: this.virtualDb?.length,
      virtualRunId: this.virtualRunId,
      target,
      payloadKeys: Object.keys(requestPayload),
      workflowId: workflow.workflow_id,
    });

    const response = await virtualResumeConfirm(requestPayload);

    this.lastResponse = response;
    this.virtualDb = response.virtual_db;
    this.virtualRunId = response.virtual_run_id;

    await this.processExecutionResponse(workflow, target, response, selections);
  }

  /**
   * Process execution response, handling auto-selection for prerequisite modules.
   */
  private async processExecutionResponse(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    response: VirtualWorkflowResponse,
    selections: ModuleSelection[]
  ): Promise<void> {
    // Build selection map
    const selectionMap = new Map<string, InteractionResponseData>();
    for (const sel of selections) {
      selectionMap.set(this.locationKey(sel), sel.response);
    }

    let currentResponse = response;

    while (true) {
      if (currentResponse.status === "error") {
        this.status = "error";
        this.lastError = currentResponse.error ?? "Unknown error";
        this.lastResponse = currentResponse;
        return;
      }

      if (
        currentResponse.status === "completed" ||
        currentResponse.status === "target_reached"
      ) {
        this.status = "completed";
        this.lastResponse = currentResponse;
        return;
      }

      if (currentResponse.status === "awaiting_input") {
        const interactionModule = this.getInteractionModule(currentResponse);

        if (!interactionModule) {
          this.status = "awaiting_input";
          this.lastResponse = currentResponse;
          return;
        }

        const isTarget =
          interactionModule.step_id === target.step_id &&
          interactionModule.module_name === target.module_name;

        if (isTarget) {
          // Target module needs input - return to user
          this.status = "awaiting_input";
          this.lastResponse = currentResponse;
          return;
        }

        // Prerequisite module - try to auto-select
        const selectionKey = this.locationKey(interactionModule);
        let selection = selectionMap.get(selectionKey);

        if (!selection) {
          // Try persisted selection
          selection = this.getPersistedSelection(interactionModule);
        }

        if (!selection) {
          // Try auto-select
          const interactionRequest =
            currentResponse.interaction_request as InteractionRequest | undefined;
          if (interactionRequest) {
            selection = buildAutoSelectionResponse(interactionRequest) ?? undefined;
            if (selection) {
              // Persist for future use
              this.persistSelection(interactionModule, selection);
            }
          }
        }

        if (!selection) {
          // Can't auto-select - return to user
          console.log(
            "[VirtualRuntime] Cannot auto-select, returning awaiting_input"
          );
          this.status = "awaiting_input";
          this.lastResponse = currentResponse;
          return;
        }

        // Auto-respond
        console.log("[VirtualRuntime] Auto-responding for prerequisite:", {
          module: interactionModule,
        });

        currentResponse = await virtualRespond({
          workflow,
          virtual_db: currentResponse.virtual_db!,
          virtual_run_id: currentResponse.virtual_run_id,
          target_step_id: target.step_id,
          target_module_name: target.module_name,
          interaction_id: currentResponse.interaction_request!.interaction_id,
          response: selection,
          mock: this.mockMode,
        });

        this.lastResponse = currentResponse;
        this.virtualDb = currentResponse.virtual_db;
      } else {
        // Unexpected status
        this.status = "error";
        this.lastError = `Unexpected status: ${currentResponse.status}`;
        this.lastResponse = currentResponse;
        return;
      }
    }
  }

  /**
   * Fetch state and interaction history from server.
   */
  private async fetchStateAndHistory(): Promise<void> {
    if (!this.virtualDb || !this.virtualRunId) {
      return;
    }

    try {
      // Fetch both in parallel
      const [stateResponse, historyResponse] = await Promise.all([
        virtualGetState({
          virtual_db: this.virtualDb,
          virtual_run_id: this.virtualRunId,
        }),
        virtualGetInteractionHistory({
          virtual_db: this.virtualDb,
          virtual_run_id: this.virtualRunId,
        }),
      ]);

      this.state = stateResponse;

      // Update interaction history map
      this.interactionHistory.clear();
      for (const interaction of historyResponse.interactions) {
        if (interaction.step_id && interaction.module_name) {
          const key = `${interaction.step_id}/${interaction.module_name}`;
          this.interactionHistory.set(key, interaction);
        }
      }

      this.pendingInteraction = historyResponse.pending_interaction;

      console.log("[VirtualRuntime] Fetched state and history:", {
        stateKeys: Object.keys(stateResponse.state_mapped || {}),
        interactionCount: historyResponse.interactions.length,
        hasPending: !!historyResponse.pending_interaction,
      });
    } catch (error) {
      console.error("[VirtualRuntime] Failed to fetch state/history:", error);
    }
  }

  /**
   * Extract the module location from an interaction response.
   */
  private getInteractionModule(
    response: VirtualWorkflowResponse
  ): ModuleLocation | null {
    if (response.progress?.current_step && response.progress?.current_module) {
      return {
        step_id: response.progress.current_step,
        module_name: response.progress.current_module,
      };
    }
    return null;
  }

  // ===========================================================================
  // Selection Persistence (Session Storage)
  // ===========================================================================

  private getStorageKey(): string {
    return `wfm_editor_selections_${this.sessionId}`;
  }

  private getPersistedSelections(): Record<string, InteractionResponseData> {
    try {
      const stored = sessionStorage.getItem(this.getStorageKey());
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  private persistSelection(
    location: ModuleLocation,
    response: InteractionResponseData
  ): void {
    try {
      const selections = this.getPersistedSelections();
      selections[this.locationKey(location)] = response;
      sessionStorage.setItem(this.getStorageKey(), JSON.stringify(selections));
    } catch (error) {
      console.warn("[VirtualRuntime] Failed to persist selection:", error);
    }
  }

  private getPersistedSelection(
    location: ModuleLocation
  ): InteractionResponseData | undefined {
    const selections = this.getPersistedSelections();
    return selections[this.locationKey(location)];
  }
}
