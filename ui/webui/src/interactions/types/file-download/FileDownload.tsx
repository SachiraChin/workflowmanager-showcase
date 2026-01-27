/**
 * FileDownload - File download component using InteractionContext.
 *
 * Features:
 * - File content preview
 * - Download button (via ActionSlot, appears in footer)
 * - Tracks download status
 *
 * Registers itself with InteractionContext via updateProvider().
 * Title, prompt, and submit button are handled by InteractionHost.
 * Uses same structure for active and readonly modes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInteraction, ActionSlot } from "@/state/interaction-context";

interface DownloadState {
  downloaded: boolean;
  filePath: string;
  error?: string;
}

export function FileDownload() {
  const { request, updateProvider, mode } = useInteraction();

  const isReadonly = mode.type === "readonly";

  // In readonly mode, get download status from response (handle both old and new formats)
  const readonlyDownloaded = isReadonly && (mode.response.file_written === true || mode.response.value === "downloaded");

  // Local state
  const [state, setState] = useState<DownloadState>({
    downloaded: false,
    filePath: "",
  });

  // Effective values - in readonly mode, use response data
  const effectiveDownloaded = isReadonly ? readonlyDownloaded : state.downloaded;

  // Keep ref in sync for getResponse closure
  const stateRef = useRef(state);
  stateRef.current = state;

  // Always valid - download is optional, user can continue without downloading
  const isValid = true;

  // Register provider with InteractionHost
  useEffect(() => {
    updateProvider({
      getResponse: () => ({
        // Server expects file_written and file_path fields
        file_written: true,
        file_path: stateRef.current.filePath || request.file_name || "",
      }),
      getState: () => ({
        isValid,
        selectedCount: 0,
        selectedGroupIds: [],
      }),
    });
  }, [isValid, updateProvider, request.file_name]);

  // Format content for display
  const displayContent = useMemo(() => {
    if (!request.file_content) return "";
    if (request.file_content_type === "json") {
      try {
        const parsed =
          typeof request.file_content === "string"
            ? JSON.parse(request.file_content)
            : request.file_content;
        return JSON.stringify(parsed, null, 2);
      } catch {
        return String(request.file_content);
      }
    }
    return String(request.file_content);
  }, [request.file_content, request.file_content_type]);

  // Handle download
  const handleDownload = useCallback(() => {
    try {
      const content = request.file_content || "";
      const blob = new Blob(
        [typeof content === "string" ? content : JSON.stringify(content, null, 2)],
        {
          type: request.file_content_type === "json" ? "application/json" : "text/plain",
        }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = request.file_name || "download.txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setState({
        downloaded: true,
        filePath: request.file_name || "",
        error: undefined,
      });
    } catch (e) {
      setState((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : "Download failed",
      }));
    }
  }, [request.file_content, request.file_name, request.file_content_type]);

  // Same structure for both active and readonly modes
  // Download button appears in footer via ActionSlot (always enabled - downloading is read-only)
  return (
    <div className="h-full flex flex-col">
      {/* File header */}
      <div className="flex items-center gap-2 text-sm font-medium mb-2 flex-shrink-0">
        <Download className="h-4 w-4" />
        {request.file_name || "file"}
        {request.file_content_type && (
          <span className="text-xs text-muted-foreground">
            ({request.file_content_type})
          </span>
        )}
      </div>

      {/* Content preview - takes full remaining height */}
      <pre className="flex-1 min-h-0 text-xs bg-muted p-4 rounded-md overflow-auto whitespace-pre-wrap font-mono scrollbar-inner">
        {displayContent}
      </pre>

      {/* Download button renders in footer via ActionSlot */}
      <ActionSlot id="download">
        <Button
          onClick={handleDownload}
          variant={effectiveDownloaded ? "outline" : "secondary"}
        >
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>
      </ActionSlot>

      {/* Error display */}
      {state.error && (
        <div className="text-sm text-red-600 mt-2">{state.error}</div>
      )}
    </div>
  );
}
