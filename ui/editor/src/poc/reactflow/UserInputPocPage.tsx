import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type ModuleSpec = {
  module_id: string;
  name: string;
  inputs: JsonValue;
  outputs_to_state: JsonValue;
};

const STEP_SPEC: {
  step_id: string;
  name: string;
  description: string;
  modules: ModuleSpec[];
} = {
  step_id: "user_input",
  name: "Step {step_number}: Choose Your Pet Story",
  description: "Select pet type and story aesthetic",
  modules: [
    {
      module_id: "user.select",
      name: "select_pet_type",
      inputs: {
        resolver_schema: {
          type: "object",
          properties: {
            data: { resolver: "server" },
          },
        },
        prompt: "What type of pet is this video for?",
        data: [
          {
            id: "cat",
            label: "Cat",
            description:
              "Feline friends - independent, curious, and endlessly entertaining",
          },
          {
            id: "dog",
            label: "Dog",
            description:
              "Canine companions - loyal, playful, and always happy to see you",
          },
          {
            id: "both",
            label: "Cat & Dog",
            description:
              "Multi-pet household - the chaos and love of furry siblings",
          },
        ],
        schema: {
          $ref: "schemas/pet_type_display_schema.json",
          type: "json",
        },
        multi_select: false,
        mode: "select",
      },
      outputs_to_state: {
        selected_indices: "pet_type_indices",
        selected_data: "pet_type_selection",
      },
    },
    {
      module_id: "user.select",
      name: "select_aesthetic",
      inputs: {
        resolver_schema: {
          type: "object",
          properties: {
            data: { resolver: "server" },
          },
        },
        prompt: "Choose the story aesthetic for your video",
        data: {
          $ref: "core_aesthetics.json",
          type: "json",
        },
        schema: {
          $ref: "schemas/cc_aesthetic_display_schema.json",
          type: "json",
        },
        multi_select: false,
        mode: "select",
      },
      outputs_to_state: {
        selected_indices: "aesthetic_indices",
        selected_data: "aesthetic_selection",
      },
    },
  ],
};

function formatValue(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return "{...}";
  if (typeof value === "string") return value;
  return String(value);
}

function buildGraphFromStep(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let index = 0;

  const nextId = (prefix: string) => `${prefix}-${index++}`;

  const stepGroupId = "step-user-input";
  nodes.push({
    id: stepGroupId,
    type: "group",
    position: { x: 40, y: 40 },
    style: {
      width: 1400,
      height: 1200,
      border: "1px solid var(--border)",
      background: "var(--card)",
    },
    data: {},
    draggable: false,
    selectable: false,
  });

  const stepInfoId = nextId("step-info");
  nodes.push({
    id: stepInfoId,
    parentId: stepGroupId,
    extent: "parent",
    position: { x: 20, y: 20 },
    data: {
      label: `step_id: ${STEP_SPEC.step_id}`,
    },
    style: { width: 320, fontWeight: 600 },
  });

  const stepNameId = nextId("step-name");
  nodes.push({
    id: stepNameId,
    parentId: stepGroupId,
    extent: "parent",
    position: { x: 20, y: 92 },
    data: { label: `name: ${STEP_SPEC.name}` },
    style: { width: 660 },
  });

  const stepDescriptionId = nextId("step-description");
  nodes.push({
    id: stepDescriptionId,
    parentId: stepGroupId,
    extent: "parent",
    position: { x: 20, y: 154 },
    data: { label: `description: ${STEP_SPEC.description}` },
    style: { width: 660 },
  });

  const addValueTree = (
    value: JsonValue,
    key: string,
    parentNodeId: string,
    moduleGroupId: string,
    depth: number,
    rowRef: { value: number }
  ) => {
    const id = nextId("field");
    nodes.push({
      id,
      parentId: moduleGroupId,
      extent: "parent",
      position: { x: 16 + depth * 180, y: rowRef.value },
      data: { label: `${key}: ${formatValue(value)}` },
      style: { width: 170 },
    });
    edges.push({
      id: nextId("edge"),
      source: parentNodeId,
      target: id,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.2 },
    });
    rowRef.value += 56;

    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        addValueTree(item, `[${idx}]`, id, moduleGroupId, depth + 1, rowRef);
      });
      return;
    }

    if (value && typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => {
        addValueTree(childValue, childKey, id, moduleGroupId, depth + 1, rowRef);
      });
    }
  };

  STEP_SPEC.modules.forEach((moduleSpec, moduleIndex) => {
    const moduleGroupId = `module-group-${moduleIndex}`;
    const moduleX = 20 + moduleIndex * 680;

    nodes.push({
      id: moduleGroupId,
      type: "group",
      parentId: stepGroupId,
      extent: "parent",
      position: { x: moduleX, y: 240 },
      style: {
        width: 640,
        height: 920,
        border: "1px dashed var(--border)",
        background: "var(--muted)",
      },
      data: {},
      draggable: false,
    });

    const moduleRootId = `module-root-${moduleIndex}`;
    nodes.push({
      id: moduleRootId,
      parentId: moduleGroupId,
      extent: "parent",
      position: { x: 16, y: 16 },
      data: {
        label: `${moduleSpec.name} (${moduleSpec.module_id})`,
      },
      style: { width: 420, fontWeight: 600 },
    });

    const rowRef = { value: 82 };
    addValueTree(
      moduleSpec.inputs,
      "inputs",
      moduleRootId,
      moduleGroupId,
      0,
      rowRef
    );
    addValueTree(
      moduleSpec.outputs_to_state,
      "outputs_to_state",
      moduleRootId,
      moduleGroupId,
      0,
      rowRef
    );

    if (moduleIndex > 0) {
      edges.push({
        id: `module-sequence-${moduleIndex}`,
        source: `module-root-${moduleIndex - 1}`,
        target: moduleRootId,
        type: "smoothstep",
        label: "step flow",
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }
  });

  return { nodes, edges };
}

const graph = buildGraphFromStep();

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
        <ReactFlow fitView nodes={graph.nodes} edges={graph.edges}>
          <Background gap={20} />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
