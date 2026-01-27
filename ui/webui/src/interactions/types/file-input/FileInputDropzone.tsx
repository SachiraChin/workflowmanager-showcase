/**
 * FileInputDropzone - File input component using InteractionContext.
 *
 * Features:
 * - Drag-and-drop upload
 * - Click to select file
 * - Image preview
 * - File type validation
 *
 * Registers itself with InteractionContext via updateProvider().
 * Title and submit button are handled by InteractionHost.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, X, Image as ImageIcon, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/core/utils";
import { useInteraction } from "@/state/interaction-context";

// Default image types if none specified in request
const DEFAULT_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
];

function getAcceptedTypesDisplay(types: string[]): string {
  return types
    .map((t) => t.replace("image/", "").toUpperCase())
    .join(", ");
}

interface FileState {
  filePath: string;
  fileData?: string;
  fileName?: string;
  fileType?: string;
}

export function FileInputDropzone() {
  const { request, disabled, updateProvider, mode } = useInteraction();

  const isReadonly = mode.type === "readonly";

  // In readonly mode, get file data from response
  const readonlyFileData = isReadonly && mode.response.value ? String(mode.response.value) : undefined;
  const readonlyFilePath = isReadonly && mode.response.file_path ? String(mode.response.file_path) : undefined;

  // Local state
  const [fileState, setFileState] = useState<FileState>({ filePath: "" });
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep ref in sync for getResponse closure
  const fileStateRef = useRef(fileState);
  fileStateRef.current = fileState;

  // Derived values - in readonly mode, use response data
  const displayFileData = isReadonly ? readonlyFileData : fileState.fileData;
  const displayFileName = isReadonly ? readonlyFilePath : fileState.fileName;
  const isValid = !!displayFileData;
  const isImage = displayFileData?.startsWith("data:image/");

  // Use accepted_types from request, or fall back to defaults
  const acceptedTypes = request.accepted_types?.length
    ? request.accepted_types
    : DEFAULT_ACCEPTED_TYPES;

  // Register provider with InteractionHost
  useEffect(() => {
    updateProvider({
      getResponse: () => ({
        // Server expects file data in 'value' field (base64 data URL)
        value: fileStateRef.current.fileData,
        file_path: fileStateRef.current.filePath,
      }),
      getState: () => ({
        isValid,
        selectedCount: 0,
        selectedGroupIds: [],
      }),
    });
  }, [isValid, updateProvider]);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      // Check file type against accepted types (if any restrictions)
      if (acceptedTypes.length > 0 && !acceptedTypes.includes(file.type)) {
        setError(
          `Unsupported file type: ${file.type}. Supported: ${getAcceptedTypesDisplay(acceptedTypes)}`
        );
        return;
      }

      // Read file as data URL
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setFileState({
          filePath: file.name,
          fileData: dataUrl,
          fileName: file.name,
          fileType: file.type,
        });
      };
      reader.onerror = () => {
        setError("Failed to read file");
      };
      reader.readAsDataURL(file);
    },
    [acceptedTypes]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [disabled, handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    if (disabled) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = acceptedTypes.join(",");
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFile(file);
      }
    };
    input.click();
  }, [disabled, handleFile, acceptedTypes]);

  const handleClear = useCallback(() => {
    setFileState({ filePath: "" });
    setError(null);
  }, []);

  return (
    <div className={isReadonly ? "space-y-2" : "space-y-4"}>
      {/* File preview or dropzone */}
      {displayFileData ? (
        <div className="relative">
          {isImage ? (
            <div className={cn(
              "relative rounded-lg overflow-hidden border bg-muted/30",
              isReadonly && "opacity-90"
            )}>
              <img
                src={displayFileData}
                alt={displayFileName || "Uploaded file"}
                className={cn(
                  "w-full object-contain",
                  isReadonly ? "max-h-[150px]" : "max-h-[300px]"
                )}
              />
              {!isReadonly && (
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2"
                  onClick={handleClear}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <div className={cn(
              "flex items-center gap-3 p-4 rounded-lg border bg-muted/30",
              isReadonly && "opacity-90"
            )}>
              <File className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{displayFileName}</p>
                {!isReadonly && fileState.fileType && (
                  <p className="text-sm text-muted-foreground">{fileState.fileType}</p>
                )}
              </div>
              {!isReadonly && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClear}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            {displayFileName}
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
            isReadonly
              ? "border-muted-foreground/25 bg-muted/30 cursor-default"
              : "cursor-pointer",
            !isReadonly && isDragging
              ? "border-primary bg-primary/5"
              : !isReadonly && "border-muted-foreground/25 hover:border-muted-foreground/50",
            (disabled || isReadonly) && "opacity-50 cursor-not-allowed"
          )}
          onDrop={isReadonly ? undefined : handleDrop}
          onDragOver={isReadonly ? undefined : handleDragOver}
          onDragLeave={isReadonly ? undefined : handleDragLeave}
          onClick={isReadonly ? undefined : handleClick}
        >
          <div className="flex flex-col items-center gap-2">
            {isDragging ? (
              <Upload className="h-10 w-10 text-primary" />
            ) : (
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
            )}
            <p className="font-medium">
              {isReadonly ? "No file uploaded" : isDragging ? "Drop file here" : "Click or drag to upload"}
            </p>
            {!isReadonly && (
              <p className="text-sm text-muted-foreground">
                {getAcceptedTypesDisplay(acceptedTypes)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && !isReadonly && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
