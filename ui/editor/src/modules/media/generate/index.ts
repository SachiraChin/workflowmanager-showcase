/**
 * media.generate module exports.
 */

import { registerModule, type NodeDataFactoryParams } from "@/modules/registry";
import { MediaGenerateNode, type MediaGenerateNodeData } from "./MediaGenerateNode";
import type { MediaGenerateModule } from "./types";

// Register this module with the registry
registerModule("media.generate", {
  nodeType: "mediaGenerate",
  component: MediaGenerateNode,
  createNodeData: (params: NodeDataFactoryParams) =>
    ({
      module: params.module as MediaGenerateModule,
      onModuleChange: params.onModuleChange as (module: MediaGenerateModule) => void,
      expanded: params.expanded,
      onExpandedChange: params.onExpandedChange,
      onViewState: params.onViewState,
      onPreview: params.onPreview,
      onLoadPreviewData: params.onLoadPreviewData,
    }) satisfies MediaGenerateNodeData,
});

export * from "./types";
export * from "./presentation";
export { MediaGenerateNode, type MediaGenerateNodeData } from "./MediaGenerateNode";
