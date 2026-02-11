/**
 * transform.query module exports.
 */

import { registerModule, type NodeDataFactoryParams } from "@/modules/registry";
import { QueryNode, type QueryNodeData } from "./QueryNode";
import type { QueryModule } from "./types";

// Register this module with the registry
registerModule("transform.query", {
  nodeType: "query",
  component: QueryNode,
  createNodeData: (params: NodeDataFactoryParams) =>
    ({
      module: params.module as QueryModule,
      onModuleChange: params.onModuleChange as (module: QueryModule) => void,
      expanded: params.expanded,
      onExpandedChange: params.onExpandedChange,
      onViewState: params.onViewState,
    }) satisfies QueryNodeData,
});

export * from "./types";
export * from "./presentation";
export { QueryNode, type QueryNodeData } from "./QueryNode";
