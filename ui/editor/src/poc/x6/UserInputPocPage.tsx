import { useEffect, useRef } from "react";
import { Graph, type Node } from "@antv/x6";

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
          properties: { data: { resolver: "server" } },
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
          properties: { data: { resolver: "server" } },
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

function addTreeNode(params: {
  graph: Graph;
  moduleGroup: Node;
  parentCellId: string;
  key: string;
  value: JsonValue;
  depth: number;
  rowRef: { value: number };
  idRef: { value: number };
}) {
  const { graph, moduleGroup, parentCellId, key, value, depth, rowRef, idRef } =
    params;
  const fieldId = `x6-field-${idRef.value++}`;
  const node = graph.addNode({
    id: fieldId,
    shape: "rect",
    x: 18 + depth * 184,
    y: rowRef.value,
    width: 170,
    height: 36,
    label: `${key}: ${formatValue(value)}`,
    attrs: {
      body: {
        stroke: "var(--border)",
        fill: "var(--background)",
        rx: 8,
        ry: 8,
      },
      label: {
        fill: "var(--foreground)",
        fontSize: 11,
      },
    },
  });
  moduleGroup.addChild(node);
  graph.addEdge({
    source: { cell: parentCellId },
    target: { cell: fieldId },
    attrs: {
      line: {
        stroke: "var(--foreground)",
        strokeWidth: 1.1,
        targetMarker: { name: "classic", size: 7 },
      },
    },
  });

  rowRef.value += 52;

  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      addTreeNode({
        graph,
        moduleGroup,
        parentCellId: fieldId,
        key: `[${idx}]`,
        value: item,
        depth: depth + 1,
        rowRef,
        idRef,
      });
    });
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, childValue]) => {
      addTreeNode({
        graph,
        moduleGroup,
        parentCellId: fieldId,
        key: childKey,
        value: childValue,
        depth: depth + 1,
        rowRef,
        idRef,
      });
    });
  }
}

export function X6UserInputPocPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph({
      container: containerRef.current,
      background: { color: "transparent" },
      grid: { visible: true, size: 20 },
      panning: true,
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"] },
    });

    const stepGroup = graph.addNode({
      id: "x6-step-group",
      shape: "rect",
      x: 40,
      y: 40,
      width: 1420,
      height: 1180,
      label: `${STEP_SPEC.step_id} | ${STEP_SPEC.name}`,
      attrs: {
        body: {
          stroke: "var(--border)",
          fill: "var(--card)",
          rx: 12,
          ry: 12,
        },
        label: {
          fill: "var(--foreground)",
          fontSize: 14,
          textAnchor: "start",
          textVerticalAnchor: "top",
          refX: 14,
          refY: 12,
        },
      },
    });

    const stepDescription = graph.addNode({
      id: "x6-step-description",
      shape: "rect",
      x: 20,
      y: 56,
      width: 700,
      height: 40,
      label: `description: ${STEP_SPEC.description}`,
      attrs: {
        body: {
          stroke: "var(--border)",
          fill: "var(--background)",
          rx: 8,
          ry: 8,
        },
        label: { fill: "var(--foreground)", fontSize: 12 },
      },
    });
    stepGroup.addChild(stepDescription);

    const idRef = { value: 0 };

    STEP_SPEC.modules.forEach((moduleSpec, moduleIndex) => {
      const moduleGroup = graph.addNode({
        id: `x6-module-group-${moduleIndex}`,
        shape: "rect",
        x: 20 + moduleIndex * 700,
        y: 130,
        width: 680,
        height: 1020,
        label: `${moduleSpec.name} (${moduleSpec.module_id})`,
        attrs: {
          body: {
            stroke: "var(--border)",
            fill: "var(--muted)",
            strokeDasharray: "5 3",
            rx: 10,
            ry: 10,
          },
          label: {
            fill: "var(--foreground)",
            textAnchor: "start",
            textVerticalAnchor: "top",
            refX: 12,
            refY: 10,
          },
        },
      });
      stepGroup.addChild(moduleGroup);

      const rootId = `x6-module-root-${moduleIndex}`;
      const moduleRoot = graph.addNode({
        id: rootId,
        shape: "rect",
        x: 14,
        y: 42,
        width: 340,
        height: 38,
        label: `module_id: ${moduleSpec.module_id}`,
        attrs: {
          body: {
            stroke: "var(--border)",
            fill: "var(--card)",
            rx: 8,
            ry: 8,
          },
          label: { fill: "var(--foreground)", fontSize: 12 },
        },
      });
      moduleGroup.addChild(moduleRoot);

      const rowRef = { value: 96 };
      addTreeNode({
        graph,
        moduleGroup,
        parentCellId: rootId,
        key: "inputs",
        value: moduleSpec.inputs,
        depth: 0,
        rowRef,
        idRef,
      });
      addTreeNode({
        graph,
        moduleGroup,
        parentCellId: rootId,
        key: "outputs_to_state",
        value: moduleSpec.outputs_to_state,
        depth: 0,
        rowRef,
        idRef,
      });

      if (moduleIndex > 0) {
        graph.addEdge({
          source: { cell: `x6-module-root-${moduleIndex - 1}` },
          target: { cell: rootId },
          attrs: {
            line: {
              stroke: "var(--foreground)",
              strokeWidth: 1.2,
              targetMarker: { name: "classic", size: 7 },
            },
          },
          labels: [{ attrs: { label: { text: "step flow", fill: "var(--foreground)" } } }],
        });
      }
    });

    graph.centerContent();

    return () => graph.dispose();
  }, []);

  return (
    <div className="h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">X6 User Input PoC</h1>
          <p className="text-xs text-muted-foreground">
            Based on `workflows/cc/steps/1_user_input` with nested step/module
            graph rendering.
          </p>
        </div>
      </header>
      <div className="h-[calc(100vh-53px)] p-2">
        <div className="x6-canvas h-full w-full rounded-md border" ref={containerRef} />
      </div>
    </div>
  );
}
