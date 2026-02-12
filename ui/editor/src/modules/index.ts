/**
 * Module System Entry Point
 *
 * This file imports all modules to trigger their registration with the registry.
 * Import this file once in the application to ensure all modules are available.
 *
 * To add a new module:
 * 1. Create the module folder under /modules/{namespace}/{name}/
 * 2. Add registerModule() call in the module's index.ts
 * 3. Add import here
 */

// Import all modules to trigger registration
import "./user/select";
import "./api/llm";
import "./transform/query";
import "./transform/extract";
import "./media/generate";
import "./io/weighted_keywords";

// Re-export registry utilities for convenience
export {
  registerModule,
  getModuleRegistration,
  isModuleSupported,
  getRegisteredModuleIds,
  buildNodeTypes,
  type ModuleRegistration,
  type NodeDataFactoryParams,
} from "./registry";
