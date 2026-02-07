/**
 * CompletedInteractionCard - Displays a completed interaction in readonly mode.
 *
 * Features:
 * - Wraps InteractionHost with readonly mode
 * - Shows timestamp next to title (via InteractionHost)
 * - Full-height card with scrollable content
 * - Asynchronously loads fresh display_data if interaction has sub-actions
 */

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { InteractionHost } from "@wfm/shared";
import { useWorkflowStore } from "@/state/workflow-store";
import { api } from "@/core/api";
import type { CompletedInteraction, InteractionRequest } from "@/core/types";
import { WebUIRenderProvider } from "@/adapters";

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

  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);
  const [resolvedDisplayData, setResolvedDisplayData] = useState<Record<string, unknown> | null>(null);

  const timestamp = formatTimestamp(interaction.timestamp);

  // Check if the interaction has sub-actions that might have modified display_data
  const hasSubActions = useMemo(() => {
    const subActions = interaction.request.display_data?.sub_actions;
    return Array.isArray(subActions) && subActions.length > 0;
  }, [interaction.request.display_data?.sub_actions]);

  // Fetch resolved display_data if interaction has sub-actions
  useEffect(() => {
    if (!hasSubActions || !workflowRunId) {
      return;
    }

    let cancelled = false;

    const fetchResolvedData = async () => {
      try {
        const result = await api.getInteractionData(
          workflowRunId,
          interaction.interaction_id
        );
        if (!cancelled && result.display_data) {
          setResolvedDisplayData(result.display_data);
        }
      } catch (err) {
        // Silently ignore - fall back to original display_data
        console.debug("[CompletedInteractionCard] Failed to fetch resolved display_data:", err);
      }
    };

    fetchResolvedData();

    return () => {
      cancelled = true;
    };
  }, [hasSubActions, workflowRunId, interaction.interaction_id]);

  // Build request with resolved display_data if available
  const request: InteractionRequest = useMemo(() => {
    if (resolvedDisplayData) {
      return {
        ...interaction.request,
        display_data: resolvedDisplayData,
      };
    }
    return interaction.request;
  }, [interaction.request, resolvedDisplayData]);

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="pt-6 pb-6 flex-1 min-h-0">
        <WebUIRenderProvider>
          <InteractionHost
            request={request}
            mode={{ type: "readonly", response: interaction.response }}
            onSubmit={() => Promise.resolve()}
            disabled={true}
            timestamp={timestamp}
          />
        </WebUIRenderProvider>
      </CardContent>
    </Card>
  );
}
