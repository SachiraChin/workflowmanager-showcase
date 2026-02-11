import type { UserSelectModule } from "@/modules/user/select";

const PET_TYPE_SCHEMA = {
  type: "array",
  "_ux.display": "visible",
  "_ux.render_as": "card-stack",
  items: {
    type: "object",
    _ux: {
      display: "visible",
      render_as: "card",
      selectable: true,
    },
    properties: {
      id: {
        type: "string",
        "_ux.display": false,
      },
      label: {
        type: "string",
        "_ux.display": true,
        "_ux.render_as": "card-title",
      },
      description: {
        type: "string",
        "_ux.display": true,
        "_ux.render_as": "card-subtitle",
      },
    },
  },
} as const;

const AESTHETIC_SCHEMA = {
  type: "array",
  "_ux.display": "visible",
  "_ux.render_as": "card-stack",
  items: {
    type: "object",
    _ux: {
      display: "visible",
      render_as: "card",
      selectable: true,
    },
    properties: {
      id: {
        type: "string",
        "_ux.display": false,
      },
      label: {
        type: "string",
        "_ux.display": true,
        "_ux.render_as": "card-title",
      },
      description: {
        type: "string",
        "_ux.display": true,
        "_ux.render_as": "card-subtitle",
      },
      visual_tone: {
        type: "object",
        "_ux.display": true,
        "_ux.display_label": "Visual Tone",
        properties: {
          mood: {
            type: "string",
            "_ux.display": true,
            "_ux.display_label": "Mood",
          },
          lighting: {
            type: "string",
            "_ux.display": true,
            "_ux.display_label": "Lighting",
          },
          energy: {
            type: "string",
            _ux: {
              display: true,
              display_label: "Energy",
              highlight: true,
            },
          },
        },
      },
      story_angles: {
        type: "array",
        _ux: {
          display: true,
          display_label: "Story Ideas",
          display_format: "{{ value | join(' | ') }}",
        },
      },
    },
  },
} as const;

const CORE_AESTHETICS = [
  {
    id: "adventure",
    label: "Adventure & Exploration",
    description:
      "Pets discovering the world with curiosity and wonder - outdoor journeys, new experiences, and the joy of exploration.",
    visual_tone: {
      mood: "bright, expansive, dynamic",
      lighting: "natural outdoor light, golden hour, dappled sunlight",
      energy: "high",
      warmth: "warm",
    },
    story_angles: [
      "First time at the beach/park/mountains",
      "Chasing butterflies or leaves",
      "Exploring a new hiking trail",
      "Road trip companion moments",
      "Discovering snow for the first time",
      "Garden adventures and bug hunting",
    ],
  },
  {
    id: "comfort",
    label: "Comfort & Sanctuary",
    description:
      "The warmth of home life - cozy moments, safe spaces, and the comfort pets find in their favorite spots.",
    visual_tone: {
      mood: "warm, soft, intimate",
      lighting: "soft indoor light, warm lamps, window light",
      energy: "low",
      warmth: "very warm",
    },
    story_angles: [
      "Curled up in their favorite bed",
      "Sunbeam napping",
      "Rainy day cuddles",
      "Blanket burrowing",
      "Claiming the warmest spot in the house",
      "Peaceful sleep moments",
    ],
  },
  {
    id: "playful",
    label: "Playful Chaos",
    description:
      "The hilarious, energetic side of pet life - zoomies, mischief, toys everywhere, and pure unbridled joy.",
    visual_tone: {
      mood: "energetic, bright, fun",
      lighting: "bright, clear, dynamic",
      energy: "very high",
      warmth: "warm",
    },
    story_angles: [
      "Zoomies around the house",
      "Toy destruction aftermath",
      "Failed jump attempts",
      "Playing with unlikely objects",
      "Stealing socks or shoes",
      "Bath time chaos",
    ],
  },
  {
    id: "bond",
    label: "Unconditional Love",
    description:
      "The deep connection between pets and their humans - loyalty, companionship, and moments that show why they're family.",
    visual_tone: {
      mood: "warm, emotional, intimate",
      lighting: "soft, warm, golden hour",
      energy: "gentle",
      warmth: "very warm",
    },
    story_angles: [
      "Greeting at the door",
      "Leaning into their human",
      "Following from room to room",
      "Protective moments",
      "Shared quiet time",
      "The look of trust and love",
    ],
  },
  {
    id: "growth",
    label: "Growth Journey",
    description:
      "The passage of time with our pets - from tiny puppy or kitten to beloved adult, milestones, learning, and growing together.",
    visual_tone: {
      mood: "nostalgic, hopeful, progressive",
      lighting: "soft, varied by life stage",
      energy: "varied",
      warmth: "warm",
    },
    story_angles: [
      "First day home memories",
      "Learning to climb stairs",
      "Growing into their paws",
      "Training milestones",
      "Before and after moments",
      "Anniversary celebrations",
    ],
  },
  {
    id: "quiet",
    label: "Quiet Companionship",
    description:
      "The peaceful presence of a pet - silent understanding, shared stillness, and the comfort of just being together.",
    visual_tone: {
      mood: "calm, peaceful, meditative",
      lighting: "soft, muted, gentle",
      energy: "very low",
      warmth: "neutral to warm",
    },
    story_angles: [
      "Reading together in silence",
      "Working from home companion",
      "Watching the world through a window",
      "Evening wind-down together",
      "Peaceful coexistence",
      "The comfort of presence",
    ],
  },
  {
    id: "rescue",
    label: "Rescue & Second Chance",
    description:
      "Stories of transformation - adoption journeys, shelter to home, healing, and the beautiful new beginnings pets deserve.",
    visual_tone: {
      mood: "emotional arc from uncertain to hopeful",
      lighting: "progresses from muted to warm",
      energy: "builds from low to moderate",
      warmth: "builds to very warm",
    },
    story_angles: [
      "Shelter to home transformation",
      "First real bed moment",
      "Learning to trust again",
      "Finding their person",
      "Before and after glow-up",
      "The moment they knew they were safe",
    ],
  },
  {
    id: "seasons",
    label: "Seasonal Life",
    description:
      "Pets experiencing the changing seasons - holiday moments, weather reactions, and the rhythm of the year.",
    visual_tone: {
      mood: "varied by season, thematic",
      lighting: "season-appropriate",
      energy: "moderate",
      warmth: "varies with season",
    },
    story_angles: [
      "First snow excitement or confusion",
      "Autumn leaf piles",
      "Summer beach days",
      "Spring awakening and new smells",
      "Holiday photo attempts",
      "Seasonal coat changes",
    ],
  },
  {
    id: "rituals",
    label: "Daily Rituals",
    description:
      "The beloved routines of pet life - feeding time excitement, walk anticipation, and the rhythms that define their day.",
    visual_tone: {
      mood: "familiar, rhythmic, authentic",
      lighting: "natural, time-of-day appropriate",
      energy: "moderate to high",
      warmth: "warm",
    },
    story_angles: [
      "The 6am wake-up call",
      "Dinner time dance",
      "Walk anticipation excitement",
      "Post-walk exhaustion",
      "Treat negotiation tactics",
      "Bedtime routine",
    ],
  },
  {
    id: "remembrance",
    label: "Loss & Remembrance",
    description:
      "Honoring pets who have crossed the rainbow bridge - cherished memories, tribute, and the love that never fades.",
    visual_tone: {
      mood: "soft, nostalgic, bittersweet",
      lighting: "gentle, dreamy, soft focus",
      energy: "very low",
      warmth: "warm but muted",
    },
    story_angles: [
      "Favorite memory montage",
      "The spot they loved most",
      "Their unique quirks we miss",
      "Rainbow bridge imagery",
      "Forever in our hearts",
      "The pawprint they left behind",
    ],
  },
  {
    id: "heavenly",
    label: "Heavenly Realm",
    description:
      "Pets in an ethereal paradise - a dreamlike celestial world with cloud floors, golden light, ancient ruins, and magical atmosphere.",
    visual_tone: {
      mood: "ethereal, majestic, serene",
      lighting: "soft golden glow, divine rays, ambient luminescence",
      energy: "gentle but awe-inspiring",
      warmth: "warm golden",
    },
    story_angles: [
      "Walking on clouds in paradise",
      "Exploring ancient celestial ruins",
      "Playing among butterflies and light particles",
      "Resting by heavenly rivers and waterfalls",
      "Guardian angel moments",
      "Discovering floating islands and temples",
    ],
  },
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildUserInputVirtualModules(): UserSelectModule[] {
  return [
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
            description: "Multi-pet household - the chaos and love of furry siblings",
          },
        ],
        schema: clone(PET_TYPE_SCHEMA),
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
        data: clone(CORE_AESTHETICS) as unknown as UserSelectModule["inputs"]["data"],
        schema: clone(AESTHETIC_SCHEMA),
        multi_select: false,
        mode: "select",
      },
      outputs_to_state: {
        selected_indices: "aesthetic_indices",
        selected_data: "aesthetic_selection",
      },
    },
  ];
}

export function buildUserInputVirtualWorkflow(
  modules: UserSelectModule[] = buildUserInputVirtualModules()
): Record<string, unknown> {
  return {
    workflow_id: "cuddle_crew_editor_virtual",
    name: "Cuddle Crew - Virtual User Select Preview",
    description: "Virtual execution fixture for first two user.select modules",
    version: "1.0",
    initial_state: {
      workflow_name: "Cuddle Crew",
    },
    config: {},
    steps: [
      {
        step_id: "user_input",
        name: "Step 1: Choose Your Pet Story",
        description: "Select pet type and story aesthetic",
        modules,
      },
    ],
  };
}
