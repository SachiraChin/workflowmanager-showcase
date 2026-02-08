import { createRoot } from "react-dom/client";
import { ClassicPreset, NodeEditor } from "rete";
import type { GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import {
  ConnectionPlugin,
  Presets as ConnectionPresets,
} from "rete-connection-plugin";
import {
  Presets as ReactPresets,
  ReactPlugin,
} from "rete-react-plugin";
import type { ReactArea2D } from "rete-react-plugin";

type FlowNode = ClassicPreset.Node;
type FlowConnection = ClassicPreset.Connection<FlowNode, FlowNode>;
type FlowSchemes = GetSchemes<FlowNode, FlowConnection>;
type FlowAreaExtra = ReactArea2D<FlowSchemes>;

const socket = new ClassicPreset.Socket("flow");

export type ReteInstance = {
  editor: NodeEditor<FlowSchemes>;
  area: AreaPlugin<FlowSchemes, FlowAreaExtra>;
  destroy: () => void;
};

export async function createReteInstance(
  container: HTMLElement
): Promise<ReteInstance> {
  const editor = new NodeEditor<FlowSchemes>();
  const area = new AreaPlugin<FlowSchemes, FlowAreaExtra>(container);
  const connection = new ConnectionPlugin<FlowSchemes, FlowAreaExtra>();
  const render = new ReactPlugin<FlowSchemes, FlowAreaExtra>({ createRoot });

  render.addPreset(ReactPresets.classic.setup());
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);

  return {
    editor,
    area,
    destroy: () => {
      area.destroy();
    },
  };
}

export async function addFlowNode(
  editor: NodeEditor<FlowSchemes>,
  area: AreaPlugin<FlowSchemes, FlowAreaExtra>,
  label: string,
  x: number,
  y: number
): Promise<FlowNode> {
  const node = new ClassicPreset.Node(label);
  node.addInput("in", new ClassicPreset.Input(socket, "In"));
  node.addOutput("out", new ClassicPreset.Output(socket, "Out"));

  await editor.addNode(node);
  await area.translate(node.id, { x, y });
  return node;
}

export async function connectNodes(
  editor: NodeEditor<FlowSchemes>,
  source: FlowNode,
  target: FlowNode
): Promise<void> {
  await editor.addConnection(new ClassicPreset.Connection(source, "out", target, "in"));
}

export async function zoomToNodes(
  area: AreaPlugin<FlowSchemes, FlowAreaExtra>,
  editor: NodeEditor<FlowSchemes>
): Promise<void> {
  await AreaExtensions.zoomAt(area, editor.getNodes());
}
