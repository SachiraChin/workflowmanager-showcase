/**
 * Controlled file input using a dropzone.
 * Supports drag-and-drop and click to select files.
 */

import { useCallback, useState } from "react";
import { Upload, X, Image as ImageIcon, File } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../utils/cn";
import type { ControlledFileInputProps } from "../../types";
import type { FileInputState } from "../../../types/interaction-state";

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

export function FileInputDropzoneControlled({
  request,
  state,
  onStateChange,
  disabled,
  showSubmitButton = true,
  onSubmit,
}: ControlledFileInputProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use accepted_types from request, or fall back to defaults
  const acceptedTypes = request.accepted_types?.length
    ? request.accepted_types
    : DEFAULT_ACCEPTED_TYPES;

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
        onStateChange({
          ...state,
          filePath: file.name,
          fileData: dataUrl,
          fileName: file.name,
          fileType: file.type,
          isDirty: true,
          isValid: true,
        } as FileInputState);
      };
      reader.onerror = () => {
        setError("Failed to read file");
      };
      reader.readAsDataURL(file);
    },
    [state, onStateChange, acceptedTypes]
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
    onStateChange({
      filePath: "",
      fileData: undefined,
      fileName: undefined,
      fileType: undefined,
      isDirty: false,
      isValid: false,
    });
    setError(null);
  }, [onStateChange]);

  const isImage = state.fileType?.startsWith("image/");

  return (
    <div className="space-y-4">
      {request.title && (
        <h3 className="text-lg font-semibold">{request.title}</h3>
      )}

      {/* File preview or dropzone */}
      {state.fileData ? (
        <div className="relative">
          {isImage ? (
            <div className="relative rounded-lg overflow-hidden border bg-muted/30">
              <img
                src={state.fileData}
                alt={state.fileName || "Uploaded file"}
                className="max-h-[300px] w-full object-contain"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2"
                onClick={handleClear}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
              <File className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{state.fileName}</p>
                <p className="text-sm text-muted-foreground">{state.fileType}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClear}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            {state.fileName}
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleClick}
        >
          <div className="flex flex-col items-center gap-2">
            {isDragging ? (
              <Upload className="h-10 w-10 text-primary" />
            ) : (
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
            )}
            <p className="font-medium">
              {isDragging ? "Drop file here" : "Click or drag to upload"}
            </p>
            <p className="text-sm text-muted-foreground">
              {getAcceptedTypesDisplay(acceptedTypes)}
            </p>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Submit button */}
      {showSubmitButton && onSubmit && (
        <div className="flex gap-2 justify-end pt-2">
          <Button onClick={onSubmit} disabled={disabled || !state.isValid}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
