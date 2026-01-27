/**
 * StepGroup - Groups completed interactions by step.
 *
 * Shows a step header with the step name and contains
 * a list of CompletedInteractionCards for that step.
 */

import { CompletedInteractionCard } from "./CompletedInteractionCard";
import type { CompletedInteraction } from "@/core/types";

interface StepGroupProps {
  stepId: string;
  stepName: string;
  interactions: CompletedInteraction[];
}

export function StepGroup({
  stepId,
  stepName,
  interactions,
}: StepGroupProps) {
  if (interactions.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Step header */}
      <div className="flex items-center gap-2 px-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {stepName || stepId}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Interaction cards */}
      <div className="space-y-2">
        {interactions.map((interaction) => (
          <CompletedInteractionCard
            key={interaction.interaction_id}
            interaction={interaction}
            // All cards are expanded by default
            defaultExpanded={true}
          />
        ))}
      </div>
    </div>
  );
}
