import { useMemo } from "react";
import {
  ApiClientProvider,
  InteractionHost,
  RenderProvider,
  type InteractionRequest,
  type WorkflowDefinition,
} from "@wfm/shared";
import { Loader2 } from "lucide-react";
import { createVirtualApiClient } from "./virtualApiClient";

type EmbeddedRuntimePreviewProps = {
  request: InteractionRequest | null;
  busy?: boolean;
  error?: string | null;
  mockMode?: boolean;
  scale?: number;
  getVirtualDb: () => string | null;
  getVirtualRunId: () => string | null;
  getWorkflow: () => WorkflowDefinition | null;
  onVirtualDbUpdate: (newVirtualDb: string) => void;
};

export function EmbeddedRuntimePreview({
  request,
  busy = false,
  error = null,
  mockMode = true,
  scale = 0.7,
  getVirtualDb,
  getVirtualRunId,
  getWorkflow,
  onVirtualDbUpdate,
}: EmbeddedRuntimePreviewProps) {
  const virtualApiClient = useMemo(() => {
    return createVirtualApiClient({
      getVirtualDb,
      getVirtualRunId,
      getWorkflow,
      onVirtualDbUpdate,
      getMockMode: () => mockMode,
    });
  }, [
    getVirtualDb,
    getVirtualRunId,
    getWorkflow,
    onVirtualDbUpdate,
    mockMode,
  ]);

  if (error) {
    return (
      <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (busy && !request) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-xs">Refreshing runtime preview...</span>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-muted-foreground">
        Edit schema and click Preview Runtime to load live preview.
      </div>
    );
  }

  const normalizedScale = Math.min(1, Math.max(0.5, scale));

  return (
    <div className="h-full overflow-auto">
      <div
        className="origin-top-left"
        style={{
          zoom: normalizedScale,
        }}
      >
        <ApiClientProvider client={virtualApiClient}>
          <RenderProvider value={{ debugMode: false, readonly: false, mockMode }}>
            <InteractionHost
              disabled={true}
              onSubmit={() => {}}
              request={request}
              mockMode={mockMode}
            />
          </RenderProvider>
        </ApiClientProvider>
      </div>
    </div>
  );
}
