/**
 * Sample data and schema for UX Schema Editor PoC.
 * Based on real workflow patterns from cc workflow.
 */

// Sample data that would come from a module (e.g., user.select options)
export const samplePetTypeData = [
  {
    id: "cat",
    label: "Cat",
    description: "Feline friends - independent, curious, and endlessly entertaining",
  },
  {
    id: "dog",
    label: "Dog",
    description: "Canine companions - loyal, playful, and always happy to see you",
  },
  {
    id: "both",
    label: "Cat & Dog",
    description: "Multi-pet household - the chaos and love of furry siblings",
  },
];

// More complex nested data (like scenes)
export const sampleScenesData = {
  scenes: [
    {
      title: "Morning Cuddles",
      hook: "Start your day with warmth",
      narrative: "A cozy morning scene with soft sunlight",
      visual_moments: ["Wake up stretch", "First pet of the day", "Breakfast time"],
      pet_behavior: "Sleepy but affectionate",
      emotional_arc: "Peaceful to joyful",
      setting: "Bedroom with morning light",
    },
    {
      title: "Playtime Adventures",
      hook: "Unleash the energy",
      narrative: "Action-packed play session",
      visual_moments: ["Toy chase", "Zoomies", "Tired flop"],
      pet_behavior: "Energetic and playful",
      emotional_arc: "Excitement building to satisfaction",
      setting: "Living room with toys scattered",
    },
  ],
};

// Data schema (what the data looks like - JSON Schema style)
export type DataSchemaNode = {
  type: "string" | "number" | "boolean" | "array" | "object";
  properties?: Record<string, DataSchemaNode>;
  items?: DataSchemaNode;
  description?: string;
};

export const petTypeDataSchema: DataSchemaNode = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "Unique identifier" },
      label: { type: "string", description: "Display label" },
      description: { type: "string", description: "Detailed description" },
    },
  },
};

export const scenesDataSchema: DataSchemaNode = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Scene title" },
          hook: { type: "string", description: "Attention grabber" },
          narrative: { type: "string", description: "Story description" },
          visual_moments: {
            type: "array",
            items: { type: "string" },
            description: "Key visual moments",
          },
          pet_behavior: { type: "string", description: "Pet behavior description" },
          emotional_arc: { type: "string", description: "Emotional journey" },
          setting: { type: "string", description: "Scene setting" },
        },
      },
    },
  },
};

// Available render_as options organized by category
export const RENDER_AS_OPTIONS = {
  containers: ["card-stack", "grid", "list", "section-list", "tabs"] as const,
  layouts: ["card", "section"] as const,
  roles: [
    "card-title",
    "card-subtitle",
    "section-header",
    "section-title",
    "section-badge",
    "section-summary",
    "tab",
  ] as const,
  terminal: ["text", "color", "url", "datetime", "number", "image"] as const,
  special: [
    "content-panel",
    "table",
    "media",
    "image_generation",
    "video_generation",
    "audio_generation",
  ] as const,
};

export const ALL_RENDER_AS = [
  ...RENDER_AS_OPTIONS.containers,
  ...RENDER_AS_OPTIONS.layouts,
  ...RENDER_AS_OPTIONS.roles,
  ...RENDER_AS_OPTIONS.terminal,
  ...RENDER_AS_OPTIONS.special,
];

// Display modes
export const DISPLAY_MODES = ["visible", "hidden", "passthrough"] as const;

// Nudges
export const NUDGES = [
  "copy",
  "swatch",
  "external-link",
  "preview",
  "download",
  "index-badge",
] as const;

// UX config type (what gets added to display schema)
export type UxConfig = {
  display?: "visible" | "hidden" | "passthrough";
  display_label?: string;
  display_format?: string;
  display_order?: number;
  render_as?: string;
  nudges?: string[];
  highlight?: boolean;
  highlight_color?: string;
  selectable?: boolean;
};

// Tree node structure for react-arborist
export type SchemaTreeNode = {
  id: string;
  name: string;
  path: string[];
  schemaType: string;
  isLeaf: boolean;
  children?: SchemaTreeNode[];
  uxConfig?: UxConfig;
};

/**
 * Build children nodes from an object's properties
 */
function buildPropertyNodes(
  properties: Record<string, DataSchemaNode>,
  basePath: string[]
): SchemaTreeNode[] {
  const nodes: SchemaTreeNode[] = [];

  for (const [key, value] of Object.entries(properties)) {
    const nodePath = [...basePath, key];
    const nodeId = nodePath.join(".");

    const node: SchemaTreeNode = {
      id: nodeId,
      name: key,
      path: nodePath,
      schemaType: value.type,
      isLeaf: value.type !== "object" && value.type !== "array",
    };

    if (value.type === "object" && value.properties) {
      node.children = buildPropertyNodes(value.properties, nodePath);
    } else if (value.type === "array" && value.items) {
      node.children = buildItemsChildren(value.items, nodePath);
    }

    nodes.push(node);
  }

  return nodes;
}

/**
 * Build children for an array's items schema
 */
function buildItemsChildren(
  items: DataSchemaNode,
  parentPath: string[]
): SchemaTreeNode[] {
  const itemsPath = [...parentPath, "[items]"];
  const itemsNode: SchemaTreeNode = {
    id: itemsPath.join("."),
    name: "[items]",
    path: itemsPath,
    schemaType: items.type,
    isLeaf: items.type !== "object" && items.type !== "array",
  };

  if (items.type === "object" && items.properties) {
    itemsNode.children = buildPropertyNodes(items.properties, itemsPath);
  } else if (items.type === "array" && items.items) {
    itemsNode.children = buildItemsChildren(items.items, itemsPath);
  }

  return [itemsNode];
}

/**
 * Convert a data schema to tree nodes.
 * Always includes the root node itself as draggable.
 */
export function schemaToTreeNodes(
  schema: DataSchemaNode,
  rootName = "(root)"
): SchemaTreeNode[] {
  const rootNode: SchemaTreeNode = {
    id: "(root)",
    name: rootName,
    path: [],
    schemaType: schema.type,
    isLeaf: false,
  };

  if (schema.type === "object" && schema.properties) {
    rootNode.children = buildPropertyNodes(schema.properties, []);
  } else if (schema.type === "array" && schema.items) {
    rootNode.children = buildItemsChildren(schema.items, []);
  }

  return [rootNode];
}
