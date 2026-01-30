/**
 * CompletedInteractionCard - Displays a completed interaction in readonly mode.
 *
 * Features:
 * - Wraps InteractionHost with readonly mode
 * - Shows timestamp next to title (via InteractionHost)
 * - Full-height card with scrollable content
 */

import { Card, CardContent } from "@/components/ui/card";
import { InteractionHost } from "@/interactions/InteractionHost";
import type { CompletedInteraction } from "@/core/types";

interface CompletedInteractionCardProps {
  interaction: CompletedInteraction;
  /** @deprecated No longer used - cards are always expanded */
  defaultExpanded?: boolean;
  /** @deprecated No longer used - step separators removed */
  stepName?: string;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CompletedInteractionCard({
  interaction,
  defaultExpanded: _defaultExpanded,
  stepName: _stepName,
}: CompletedInteractionCardProps) {
  void _defaultExpanded; // deprecated, kept for API compatibility
  void _stepName; // deprecated, kept for API compatibility

  const timestamp = formatTimestamp(interaction.timestamp);

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="pt-6 pb-6 flex-1 min-h-0">
        <InteractionHost
          request={interaction.request}
          mode={{ type: "readonly", response: interaction.response }}
          onSubmit={() => Promise.resolve()}
          disabled={true}
          timestamp={timestamp}
        />
      </CardContent>
    </Card>
  );
}
