import type { UserSelectModule } from "@/modules/user/select";

export const ccStep1UserInputModules: UserSelectModule[] = [
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
];
