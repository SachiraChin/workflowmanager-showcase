/**
 * transform.extract module exports.
 */

import { registerModule, type NodeDataFactoryParams } from "@/modules/registry";
import { ExtractNode, type ExtractNodeData } from "./ExtractNode";
import type { ExtractModule } from "./types";

// Register this module with the registry
registerModule("transform.extract", {
  nodeType: "extract",
  component: ExtractNode,
  createNodeData: (params: NodeDataFactoryParams) =>
    ({
      module: params.module as ExtractModule,
      onModuleChange: params.onModuleChange as (module: ExtractModule) => void,
      expanded: params.expanded,
      onExpandedChange: params.onExpandedChange,
      onViewState: params.onViewState,
    }) satisfies ExtractNodeData,
});

export * from "./types";
export * from "./presentation";
export { ExtractNode, type ExtractNodeData } from "./ExtractNode";
