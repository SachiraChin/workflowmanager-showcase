/**
 * Module Registry System
 *
 * Provides a centralized way to register module UI components.
 * Each module registers itself with its node component and data factory,
 * eliminating the need for manual if/else chains in the editor.
 *
 * Usage:
 *   1. Each module calls registerModule() in its index.ts
 *   2. WorkflowEditorPage uses getNodeTypes() and getModuleRegistration()
 *   3. Adding a new module requires no changes to the editor
 */

import type { ComponentType } from "react";
import type { NodeProps } from "@xyflow/react";
import type { InteractionRequest, WorkflowDefinition } from "@wfm/shared";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters passed to createNodeData factory.
 * These are the common props that all module nodes need.
 */
export type NodeDataFactoryParams = {
  /** The module configuration from workflow definition */
  module: unknown;
  /** Callback to update the module configuration */
  onModuleChange: (updated: unknown) => void;
  /** Whether this module node is expanded */
  expanded: boolean;
  /** Callback when expanded state changes (includes estimated height for layout) */
  onExpandedChange: (expanded: boolean, estimatedHeight: number) => void;
  /** Callback to view state up to this module */
  onViewState?: () => void;
  /** Callback to preview this module (optional, used by user.select) */
  onPreview?: () => void;
  /**
   * Callback to preview this module with a temporary draft override.
   * Used by module editors to preview unsaved schema/config changes.
   */
  onPreviewWithOverride?: (moduleOverride: unknown) => Promise<void>;
  /** Runtime-backed preview bindings for embedded editor previews. */
  runtimePreview?: {
    busy: boolean;
    error: string | null;
    mockMode: boolean;
    getPreviewRequest: () => InteractionRequest | null;
    getVirtualDb: () => string | null;
    getVirtualRunId: () => string | null;
    getWorkflow: () => WorkflowDefinition | null;
    onVirtualDbUpdate: (newVirtualDb: string) => void;
  };
  /** Callback to load preview data by running previous module (optional, used by media.generate) */
  onLoadPreviewData?: () => Promise<Record<string, unknown> | null>;
};

/**
 * Registration entry for a module type.
 */
export type ModuleRegistration = {
  /** The ReactFlow node type identifier (e.g., "llm", "userSelect") */
  nodeType: string;
  /** The React component to render for this module */
  component: ComponentType<NodeProps>;
  /**
   * Factory function to create node data from common parameters.
   * This allows each module to type-cast and structure its data correctly.
   * Returns Record<string, unknown> to satisfy ReactFlow's Node type.
   */
  createNodeData: (params: NodeDataFactoryParams) => Record<string, unknown>;
};

// =============================================================================
// Registry
// =============================================================================

const MODULE_REGISTRY: Record<string, ModuleRegistration> = {};

/**
 * Register a module type with its UI component.
 * Call this in each module's index.ts file.
 *
 * @param moduleId - The module_id from workflow definition (e.g., "api.llm")
 * @param registration - The module's component and data factory
 */
export function registerModule(
  moduleId: string,
  registration: ModuleRegistration
): void {
  if (MODULE_REGISTRY[moduleId]) {
    console.warn(`Module "${moduleId}" is already registered. Overwriting.`);
  }
  MODULE_REGISTRY[moduleId] = registration;
}

/**
 * Get the registration for a specific module type.
 * Returns undefined if the module is not registered.
 *
 * @param moduleId - The module_id to look up
 */
export function getModuleRegistration(
  moduleId: string
): ModuleRegistration | undefined {
  return MODULE_REGISTRY[moduleId];
}

/**
 * Check if a module type is registered (supported).
 *
 * @param moduleId - The module_id to check
 */
export function isModuleSupported(moduleId: string): boolean {
  return moduleId in MODULE_REGISTRY;
}

/**
 * Get all registered module IDs.
 */
export function getRegisteredModuleIds(): string[] {
  return Object.keys(MODULE_REGISTRY);
}

/**
 * Build the nodeTypes object for ReactFlow from the registry.
 * This should be called once and the result passed to ReactFlow.
 *
 * @param additionalTypes - Additional node types to include (e.g., workflow, step, placeholder)
 */
export function buildNodeTypes(
  additionalTypes: Record<string, ComponentType<NodeProps>> = {}
): Record<string, ComponentType<NodeProps>> {
  const types: Record<string, ComponentType<NodeProps>> = { ...additionalTypes };

  for (const registration of Object.values(MODULE_REGISTRY)) {
    types[registration.nodeType] = registration.component;
  }

  return types;
}
