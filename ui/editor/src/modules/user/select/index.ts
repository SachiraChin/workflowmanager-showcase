/**
 * user.select module exports.
 */

import { registerModule, type NodeDataFactoryParams } from "@/modules/registry";
import { UserSelectNode, type UserSelectNodeData } from "./UserSelectNode";
import type { UserSelectModule } from "./types";

// Register this module with the registry
registerModule("user.select", {
  nodeType: "userSelect",
  component: UserSelectNode,
  createNodeData: (params: NodeDataFactoryParams) =>
    ({
      module: params.module as UserSelectModule,
      onModuleChange: params.onModuleChange as (module: UserSelectModule) => void,
      expanded: params.expanded,
      onExpandedChange: params.onExpandedChange,
      onViewState: params.onViewState,
      onPreview: params.onPreview,
    }) satisfies UserSelectNodeData,
});

export * from "./types";
export * from "./presentation";
export { UserSelectNode, type UserSelectNodeData, MODULE_WIDTH } from "./UserSelectNode";
