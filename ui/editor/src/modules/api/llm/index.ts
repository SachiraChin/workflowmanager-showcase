/**
 * api.llm module exports.
 */

import { registerModule, type NodeDataFactoryParams } from "@/modules/registry";
import { LLMNode, type LLMNodeData } from "./LLMNode";
import type { LLMModule } from "./types";

// Register this module with the registry
registerModule("api.llm", {
  nodeType: "llm",
  component: LLMNode,
  createNodeData: (params: NodeDataFactoryParams) =>
    ({
      module: params.module as LLMModule,
      onModuleChange: params.onModuleChange as (module: LLMModule) => void,
      expanded: params.expanded,
      onExpandedChange: params.onExpandedChange,
      onViewState: params.onViewState,
    }) satisfies LLMNodeData,
});

export * from "./types";
export { LLMNode, type LLMNodeData } from "./LLMNode";
