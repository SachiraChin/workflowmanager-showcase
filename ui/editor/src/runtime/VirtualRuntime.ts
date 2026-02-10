/**
 * VirtualRuntime - Core runtime for virtual workflow execution.
 *
 * Manages:
 * - Per-module checkpoint caching (virtual_db snapshots)
 * - Hash-based invalidation (workflow and module config changes)
 * - Execution flow from checkpoints to target modules
 *
 * Key concepts:
 * - Checkpoint: Saved virtual_db state after a module completes successfully
 * - When a module or any preceding module changes, its checkpoint is invalidated
 * - Runtime finds the latest valid checkpoint before target and resumes from there
 */

import type { WorkflowDefinition, InteractionResponseData, InteractionRequest } from "@wfm/shared";
import { virtualStart, virtualRespond } from "./virtual-api";
import { buildAutoSelectionResponse } from "./auto-select";
import type {
  ModuleLocation,
  ModuleCheckpoint,
  ModuleSelection,
  VirtualWorkflowResponse,
  RuntimeStatus,
  RunResult,
} from "./types";

// =============================================================================
// Hashing Utilities
// =============================================================================

/**
 * Simple string hash function (djb2 algorithm).
 * Fallback when crypto.subtle is not available.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit integer and then to hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Compute hash of a value (JSON serialized).
 * Uses crypto.subtle if available, falls back to simple hash.
 */
async function computeHash(value: unknown): Promise<string> {
  const json = JSON.stringify(value, Object.keys(value as object).sort());

  // Try crypto.subtle first (available in secure contexts)
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

  // Fallback to simple hash
  return simpleHash(json);
}

/**
 * Compute hash for a workflow (excluding runtime-variable parts).
 */
async function hashWorkflow(workflow: WorkflowDefinition): Promise<string> {
  return computeHash(workflow);
}

/**
 * Compute hash for a specific module's configuration.
 */
async function hashModule(
  workflow: WorkflowDefinition,
  location: ModuleLocation
): Promise<string> {
  const step = workflow.steps.find((s) => s.step_id === location.step_id);
  if (!step) return "";
  const module = step.modules.find((m) => m.name === location.module_name);
  if (!module) return "";
  return computeHash(module);
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

// Note: isBefore can be used for future optimizations
// function isBefore(
//   workflow: WorkflowDefinition,
//   a: ModuleLocation,
//   b: ModuleLocation
// ): boolean {
//   return getModuleIndex(workflow, a) < getModuleIndex(workflow, b);
// }

// =============================================================================
// VirtualRuntime Class
// =============================================================================

export class VirtualRuntime {
  /** Per-module checkpoints, keyed by "step_id/module_name" */
  private checkpoints: Map<string, ModuleCheckpoint> = new Map();

  /** Per-module hashes for change detection, keyed by "step_id/module_name" */
  private moduleHashes: Map<string, string> = new Map();

  /** Hash of the full workflow for change detection */
  private workflowHash: string = "";

  /** Current runtime status */
  private status: RuntimeStatus = "idle";

  /** Last response from server (for UI to access) */
  private lastResponse: VirtualWorkflowResponse | null = null;

  /** Last error message */
  private lastError: string | null = null;

  /** Whether the runtime panel is open */
  private panelOpen: boolean = false;

  /** Callback when panel state changes (for React integration) */
  private onPanelChange: ((open: boolean) => void) | null = null;

  /** Current target module (the module we're trying to reach) */
  private currentTarget: ModuleLocation | null = null;

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get current runtime status.
   */
  getStatus(): RuntimeStatus {
    return this.status;
  }

  /**
   * Get last response from server.
   */
  getLastResponse(): VirtualWorkflowResponse | null {
    return this.lastResponse;
  }

  /**
   * Get last error message.
   */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Get checkpoint for a module if it exists and is valid.
   */
  getCheckpoint(location: ModuleLocation): ModuleCheckpoint | null {
    const key = this.locationKey(location);
    return this.checkpoints.get(key) ?? null;
  }

  /**
   * Get the current target module (the module we're trying to reach).
   * This is set when runToModule is called and persists through interactions.
   */
  getCurrentTarget(): ModuleLocation | null {
    return this.currentTarget;
  }

  // ===========================================================================
  // Panel Control
  // ===========================================================================

  /**
   * Check if the panel is currently open.
   */
  isPanelOpen(): boolean {
    return this.panelOpen;
  }

  /**
   * Open the runtime panel.
   */
  openPanel(): void {
    if (!this.panelOpen) {
      this.panelOpen = true;
      this.onPanelChange?.(true);
    }
  }

  /**
   * Close the runtime panel.
   */
  closePanel(): void {
    if (this.panelOpen) {
      this.panelOpen = false;
      this.onPanelChange?.(false);
    }
  }

  /**
   * Set the panel open state directly (for controlled usage).
   */
  setPanelOpen(open: boolean): void {
    if (this.panelOpen !== open) {
      this.panelOpen = open;
      this.onPanelChange?.(open);
    }
  }

  /**
   * Register a callback to be notified when panel state changes.
   * Used by React hook to sync state.
   */
  setOnPanelChange(callback: ((open: boolean) => void) | null): void {
    this.onPanelChange = callback;
  }

  /**
   * Run workflow to a target module.
   *
   * @param workflow - The full workflow definition
   * @param target - The module to run to
   * @param selections - Pre-defined selections for prerequisite interactive modules
   * @returns RunResult with status and optional response/error
   */
  async runToModule(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    selections: ModuleSelection[]
  ): Promise<RunResult> {
    this.status = "running";
    this.lastError = null;
    this.currentTarget = target;

    // Auto-open panel when execution starts
    this.openPanel();

    try {
      // Update hashes and invalidate stale checkpoints
      await this.updateHashes(workflow);

      // Find the best checkpoint to resume from
      const checkpoint = this.findBestCheckpoint(workflow, target);

      // Build selection map for quick lookup
      const selectionMap = new Map<string, InteractionResponseData>();
      for (const sel of selections) {
        selectionMap.set(this.locationKey(sel), sel.response);
      }

      // Execute from checkpoint (or start) to target
      const result = await this.executeToTarget(
        workflow,
        target,
        checkpoint,
        selectionMap
      );

      return result;
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        status: "error",
        error: this.lastError,
      };
    }
  }

  /**
   * Submit a response to the current interaction.
   *
   * Call this after runToModule returns status "awaiting_input".
   *
   * @param workflow - The full workflow definition
   * @param target - The target module (same as in runToModule)
   * @param response - User's response to the interaction
   * @returns RunResult with updated status
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

    this.status = "running";

    // Ensure panel stays open during response
    this.openPanel();

    try {
      const serverResponse = await virtualRespond({
        workflow,
        virtual_db: this.lastResponse.virtual_db!,
        virtual_run_id: this.lastResponse.virtual_run_id,
        target_step_id: target.step_id,
        target_module_name: target.module_name,
        interaction_id: this.lastResponse.interaction_request!.interaction_id,
        response,
      });

      return this.handleServerResponse(workflow, target, serverResponse);
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        status: "error",
        error: this.lastError,
      };
    }
  }

  /**
   * Reset the runtime, clearing all checkpoints and state.
   * Optionally close the panel.
   */
  reset(closePanel: boolean = false): void {
    this.checkpoints.clear();
    this.moduleHashes.clear();
    this.workflowHash = "";
    this.status = "idle";
    this.lastResponse = null;
    this.lastError = null;
    this.currentTarget = null;
    if (closePanel) {
      this.closePanel();
    }
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  private locationKey(location: ModuleLocation | ModuleSelection): string {
    return `${location.step_id}/${location.module_name}`;
  }

  /**
   * Update workflow and module hashes, invalidating stale checkpoints.
   */
  private async updateHashes(workflow: WorkflowDefinition): Promise<void> {
    const newWorkflowHash = await hashWorkflow(workflow);

    // If workflow hash changed, we need to check each module
    if (newWorkflowHash !== this.workflowHash) {
      this.workflowHash = newWorkflowHash;

      const moduleOrder = getModuleOrder(workflow);
      let invalidateRemaining = false;

      for (const location of moduleOrder) {
        const key = this.locationKey(location);
        const newModuleHash = await hashModule(workflow, location);
        const oldModuleHash = this.moduleHashes.get(key);

        // If this module changed, invalidate it and all subsequent modules
        if (newModuleHash !== oldModuleHash || invalidateRemaining) {
          this.checkpoints.delete(key);
          invalidateRemaining = true;
        }

        this.moduleHashes.set(key, newModuleHash);
      }
    }
  }

  /**
   * Find the best (most recent) valid checkpoint before the target module.
   */
  private findBestCheckpoint(
    workflow: WorkflowDefinition,
    target: ModuleLocation
  ): ModuleCheckpoint | null {
    const moduleOrder = getModuleOrder(workflow);
    const targetIndex = getModuleIndex(workflow, target);

    // Search backwards from target-1 to find a valid checkpoint
    for (let i = targetIndex - 1; i >= 0; i--) {
      const location = moduleOrder[i];
      const key = this.locationKey(location);
      const checkpoint = this.checkpoints.get(key);

      if (checkpoint && checkpoint.workflow_hash === this.workflowHash) {
        return checkpoint;
      }
    }

    return null;
  }

  /**
   * Execute from a checkpoint (or start) to the target module.
   */
  private async executeToTarget(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    checkpoint: ModuleCheckpoint | null,
    selectionMap: Map<string, InteractionResponseData>
  ): Promise<RunResult> {
    // Start execution from checkpoint or fresh
    let serverResponse = await virtualStart({
      workflow,
      virtual_db: checkpoint?.virtual_db ?? null,
      target_step_id: target.step_id,
      target_module_name: target.module_name,
    });

    // Process response and potentially auto-respond to prerequisite interactions
    return this.processExecutionLoop(
      workflow,
      target,
      serverResponse,
      selectionMap
    );
  }

  /**
   * Process server response, auto-responding to prerequisite modules.
   */
  private async processExecutionLoop(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    serverResponse: VirtualWorkflowResponse,
    selectionMap: Map<string, InteractionResponseData>
  ): Promise<RunResult> {
    let response = serverResponse;

    while (true) {
      // Check response status
      if (response.status === "error") {
        this.status = "error";
        this.lastError = response.error ?? "Unknown error";
        this.lastResponse = response;
        return { status: "error", error: this.lastError };
      }

      if (response.status === "completed" || response.status === "target_reached") {
        // Module completed - save checkpoint
        this.saveCheckpoint(workflow, target, response);
        this.status = "completed";
        this.lastResponse = response;
        return { status: "completed", response };
      }

      if (response.status === "awaiting_input") {
        // Check if this is the target module or a prerequisite
        const interactionModule = this.getInteractionModule(response);
        
        if (!interactionModule) {
          // Can't determine module - return to user
          this.status = "awaiting_input";
          this.lastResponse = response;
          return { status: "awaiting_input", response };
        }

        const isTarget =
          interactionModule.step_id === target.step_id &&
          interactionModule.module_name === target.module_name;

        if (isTarget) {
          // Target module needs input - return to user
          this.status = "awaiting_input";
          this.lastResponse = response;
          return { status: "awaiting_input", response };
        }

        // Prerequisite module - check if we have a selection for it
        const selectionKey = this.locationKey(interactionModule);
        let selection = selectionMap.get(selectionKey);

        if (!selection) {
          // No user-provided selection - try to auto-select
          const interactionRequest = response.interaction_request as InteractionRequest | undefined;
          if (interactionRequest) {
            selection = buildAutoSelectionResponse(interactionRequest) ?? undefined;
          }
        }

        if (!selection) {
          // Can't auto-select (no selectable items) - return to user for input
          this.status = "awaiting_input";
          this.lastResponse = response;
          return { status: "awaiting_input", response };
        }

        // Auto-respond with provided or auto-generated selection
        response = await virtualRespond({
          workflow,
          virtual_db: response.virtual_db!,
          virtual_run_id: response.virtual_run_id,
          target_step_id: target.step_id,
          target_module_name: target.module_name,
          interaction_id: response.interaction_request!.interaction_id,
          response: selection,
        });

        // Save checkpoint for this prerequisite module
        if (response.status !== "error") {
          this.saveCheckpoint(workflow, interactionModule, response);
        }
      } else {
        // Unexpected status
        this.status = "error";
        this.lastError = `Unexpected status: ${response.status}`;
        this.lastResponse = response;
        return { status: "error", error: this.lastError };
      }
    }
  }

  /**
   * Handle server response and update state.
   */
  private handleServerResponse(
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    response: VirtualWorkflowResponse
  ): RunResult {
    this.lastResponse = response;

    if (response.status === "error") {
      this.status = "error";
      this.lastError = response.error ?? "Unknown error";
      return { status: "error", error: this.lastError };
    }

    if (response.status === "completed" || response.status === "target_reached") {
      this.saveCheckpoint(workflow, target, response);
      this.status = "completed";
      return { status: "completed", response };
    }

    if (response.status === "awaiting_input") {
      this.status = "awaiting_input";
      return { status: "awaiting_input", response };
    }

    this.status = "error";
    this.lastError = `Unexpected status: ${response.status}`;
    return { status: "error", error: this.lastError };
  }

  /**
   * Save a checkpoint for a module.
   */
  private saveCheckpoint(
    _workflow: WorkflowDefinition,
    location: ModuleLocation,
    response: VirtualWorkflowResponse
  ): void {
    if (!response.virtual_db || !response.state) {
      return;
    }

    const key = this.locationKey(location);
    const moduleHash = this.moduleHashes.get(key) ?? "";

    this.checkpoints.set(key, {
      location,
      workflow_hash: this.workflowHash,
      module_hash: moduleHash,
      virtual_db: response.virtual_db,
      virtual_run_id: response.virtual_run_id,
      state: response.state,
    });
  }

  /**
   * Extract the module location from an interaction response.
   */
  private getInteractionModule(
    response: VirtualWorkflowResponse
  ): ModuleLocation | null {
    // Try to get from progress
    if (response.progress?.current_step && response.progress?.current_module) {
      return {
        step_id: response.progress.current_step,
        module_name: response.progress.current_module,
      };
    }
    return null;
  }
}
