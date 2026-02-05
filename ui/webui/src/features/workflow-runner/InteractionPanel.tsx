/**
 * InteractionPanel - Wrapper component for interaction display in runner page.
 *
 * Provides a Card container for InteractionHost and sets up the necessary
 * adapters to bridge @wfm/shared components to webui state.
 */

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { InteractionHost } from "@wfm/shared";
import type { InteractionRequest, InteractionResponseData } from "@/core/types";
import { WebUIRenderProvider, WebUIMediaAdapterProvider, createWebUISubActionExecutor } from "@/adapters";

// =============================================================================
// Types
// =============================================================================

interface InteractionPanelProps {
  /** The interaction request to display */
  request: InteractionRequest;
  /** Called when user submits the interaction */
  onSubmit: (response: InteractionResponseData) => void;
  /** Called when user cancels (if applicable) */
  onCancel?: () => void;
  /** Whether the interaction is disabled */
  disabled?: boolean;
  /** Called when a sub-action completes to refresh display data */
  onSubActionComplete?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function InteractionPanel({
  request,
  onSubmit,
  onCancel,
  disabled,
  onSubActionComplete,
}: InteractionPanelProps) {
  // Create sub-action executor for this interaction - memoized to prevent recreating on every render
  const subActionExecutor = useMemo(
    () => createWebUISubActionExecutor(request.interaction_id),
    [request.interaction_id]
  );

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="pt-6 pb-6 flex-1 min-h-0">
        <WebUIRenderProvider>
          <WebUIMediaAdapterProvider>
            <InteractionHost
              request={request}
              onSubmit={onSubmit}
              onCancel={onCancel}
              disabled={disabled}
              subActionExecutor={subActionExecutor}
              onSubActionComplete={onSubActionComplete}
            />
          </WebUIMediaAdapterProvider>
        </WebUIRenderProvider>
      </CardContent>
    </Card>
  );
}
