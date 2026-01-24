/**
 * InteractionPanel - Wrapper component for interaction display in runner page.
 *
 * Provides a Card container for InteractionHost and can be extended
 * to add additional UI elements (progress indicators, help text, etc.)
 */

import { Card, CardContent } from "@/components/ui/card";
import { InteractionHost } from "../interactions/InteractionHost";
import type { InteractionRequest, InteractionResponseData } from "@/lib/types";

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
}

// =============================================================================
// Component
// =============================================================================

export function InteractionPanel({
  request,
  onSubmit,
  onCancel,
  disabled,
}: InteractionPanelProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardContent className="pt-6 pb-6 flex-1 min-h-0">
        <InteractionHost
          request={request}
          onSubmit={onSubmit}
          onCancel={onCancel}
          disabled={disabled}
        />
      </CardContent>
    </Card>
  );
}
