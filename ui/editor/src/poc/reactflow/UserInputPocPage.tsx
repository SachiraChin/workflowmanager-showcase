import { memo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type UserSelectNodeData = {
  name: string;
  prompt: string;
  mode: string;
  options: number;
  outputKeys: string[];
};

const USER_INPUT_MODULES: UserSelectNodeData[] = [
  {
    name: "select_pet_type",
    prompt: "What type of pet is this video for?",
    mode: "select",
    options: 3,
    outputKeys: ["pet_type_indices", "pet_type_selection"],
  },
  {
    name: "select_aesthetic",
    prompt: "Choose the story aesthetic for your video",
    mode: "select",
    options: 11,
    outputKeys: ["aesthetic_indices", "aesthetic_selection"],
  },
];

const nodes: Node<UserSelectNodeData>[] = [
  {
    id: "select_pet_type",
    type: "userSelect",
    position: { x: 120, y: 180 },
    data: USER_INPUT_MODULES[0],
  },
  {
    id: "select_aesthetic",
    type: "userSelect",
    position: { x: 520, y: 180 },
    data: USER_INPUT_MODULES[1],
  },
];

const edges: Edge[] = [
  {
    id: "e-select-flow",
    source: "select_pet_type",
    target: "select_aesthetic",
    label: "state-driven sequencing",
  },
];

const UserSelectNode = memo(({ data }: NodeProps<Node<UserSelectNodeData>>) => {
  return (
    <article className="w-[320px] rounded-lg border bg-card p-4 shadow-sm">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
        user.select
      </p>
      <h3 className="text-base font-semibold">{data.name}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{data.prompt}</p>
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">mode</dt>
          <dd>{data.mode}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">options</dt>
          <dd>{data.options}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        outputs: {data.outputKeys.join(", ")}
      </p>
    </article>
  );
});

const nodeTypes = {
  userSelect: UserSelectNode,
};

export function ReactFlowUserInputPocPage() {
  return (
    <div className="h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">React Flow User Input PoC</h1>
          <p className="text-xs text-muted-foreground">
            Based on `workflows/cc/steps/1_user_input` (two-module rendering).
          </p>
        </div>
        <a className="text-sm underline" href="/">
          Back
        </a>
      </header>
      <div className="h-[calc(100vh-53px)]">
        <ReactFlow fitView nodes={nodes} edges={edges} nodeTypes={nodeTypes}>
          <Background gap={20} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
