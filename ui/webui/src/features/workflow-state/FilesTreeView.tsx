/**
 * FilesTreeView - Workflow files viewer as a tree.
 *
 * Shows workflow files (API calls, outputs, generated media) in a collapsible
 * tree structure.
 * - Dynamic hierarchy based on data (branches, categories, steps, groups)
 * - Click file to view content in popup (JSON/text) or media preview
 * - Search functionality
 * - Maximizable view
 */

import { useState, useCallback, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileJson,
  FileText,
  Search,
  Maximize2,
  Copy,
  Check,
  FolderOpen,
  Folder,
  Image,
  Video,
  Music,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JsonTreeView } from "@/components/ui/json-tree-view";
import { MediaPreviewDialog } from "./MediaPreviewDialog";
import { useWorkflowStateContext } from "@/state/WorkflowStateContext";
import { cn } from "@/core/utils";
import type { WorkflowFile, FileGroup } from "@/core/types";

// =============================================================================
// Types
// =============================================================================

interface FilePopupState {
  open: boolean;
  filename: string;
  content: unknown;
  contentType: string;
  loading: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a value is an array of WorkflowFile objects.
 */
function isFileArray(value: unknown): value is WorkflowFile[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return value[0] && typeof value[0] === "object" && "file_id" in value[0];
}

/**
 * Check if a value is an array of FileGroup objects.
 */
function isGroupArray(value: unknown): value is FileGroup[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;
  return value[0] && typeof value[0] === "object" && "group_id" in value[0];
}

/**
 * Format ISO timestamp to user-friendly date string.
 */
function formatDate(isoString: string | null): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/**
 * Check if a node or its descendants match the search term.
 */
function nodeMatchesSearch(key: string, value: unknown, searchTerm: string): boolean {
  if (!searchTerm) return true;
  const term = searchTerm.toLowerCase();

  if (key.toLowerCase().includes(term)) return true;

  if (isFileArray(value)) {
    return value.some((f) => f.filename.toLowerCase().includes(term));
  }

  if (isGroupArray(value)) {
    return value.some((g) =>
      g.files.some((f) => f.filename.toLowerCase().includes(term))
    );
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).some(([k, v]) =>
      nodeMatchesSearch(k, v, searchTerm)
    );
  }

  return false;
}

/**
 * Check if a file is a media type (image, video, audio).
 */
function isMediaFile(file: WorkflowFile): boolean {
  return ["image", "video", "audio"].includes(file.content_type);
}

/**
 * Extract all media files from the file tree in display order.
 * Traverses the tree structure recursively to collect media files.
 */
function extractMediaFiles(tree: Record<string, unknown>): WorkflowFile[] {
  const mediaFiles: WorkflowFile[] = [];

  function traverse(value: unknown): void {
    if (isFileArray(value)) {
      // Array of files - add media files
      for (const file of value) {
        if (isMediaFile(file)) {
          mediaFiles.push(file);
        }
      }
    } else if (isGroupArray(value)) {
      // Array of groups - traverse each group's files
      for (const group of value) {
        for (const file of group.files) {
          if (isMediaFile(file)) {
            mediaFiles.push(file);
          }
        }
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      // Object (branch, category, step) - traverse children in key order
      for (const key of Object.keys(value)) {
        traverse((value as Record<string, unknown>)[key]);
      }
    }
  }

  traverse(tree);
  return mediaFiles;
}

// =============================================================================
// Copy Button Component
// =============================================================================

interface CopyButtonProps {
  value: unknown;
  className?: string;
}

function CopyButton({ value, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      const text =
        value !== null && typeof value === "object"
          ? JSON.stringify(value, null, 2)
          : String(value);
      await navigator.clipboard.writeText(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1.5 hover:bg-muted rounded opacity-70 hover:opacity-100 transition-opacity",
        className
      )}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}

// =============================================================================
// File Node Component
// =============================================================================

interface FileNodeProps {
  file: WorkflowFile;
  level: number;
  searchTerm: string;
  onFileClick: (file: WorkflowFile) => void;
  /** Currently previewed file ID (for highlighting) */
  previewingFileId?: string | null;
}

function FileNode({ file, level, searchTerm, onFileClick, previewingFileId }: FileNodeProps) {
  const keyMatches =
    searchTerm && file.filename.toLowerCase().includes(searchTerm.toLowerCase());
  const isPreviewing = previewingFileId === file.file_id;

  const isJson = file.content_type === "json" || file.filename.endsWith(".json");
  const isImage = file.content_type === "image";
  const isVideo = file.content_type === "video";
  const isAudio = file.content_type === "audio";

  const getIcon = () => {
    if (isImage) return <Image className="h-4 w-4 text-green-500 shrink-0" />;
    if (isVideo) return <Video className="h-4 w-4 text-purple-500 shrink-0" />;
    if (isAudio) return <Music className="h-4 w-4 text-orange-500 shrink-0" />;
    if (isJson) return <FileJson className="h-4 w-4 text-blue-500 shrink-0" />;
    return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer",
        keyMatches && "bg-yellow-100 dark:bg-yellow-900/30",
        isPreviewing && "bg-primary/20 ring-1 ring-primary/50"
      )}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      onClick={() => onFileClick(file)}
    >
      {getIcon()}
      <span
        className={cn(
          "font-mono text-sm text-foreground",
          keyMatches && "font-bold"
        )}
      >
        {file.filename}
      </span>
    </div>
  );
}

// =============================================================================
// Group Node Component
// =============================================================================

interface GroupNodeProps {
  group: FileGroup;
  level: number;
  searchTerm: string;
  showDate: boolean;
  onFileClick: (file: WorkflowFile) => void;
  previewingFileId?: string | null;
}

function GroupNode({
  group,
  level,
  searchTerm,
  showDate,
  onFileClick,
  previewingFileId,
}: GroupNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasMatchingDescendant = useMemo(
    () => nodeMatchesSearch(group.group_id, group.files, searchTerm),
    [group, searchTerm]
  );

  const effectiveIsOpen = isOpen || (searchTerm && hasMatchingDescendant);

  // Only show date level if showDate is true (multiple groups for this step)
  const displayName = showDate ? formatDate(group.created_at) : null;

  if (!showDate) {
    // No date level - render files directly
    return (
      <>
        {group.files.map((file) => (
          <FileNode
            key={file.file_id}
            file={file}
            level={level}
            searchTerm={searchTerm}
            onFileClick={onFileClick}
            previewingFileId={previewingFileId}
          />
        ))}
      </>
    );
  }

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {effectiveIsOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {effectiveIsOpen ? (
          <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-amber-500 shrink-0" />
        )}
        <span className="font-mono text-sm text-primary">{displayName}</span>
        <span className="text-muted-foreground text-xs">
          ({group.files.length})
        </span>
      </div>

      {effectiveIsOpen && (
        <div className="border-l border-border/50 ml-4">
          {group.files.map((file) => (
            <FileNode
              key={file.file_id}
              file={file}
              level={level + 1}
              searchTerm={searchTerm}
              onFileClick={onFileClick}
              previewingFileId={previewingFileId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Step Node Component (contains groups)
// =============================================================================

interface StepNodeProps {
  stepId: string;
  groups: FileGroup[];
  level: number;
  searchTerm: string;
  onFileClick: (file: WorkflowFile) => void;
  previewingFileId?: string | null;
}

function StepNode({
  stepId,
  groups,
  level,
  searchTerm,
  onFileClick,
  previewingFileId,
}: StepNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasMatchingDescendant = useMemo(
    () => nodeMatchesSearch(stepId, groups, searchTerm),
    [stepId, groups, searchTerm]
  );

  const effectiveIsOpen = isOpen || (searchTerm && hasMatchingDescendant);
  const keyMatches =
    searchTerm && stepId.toLowerCase().includes(searchTerm.toLowerCase());

  const showDate = groups.length > 1;
  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {effectiveIsOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {effectiveIsOpen ? (
          <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-amber-500 shrink-0" />
        )}
        <span
          className={cn(
            "font-mono text-sm text-primary font-medium",
            keyMatches && "font-bold"
          )}
        >
          {stepId}
        </span>
        <span className="text-muted-foreground text-xs">({totalFiles})</span>
      </div>

      {effectiveIsOpen && (
        <div className="border-l border-border/50 ml-4">
          {groups.map((group) => (
            <GroupNode
              key={group.group_id}
              group={group}
              level={level + 1}
              searchTerm={searchTerm}
              showDate={showDate}
              onFileClick={onFileClick}
              previewingFileId={previewingFileId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Category Node Component
// =============================================================================

interface CategoryNodeProps {
  category: string;
  value: unknown;
  level: number;
  searchTerm: string;
  onFileClick: (file: WorkflowFile) => void;
  previewingFileId?: string | null;
}

function CategoryNode({
  category,
  value,
  level,
  searchTerm,
  onFileClick,
  previewingFileId,
}: CategoryNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasMatchingDescendant = useMemo(
    () => nodeMatchesSearch(category, value, searchTerm),
    [category, value, searchTerm]
  );

  const effectiveIsOpen = isOpen || (searchTerm && hasMatchingDescendant);
  const keyMatches =
    searchTerm && category.toLowerCase().includes(searchTerm.toLowerCase());

  // Count total files
  const countFiles = (v: unknown): number => {
    if (isFileArray(v)) return v.length;
    if (isGroupArray(v)) return v.reduce((sum, g) => sum + g.files.length, 0);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.values(v).reduce(
        (sum, child) => sum + countFiles(child),
        0
      );
    }
    return 0;
  };
  const totalFiles = countFiles(value);

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {effectiveIsOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {effectiveIsOpen ? (
          <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-amber-500 shrink-0" />
        )}
        <span
          className={cn(
            "font-mono text-sm text-primary font-medium",
            keyMatches && "font-bold"
          )}
        >
          {category}
        </span>
        <span className="text-muted-foreground text-xs">({totalFiles})</span>
      </div>

      {effectiveIsOpen && (
        <div className="border-l border-border/50 ml-4">
          {isFileArray(value) ? (
            // Direct file list under category
            value.map((file) => (
              <FileNode
                key={file.file_id}
                file={file}
                level={level + 1}
                searchTerm={searchTerm}
                onFileClick={onFileClick}
                previewingFileId={previewingFileId}
              />
            ))
          ) : isGroupArray(value) ? (
            // Groups directly under category (no step_id)
            value.map((group) => (
              <GroupNode
                key={group.group_id}
                group={group}
                level={level + 1}
                searchTerm={searchTerm}
                showDate={value.length > 1}
                onFileClick={onFileClick}
                previewingFileId={previewingFileId}
              />
            ))
          ) : value && typeof value === "object" ? (
            // Step IDs under category
            Object.entries(value).map(([stepId, stepValue]) => {
              if (isGroupArray(stepValue)) {
                return (
                  <StepNode
                    key={stepId}
                    stepId={stepId}
                    groups={stepValue}
                    level={level + 1}
                    searchTerm={searchTerm}
                    onFileClick={onFileClick}
                    previewingFileId={previewingFileId}
                  />
                );
              }
              return null;
            })
          ) : null}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Branch Node Component
// =============================================================================

interface BranchNodeProps {
  branchId: string;
  categories: Record<string, unknown>;
  level: number;
  searchTerm: string;
  onFileClick: (file: WorkflowFile) => void;
  previewingFileId?: string | null;
}

function BranchNode({
  branchId,
  categories,
  level,
  searchTerm,
  onFileClick,
  previewingFileId,
}: BranchNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasMatchingDescendant = useMemo(() => {
    return Object.entries(categories).some(([cat, val]) =>
      nodeMatchesSearch(cat, val, searchTerm)
    );
  }, [categories, searchTerm]);

  const effectiveIsOpen = isOpen || (searchTerm && hasMatchingDescendant);
  const keyMatches =
    searchTerm && branchId.toLowerCase().includes(searchTerm.toLowerCase());

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {effectiveIsOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {effectiveIsOpen ? (
          <FolderOpen className="h-4 w-4 text-purple-500 shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-purple-500 shrink-0" />
        )}
        <span
          className={cn(
            "font-mono text-sm text-primary font-medium",
            keyMatches && "font-bold"
          )}
        >
          {branchId}
        </span>
      </div>

      {effectiveIsOpen && (
        <div className="border-l border-border/50 ml-4">
          {Object.entries(categories).map(([category, value]) => (
            <CategoryNode
              key={category}
              category={category}
              value={value}
              level={level + 1}
              searchTerm={searchTerm}
              onFileClick={onFileClick}
              previewingFileId={previewingFileId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function FilesTreeView() {
  const { files, isConnected, fetchFileContent } = useWorkflowStateContext();

  const [searchTerm, setSearchTerm] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [popup, setPopup] = useState<FilePopupState>({
    open: false,
    filename: "",
    content: null,
    contentType: "text",
    loading: false,
  });
  // Index of currently previewed media file (null = closed)
  const [mediaPreviewIndex, setMediaPreviewIndex] = useState<number | null>(null);

  // Extract all media files from tree in display order
  const allMediaFiles = useMemo(() => {
    if (!files) return [];
    return extractMediaFiles(files as Record<string, unknown>);
  }, [files]);

  // Build a map from file_id to index for quick lookup
  const mediaFileIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    allMediaFiles.forEach((file, index) => {
      map.set(file.file_id, index);
    });
    return map;
  }, [allMediaFiles]);

  const handleFileClick = useCallback(
    async (file: WorkflowFile) => {
      // Media files open in the media preview dialog
      if (isMediaFile(file)) {
        const index = mediaFileIndexMap.get(file.file_id);
        if (index !== undefined) {
          setMediaPreviewIndex(index);
        }
        return;
      }

      // Regular files (JSON/text) open in the content popup
      setPopup({
        open: true,
        filename: file.filename,
        content: null,
        contentType: file.content_type,
        loading: true,
      });

      const fileContent = await fetchFileContent(file.file_id);
      setPopup((prev) => ({
        ...prev,
        content: fileContent?.content ?? null,
        loading: false,
      }));
    },
    [fetchFileContent, mediaFileIndexMap]
  );

  const handleClosePopup = useCallback(() => {
    setPopup((prev) => ({ ...prev, open: false }));
  }, []);

  const handleCloseMediaPreview = useCallback(() => {
    setMediaPreviewIndex(null);
  }, []);

  const handleMediaPrevious = useCallback(() => {
    setMediaPreviewIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);

  const handleMediaNext = useCallback(() => {
    setMediaPreviewIndex((prev) =>
      prev !== null && prev < allMediaFiles.length - 1 ? prev + 1 : prev
    );
  }, [allMediaFiles.length]);

  // Determine if we have multiple branches
  const hasBranches = useMemo(() => {
    if (!files) return false;
    // Check if first-level keys look like branch IDs (contain categories as values)
    const firstValue = Object.values(files)[0];
    return (
      firstValue &&
      typeof firstValue === "object" &&
      !Array.isArray(firstValue) &&
      !("file_id" in firstValue) &&
      !("group_id" in firstValue)
    );
  }, [files]);

  // Get the file_id of currently previewing media (for highlighting in tree)
  const previewingFileId = mediaPreviewIndex !== null
    ? allMediaFiles[mediaPreviewIndex]?.file_id ?? null
    : null;

  // Render tree content
  const renderTreeContent = () => {
    if (!files || Object.keys(files).length === 0) {
      return (
        <div className="text-sm text-muted-foreground italic py-2">
          No files yet
        </div>
      );
    }

    if (hasBranches) {
      // Multiple branches - branch level at root
      return Object.entries(files).map(([branchId, categories]) => (
        <BranchNode
          key={branchId}
          branchId={branchId}
          categories={categories as Record<string, unknown>}
          level={0}
          searchTerm={searchTerm}
          onFileClick={handleFileClick}
          previewingFileId={previewingFileId}
        />
      ));
    } else {
      // Single branch - categories at root
      return Object.entries(files).map(([category, value]) => (
        <CategoryNode
          key={category}
          category={category}
          value={value}
          level={0}
          searchTerm={searchTerm}
          onFileClick={handleFileClick}
          previewingFileId={previewingFileId}
        />
      ));
    }
  };

  return (
    <>
      <Card className="flex flex-col flex-1 min-h-0 gap-0 pb-0 overflow-hidden">
        <CardHeader className="pb-2 shrink-0">
          <CardTitle className="text-sm flex items-center gap-2">
            Workflow Files
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isConnected ? "bg-green-500" : "bg-muted"
              )}
              title={isConnected ? "Connected" : "Disconnected"}
            />
            <button
              onClick={() => setIsMaximized(true)}
              className="ml-auto p-1 hover:bg-muted rounded opacity-60 hover:opacity-100 transition-opacity"
              title="Maximize"
            >
              <Maximize2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-3 flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-inner">
            {renderTreeContent()}
          </div>
        </CardContent>
      </Card>

      {/* File Content Popup Dialog */}
      <Dialog open={popup.open} onOpenChange={handleClosePopup}>
        <DialogContent size="medium" className="flex flex-col overflow-hidden">
          {!popup.loading && popup.content !== null ? (
            <CopyButton value={popup.content} className="absolute top-4 right-12" />
          ) : null}
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-mono text-sm pr-16">
              {popup.filename}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-inner">
            {popup.loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : popup.content !== null && typeof popup.content === "object" ? (
              <div className="bg-muted p-4 rounded">
                <JsonTreeView data={popup.content as object} defaultExpandDepth={2} />
              </div>
            ) : (
              <pre className="text-sm bg-muted p-4 rounded whitespace-pre-wrap break-words">
                {String(popup.content ?? "")}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Maximized Files Tree Dialog */}
      <Dialog open={isMaximized} onOpenChange={setIsMaximized}>
        <DialogContent
          size="full"
          className="h-[80vh] max-h-[80vh] flex flex-col overflow-hidden"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm flex items-center gap-2">
              Workflow Files
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  isConnected ? "bg-green-500" : "bg-muted"
                )}
                title={isConnected ? "Connected" : "Disconnected"}
              />
            </DialogTitle>
          </DialogHeader>
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-inner pr-2">
            {renderTreeContent()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Media Preview Dialog (images, videos, audio) */}
      <MediaPreviewDialog
        open={mediaPreviewIndex !== null}
        onOpenChange={(open) => !open && handleCloseMediaPreview()}
        file={mediaPreviewIndex !== null ? allMediaFiles[mediaPreviewIndex] : null}
        currentIndex={mediaPreviewIndex ?? 0}
        totalCount={allMediaFiles.length}
        onPrevious={handleMediaPrevious}
        onNext={handleMediaNext}
      />
    </>
  );
}
