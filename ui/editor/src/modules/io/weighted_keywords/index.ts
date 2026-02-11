/**
 * io.weighted_keywords module exports.
 */

import { registerModule, type NodeDataFactoryParams } from "@/modules/registry";
import { WeightedKeywordsNode, type WeightedKeywordsNodeData } from "./WeightedKeywordsNode";
import type { WeightedKeywordsModule } from "./types";

// Register this module with the registry
registerModule("io.weighted_keywords", {
  nodeType: "weightedKeywords",
  component: WeightedKeywordsNode,
  createNodeData: (params: NodeDataFactoryParams) =>
    ({
      module: params.module as WeightedKeywordsModule,
      onModuleChange: params.onModuleChange as (module: WeightedKeywordsModule) => void,
      expanded: params.expanded,
      onExpandedChange: params.onExpandedChange,
      onViewState: params.onViewState,
    }) satisfies WeightedKeywordsNodeData,
});

export * from "./types";
export * from "./presentation";
export { WeightedKeywordsNode, type WeightedKeywordsNodeData } from "./WeightedKeywordsNode";
