/**
 * CompletedInteractionCard - Displays a completed interaction in readonly mode.
 *
 * Features:
 * - Wraps InteractionHost with readonly mode
 * - Collapsible with expand/collapse toggle
 * - Shows timestamp and module name
 * - Full-height card with scrollable content
 * - Optional step header for first interaction in step
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/core/utils";
import { InteractionHost } from "@/interactions/InteractionHost";
import type { CompletedInteraction } from "@/core/types";

interface CompletedInteractionCardProps {
  interaction: CompletedInteraction;
  defaultExpanded?: boolean;
  /** Step name to show as header (only shown if provided) */
  stepName?: string;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CompletedInteractionCard({
  interaction,
  defaultExpanded = false,
  stepName,
}: CompletedInteractionCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const title = interaction.request.title || interaction.request.interaction_type || "Interaction";
  const moduleName = interaction.module_name;
  const timestamp = formatTimestamp(interaction.timestamp);

  return (
    <div className="h-full flex flex-col">
      {/* Step header - only shown for first interaction in step */}
      {stepName && (
        <div className="flex items-center gap-2 px-1 py-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {stepName}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      {/* Card fills remaining height */}
      <Card className={cn(
        "flex-1 flex flex-col py-0 gap-0 min-h-0",
        !isExpanded && "bg-muted/30"
      )}>
        <CardHeader className="py-3 px-4 flex-shrink-0">
          <Button
            variant="ghost"
            className="w-full justify-start p-0 h-auto hover:bg-transparent"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-2 w-full">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className="font-medium truncate flex-1 text-left">{title}</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                {moduleName && (
                  <span className="hidden sm:inline">{moduleName}</span>
                )}
                <Clock className="h-3 w-3" />
                <span>{timestamp}</span>
              </div>
            </div>
          </Button>
        </CardHeader>

        {isExpanded && (
          <CardContent className="flex-1 min-h-0 py-3 px-4 overflow-y-auto scrollbar-inner">
            <InteractionHost
              request={interaction.request}
              mode={{ type: "readonly", response: interaction.response }}
              onSubmit={() => Promise.resolve()}
              disabled={true}
            />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
