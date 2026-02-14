import { registerModule, type NodeDataFactoryParams } from "@/modules/registry";
import {
  MediaGenerateV2Node,
  type MediaGenerateV2NodeData,
} from "./MediaGenerateV2Node";
import type { MediaGenerateV2Module } from "./types";

registerModule("media.generateV2", {
  nodeType: "mediaGenerateV2",
  component: MediaGenerateV2Node,
  createNodeData: (params: NodeDataFactoryParams) =>
    ({
      module: params.module as MediaGenerateV2Module,
      onModuleChange: params.onModuleChange as (
        module: MediaGenerateV2Module
      ) => void,
      expanded: params.expanded,
      onExpandedChange: params.onExpandedChange,
      onViewState: params.onViewState,
      onPreview: params.onPreview,
    }) satisfies MediaGenerateV2NodeData,
});

export * from "./types";
export { MediaGenerateV2Node, type MediaGenerateV2NodeData } from "./MediaGenerateV2Node";
