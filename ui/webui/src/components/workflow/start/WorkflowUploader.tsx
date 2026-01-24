/**
 * WorkflowUploader - File upload component for workflow JSON/ZIP files.
 *
 * Handles:
 * - Drag and drop file upload
 * - Click to upload
 * - JSON file validation
 * - ZIP file processing (finds root JSON files)
 * - Entry point selection for ZIP files
 */

import { useState, useCallback, useRef } from "react";
import { Upload, Archive, FileJson, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import JSZip from "jszip";

// =============================================================================
// Types
// =============================================================================

type UploadedFileType = "json" | "zip" | null;

export interface UploadedWorkflow {
  file: File;
  fileType: UploadedFileType;
  content: string; // JSON string for json, base64 for zip
  entryPoint: string; // Only used for zip files
  zipJsonFiles: string[]; // Available JSON files in zip root
}

interface WorkflowUploaderProps {
  /** Current uploaded workflow (controlled) */
  value: UploadedWorkflow | null;
  /** Called when workflow is uploaded or cleared */
  onChange: (workflow: UploadedWorkflow | null) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
  /** Whether the uploader is disabled */
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowUploader({
  value,
  onChange,
  onError,
  disabled,
}: WorkflowUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Process uploaded file
  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);

      try {
        if (file.name.endsWith(".json")) {
          // JSON file - read as text and validate
          const text = await file.text();
          JSON.parse(text); // Validate JSON

          onChange({
            file,
            fileType: "json",
            content: text,
            entryPoint: "",
            zipJsonFiles: [],
          });
        } else if (file.name.endsWith(".zip")) {
          // ZIP file - read and find root .json files
          const arrayBuffer = await file.arrayBuffer();
          const zip = await JSZip.loadAsync(arrayBuffer);

          // Collect all file paths (normalize to forward slashes)
          const allFiles: string[] = [];
          zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir) {
              allFiles.push(relativePath.replace(/\\/g, "/"));
            }
          });

          // Find .json files at root level (no "/" in path)
          let rootJsonFiles = allFiles.filter(
            (path) => path.endsWith(".json") && !path.includes("/")
          );

          // If no root json files, check if zip has a single parent folder
          if (rootJsonFiles.length === 0 && allFiles.length > 0) {
            const firstFile = allFiles[0];
            const firstSlashIndex = firstFile.indexOf("/");
            if (firstSlashIndex > 0) {
              const possiblePrefix = firstFile.substring(0, firstSlashIndex + 1);
              const allSharePrefix = allFiles.every((f) =>
                f.startsWith(possiblePrefix)
              );

              if (allSharePrefix) {
                rootJsonFiles = allFiles.filter((path) => {
                  const relPath = path.substring(possiblePrefix.length);
                  return relPath.endsWith(".json") && !relPath.includes("/");
                });
              }
            }
          }

          // Convert to base64
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ""
            )
          );

          // Auto-select if only one json file
          const autoEntryPoint =
            rootJsonFiles.length === 1 ? rootJsonFiles[0] : "";

          onChange({
            file,
            fileType: "zip",
            content: base64,
            entryPoint: autoEntryPoint,
            zipJsonFiles: rootJsonFiles,
          });
        } else {
          throw new Error("Please upload a .json or .zip file");
        }
      } catch (err) {
        onError?.((err as Error).message);
        onChange(null);
      } finally {
        setIsProcessing(false);
      }
    },
    [onChange, onError]
  );

  // Handle file input change
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  // Clear uploaded file
  const handleClear = useCallback(() => {
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [onChange]);

  // Update entry point for zip files
  const handleEntryPointChange = useCallback(
    (entryPoint: string) => {
      if (value) {
        onChange({ ...value, entryPoint });
      }
    },
    [value, onChange]
  );

  // Render dropzone when no file uploaded
  if (!value) {
    return (
      <div className="space-y-4">
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          onClick={() => !disabled && fileInputRef.current?.click()}
          onDragOver={!disabled ? handleDragOver : undefined}
          onDragLeave={!disabled ? handleDragLeave : undefined}
          onDrop={!disabled ? handleDrop : undefined}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip"
            onChange={handleFileSelect}
            className="hidden"
            disabled={disabled}
          />
          <div className="flex flex-col items-center gap-2">
            <Upload
              className={`h-10 w-10 ${
                isDragging ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <p className="font-medium">
              {isDragging ? "Drop file here" : "Drag & drop or click to upload"}
            </p>
            <p className="text-sm text-muted-foreground">
              .json (resolved workflow) or .zip (workflow folder)
            </p>
          </div>
        </div>

        {isProcessing && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Processing file...</span>
          </div>
        )}
      </div>
    );
  }

  // Render uploaded file info
  return (
    <div className="space-y-4">
      {/* File info */}
      <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
        {value.fileType === "zip" ? (
          <Archive className="h-8 w-8 text-muted-foreground" />
        ) : (
          <FileJson className="h-8 w-8 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{value.file.name}</p>
          <p className="text-sm text-muted-foreground">
            {value.fileType === "zip" ? "ZIP Archive" : "JSON File"}
            {value.fileType === "zip" && value.zipJsonFiles.length > 0 && (
              <span> • {value.zipJsonFiles.length} JSON file(s) at root</span>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={disabled}
        >
          Change
        </Button>
      </div>

      {/* Entry point selection for zip files */}
      {value.fileType === "zip" && (
        <div className="space-y-2">
          <Label htmlFor="entry-point">Entry Point (main workflow file)</Label>
          <Input
            id="entry-point"
            list="json-files-list"
            placeholder="e.g., workflow.json"
            value={value.entryPoint}
            onChange={(e) => handleEntryPointChange(e.target.value)}
            disabled={disabled}
          />
          {value.zipJsonFiles.length > 0 && (
            <datalist id="json-files-list">
              {value.zipJsonFiles.map((file) => (
                <option key={file} value={file} />
              ))}
            </datalist>
          )}
          <p className="text-xs text-muted-foreground">
            {value.zipJsonFiles.length > 0
              ? "Select from detected files or type a custom path"
              : "Enter the path to the main workflow file"}
          </p>
        </div>
      )}
    </div>
  );
}
