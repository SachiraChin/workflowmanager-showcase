/**
 * InteractionPanel - Wrapper component for interaction display in runner page.
 *
 * Provides a Card container for InteractionHost and sets up the necessary
 * adapters to bridge @wfm/shared components to webui state.
 */

import { Card, CardContent } from "@/components/ui/card";
import { InteractionHost } from "@wfm/shared";
import type { InteractionRequest, InteractionResponseData } from "@/core/types";
import { WebUIRenderProvider } from "@/adapters";

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
  return (
    <Card className="h-full flex flex-col">
      <CardContent className="pt-6 pb-6 flex-1 min-h-0">
        <WebUIRenderProvider>
          <InteractionHost
            request={request}
            onSubmit={onSubmit}
            onCancel={onCancel}
            disabled={disabled}
            onSubActionComplete={onSubActionComplete}
          />
        </WebUIRenderProvider>
      </CardContent>
    </Card>
  );
}
