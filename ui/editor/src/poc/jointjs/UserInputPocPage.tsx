import { useEffect, useRef } from "react";
import { dia, shapes } from "@joint/core";

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
  graph: dia.Graph;
  moduleGroup: shapes.standard.Rectangle;
  parentId: string;
  key: string;
  value: JsonValue;
  depth: number;
  rowRef: { value: number };
  idRef: { value: number };
}) {
  const { graph, moduleGroup, parentId, key, value, depth, rowRef, idRef } =
    params;
  const id = `joint-field-${idRef.value++}`;
  const node = new shapes.standard.Rectangle({
    id,
    position: { x: 18 + depth * 180, y: rowRef.value },
    size: { width: 170, height: 36 },
    attrs: {
      body: {
        fill: "#ffffff",
        stroke: "#cbd5e1",
        strokeWidth: 1,
        rx: 8,
        ry: 8,
      },
      label: {
        text: `${key}: ${formatValue(value)}`,
        fill: "#0f172a",
        fontSize: 11,
      },
    },
  });
  node.addTo(graph);
  moduleGroup.embed(node);

  new shapes.standard.Link({
    source: { id: parentId },
    target: { id },
    attrs: {
      line: {
        stroke: "#334155",
        strokeWidth: 1,
        targetMarker: { type: "path", d: "M 8 -4 0 0 8 4 Z" },
      },
    },
  }).addTo(graph);

  rowRef.value += 52;

  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      addTreeNode({
        graph,
        moduleGroup,
        parentId: id,
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
        parentId: id,
        key: childKey,
        value: childValue,
        depth: depth + 1,
        rowRef,
        idRef,
      });
    });
  }
}

export function JointJsUserInputPocPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const graph = new dia.Graph({}, { cellNamespace: shapes });
    const paper = new dia.Paper({
      model: graph,
      cellViewNamespace: shapes,
      el: container,
      width: container.clientWidth || 1200,
      height: container.clientHeight || 700,
      gridSize: 20,
      drawGrid: { name: "mesh", args: { color: "#d4d4d8", thickness: 1 } },
      background: { color: "transparent" },
      interactive: true,
      defaultConnectionPoint: { name: "boundary" },
    });

    if (debugRef.current) {
      debugRef.current.textContent =
        `paper ${container.clientWidth}x${container.clientHeight} | cells 0`;
    }

    const stepGroup = new shapes.standard.Rectangle({
      id: "joint-step-group",
      position: { x: 40, y: 40 },
      size: { width: 1420, height: 1180 },
      attrs: {
        body: {
          fill: "#f8fafc",
          stroke: "#cbd5e1",
          strokeWidth: 1,
          rx: 12,
          ry: 12,
        },
        label: {
          text: `${STEP_SPEC.step_id} | ${STEP_SPEC.name}`,
          fill: "#0f172a",
          fontSize: 14,
          textAnchor: "start",
          textVerticalAnchor: "top",
          refX: 14,
          refY: 12,
        },
      },
    });
    stepGroup.addTo(graph);
    stepGroup.toBack();

    const stepDescription = new shapes.standard.Rectangle({
      id: "joint-step-description",
      position: { x: 20, y: 56 },
      size: { width: 700, height: 40 },
      attrs: {
        body: {
          fill: "#ffffff",
          stroke: "#cbd5e1",
          strokeWidth: 1,
          rx: 8,
          ry: 8,
        },
        label: {
          text: `description: ${STEP_SPEC.description}`,
          fill: "#0f172a",
          fontSize: 12,
        },
      },
    });
    stepDescription.addTo(graph);
    stepGroup.embed(stepDescription);

    const idRef = { value: 0 };

    STEP_SPEC.modules.forEach((moduleSpec, moduleIndex) => {
      const moduleGroup = new shapes.standard.Rectangle({
        id: `joint-module-group-${moduleIndex}`,
        position: { x: 20 + moduleIndex * 700, y: 130 },
        size: { width: 680, height: 1020 },
        attrs: {
          body: {
            fill: "#eef2f7",
            stroke: "#cbd5e1",
            strokeWidth: 1,
            strokeDasharray: "5 3",
            rx: 10,
            ry: 10,
          },
          label: {
            text: `${moduleSpec.name} (${moduleSpec.module_id})`,
            fill: "#0f172a",
            textAnchor: "start",
            textVerticalAnchor: "top",
            refX: 12,
            refY: 10,
          },
        },
      });
      moduleGroup.addTo(graph);
      stepGroup.embed(moduleGroup);

      const rootId = `joint-module-root-${moduleIndex}`;
      const moduleRoot = new shapes.standard.Rectangle({
        id: rootId,
        position: { x: 14, y: 42 },
        size: { width: 340, height: 38 },
        attrs: {
          body: {
            fill: "#ffffff",
            stroke: "#cbd5e1",
            strokeWidth: 1,
            rx: 8,
            ry: 8,
          },
          label: {
            text: `module_id: ${moduleSpec.module_id}`,
            fill: "#0f172a",
            fontSize: 12,
          },
        },
      });
      moduleRoot.addTo(graph);
      moduleGroup.embed(moduleRoot);

      const rowRef = { value: 96 };
      addTreeNode({
        graph,
        moduleGroup,
        parentId: rootId,
        key: "inputs",
        value: moduleSpec.inputs,
        depth: 0,
        rowRef,
        idRef,
      });
      addTreeNode({
        graph,
        moduleGroup,
        parentId: rootId,
        key: "outputs_to_state",
        value: moduleSpec.outputs_to_state,
        depth: 0,
        rowRef,
        idRef,
      });

      if (moduleIndex > 0) {
        new shapes.standard.Link({
          source: { id: `joint-module-root-${moduleIndex - 1}` },
          target: { id: rootId },
          labels: [{ attrs: { text: { text: "step flow", fill: "#0f172a" } } }],
          attrs: {
            line: {
              stroke: "#0f172a",
              strokeWidth: 1.2,
              targetMarker: { type: "path", d: "M 8 -4 0 0 8 4 Z" },
            },
          },
        }).addTo(graph);
      }
    });

    paper.scaleContentToFit({
      padding: 36,
      preserveAspectRatio: true,
      minScaleX: 0.3,
      minScaleY: 0.3,
      maxScaleX: 1,
      maxScaleY: 1,
    });

    const handleResize = () => {
      paper.setDimensions(container.clientWidth || 1200, container.clientHeight || 700);
      paper.scaleContentToFit({
        padding: 36,
        preserveAspectRatio: true,
        minScaleX: 0.3,
        minScaleY: 0.3,
        maxScaleX: 1,
        maxScaleY: 1,
      });
      if (debugRef.current) {
        debugRef.current.textContent =
          `paper ${container.clientWidth}x${container.clientHeight} | cells ${graph.getCells().length}`;
      }
    };

    if (debugRef.current) {
      debugRef.current.textContent =
        `paper ${container.clientWidth}x${container.clientHeight} | cells ${graph.getCells().length}`;
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      paper.remove();
      graph.clear();
    };
  }, []);

  return (
    <div className="h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">JointJS User Input PoC</h1>
          <p className="text-xs text-muted-foreground">
            Based on `workflows/cc/steps/1_user_input` with nested step/module
            graph rendering.
          </p>
        </div>
      </header>
      <section className="border-b px-3 py-1 text-xs text-muted-foreground">
        debug: <span ref={debugRef}>init</span>
      </section>
      <div className="h-[calc(100vh-53px)] p-2">
        <div className="joint-canvas h-full w-full rounded-md border" ref={containerRef} />
      </div>
    </div>
  );
}
