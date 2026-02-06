/**
 * FilesTreeView - Workflow files viewer as a universal tree.
 *
 * Renders a recursive tree structure from the server.
 * Each node has _meta (display info) and optional children.
 * - Leaf nodes: clickable to view content (JSON/text popup or media preview)
 * - Container nodes: expandable folders with download buttons
 * - Search filters visible nodes
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
  Download,
} from "lucide-react";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { JsonTreeView } from "../../components/ui/json-tree-view";
import { MediaPreviewDialog } from "./MediaPreviewDialog";
import { useWorkflowState } from "../../contexts/WorkflowStateContext";
import { cn } from "../../utils/cn";
import { API_URL } from "../../core/config";
import type { FileTreeNode, TreeNodeMetadata } from "../../types/index";

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

/** Media file info for the preview dialog */
interface MediaFileInfo {
  displayName: string;
  contentType: string;
  contentUrl: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get icon component for a tree node based on _meta.icon.
 */
function getNodeIcon(icon: string | undefined, isOpen: boolean) {
  switch (icon) {
    case "folder":
    case "folder-open":
      return isOpen ? (
        <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
      ) : (
        <Folder className="h-4 w-4 text-amber-500 shrink-0" />
      );
    case "image":
      return <Image className="h-4 w-4 text-green-500 shrink-0" />;
    case "video":
      return <Video className="h-4 w-4 text-purple-500 shrink-0" />;
    case "audio":
      return <Music className="h-4 w-4 text-orange-500 shrink-0" />;
    case "json":
      return <FileJson className="h-4 w-4 text-blue-500 shrink-0" />;
    case "text":
    default:
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

/**
 * Check if a node or its descendants match the search term.
 */
function nodeMatchesSearch(node: FileTreeNode, searchTerm: string): boolean {
  if (!searchTerm) return true;
  const term = searchTerm.toLowerCase();

  // Check this node's display name
  if (node._meta.display_name.toLowerCase().includes(term)) return true;

  // Check children recursively
  if (node.children) {
    return node.children.some((child) => nodeMatchesSearch(child, searchTerm));
  }

  return false;
}

/**
 * Extract all media files from the tree in display order.
 * Used for media preview navigation.
 */
function extractMediaFiles(nodes: FileTreeNode[]): MediaFileInfo[] {
  const mediaFiles: MediaFileInfo[] = [];

  function traverse(node: FileTreeNode): void {
    const { _meta, children } = node;

    if (_meta.leaf && _meta.content_url) {
      const contentType = _meta.content_type || "";
      if (["image", "video", "audio"].includes(contentType)) {
        mediaFiles.push({
          displayName: _meta.display_name,
          contentType,
          contentUrl: _meta.content_url,
        });
      }
    }

    if (children) {
      for (const child of children) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return mediaFiles;
}

/**
 * Count total leaf nodes (files) in a tree.
 */
function countFiles(node: FileTreeNode): number {
  if (node._meta.leaf) return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
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
      await navigator.clipboard.writeText(
        text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      );
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
// Download Button Component
// =============================================================================

interface DownloadButtonProps {
  downloadUrl?: string;
  title?: string;
  className?: string;
}

function DownloadButton({ downloadUrl, title, className }: DownloadButtonProps) {
  if (!downloadUrl) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // downloadUrl is relative, prepend API_URL
    const fullUrl = `${API_URL}${downloadUrl}`;
    window.open(fullUrl, "_blank");
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted transition-all",
        className
      )}
      title={title || "Download"}
    >
      <Download className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

// =============================================================================
// Tree Node Component (Recursive)
// =============================================================================

interface TreeNodeComponentProps {
  node: FileTreeNode;
  level: number;
  searchTerm: string;
  onLeafClick: (meta: TreeNodeMetadata) => void;
  /** Currently previewed content URL (for highlighting) */
  previewingContentUrl?: string | null;
}

function TreeNodeComponent({
  node,
  level,
  searchTerm,
  onLeafClick,
  previewingContentUrl,
}: TreeNodeComponentProps) {
  const { _meta, children } = node;
  const [isOpen, setIsOpen] = useState(_meta.default_open || false);

  const hasMatchingDescendant = useMemo(
    () => nodeMatchesSearch(node, searchTerm),
    [node, searchTerm]
  );

  // Auto-expand if search matches descendant
  const effectiveIsOpen = isOpen || (!!searchTerm && hasMatchingDescendant);

  const keyMatches =
    searchTerm &&
    _meta.display_name.toLowerCase().includes(searchTerm.toLowerCase());

  const isLeaf = _meta.leaf;
  const isPreviewing = previewingContentUrl === _meta.content_url;
  const fileCount = !isLeaf ? countFiles(node) : 0;

  // Handle click
  const handleClick = () => {
    if (isLeaf) {
      onLeafClick(_meta);
    } else {
      setIsOpen((prev) => !prev);
    }
  };

  return (
    <div className="select-none">
      <div
        className={cn(
          "group flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30",
          isPreviewing && "bg-primary/20 ring-1 ring-primary/50"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse chevron for containers */}
        {!isLeaf && (
          effectiveIsOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )
        )}

        {/* Icon */}
        {getNodeIcon(_meta.icon, effectiveIsOpen)}

        {/* Display name */}
        <span
          className={cn(
            "font-mono text-sm flex-1",
            isLeaf ? "text-foreground" : "text-primary font-medium",
            keyMatches && "font-bold"
          )}
        >
          {_meta.display_name}
        </span>

        {/* File count for containers */}
        {!isLeaf && fileCount > 0 && (
          <span className="text-muted-foreground text-xs">({fileCount})</span>
        )}

        {/* Download button */}
        <DownloadButton
          downloadUrl={_meta.download_url}
          title={isLeaf ? "Download" : `Download ${_meta.display_name}`}
        />
      </div>

      {/* Children (if expanded) */}
      {!isLeaf && effectiveIsOpen && children && (
        <div className="border-l border-border/50 ml-4">
          {children.map((child, index) => (
            <TreeNodeComponent
              key={`${child._meta.display_name}-${index}`}
              node={child}
              level={level + 1}
              searchTerm={searchTerm}
              onLeafClick={onLeafClick}
              previewingContentUrl={previewingContentUrl}
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
  const { files, isConnected, fetchFileContent } = useWorkflowState();

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
  const [mediaPreviewIndex, setMediaPreviewIndex] = useState<number | null>(
    null
  );

  // Cast files to the new TreeNode array structure
  const fileTree = files as FileTreeNode[] | null;

  // Extract all media files from tree in display order
  const allMediaFiles = useMemo(() => {
    if (!fileTree || !Array.isArray(fileTree)) return [];
    return extractMediaFiles(fileTree);
  }, [fileTree]);

  // Build a map from content URL to index for quick lookup
  const mediaFileIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    allMediaFiles.forEach((file, index) => {
      map.set(file.contentUrl, index);
    });
    return map;
  }, [allMediaFiles]);

  // Handle leaf node click
  const handleLeafClick = useCallback(
    async (meta: TreeNodeMetadata) => {
      const contentType = meta.content_type || "text";
      const isMedia = ["image", "video", "audio"].includes(contentType);

      if (isMedia && meta.content_url) {
        // Media files open in the media preview dialog
        const index = mediaFileIndexMap.get(meta.content_url);
        if (index !== undefined) {
          setMediaPreviewIndex(index);
        }
        return;
      }

      // Regular files (JSON/text) open in the content popup
      setPopup({
        open: true,
        filename: meta.display_name,
        content: null,
        contentType,
        loading: true,
      });

      // Extract file_id from content_url (e.g., /workflow/{id}/files/{file_id})
      const fileIdMatch = meta.content_url?.match(/\/files\/([^/]+)$/);
      const fileId = fileIdMatch?.[1];

      if (fileId) {
        const fileContent = await fetchFileContent(fileId);
        setPopup((prev) => ({
          ...prev,
          content: fileContent?.content ?? null,
          loading: false,
        }));
      } else {
        setPopup((prev) => ({
          ...prev,
          content: "Unable to load content",
          loading: false,
        }));
      }
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
    setMediaPreviewIndex((prev) =>
      prev !== null && prev > 0 ? prev - 1 : prev
    );
  }, []);

  const handleMediaNext = useCallback(() => {
    setMediaPreviewIndex((prev) =>
      prev !== null && prev < allMediaFiles.length - 1 ? prev + 1 : prev
    );
  }, [allMediaFiles.length]);

  // Get the content URL of currently previewing media (for highlighting in tree)
  const previewingContentUrl =
    mediaPreviewIndex !== null
      ? allMediaFiles[mediaPreviewIndex]?.contentUrl ?? null
      : null;

  // Get current media file for preview dialog
  const currentMediaFile =
    mediaPreviewIndex !== null ? allMediaFiles[mediaPreviewIndex] : null;

  // Render tree content
  const renderTreeContent = () => {
    if (!fileTree || !Array.isArray(fileTree) || fileTree.length === 0) {
      return (
        <div className="text-sm text-muted-foreground italic py-2">
          No files yet
        </div>
      );
    }

    return fileTree.map((node, index) => (
      <TreeNodeComponent
        key={`${node._meta.display_name}-${index}`}
        node={node}
        level={0}
        searchTerm={searchTerm}
        onLeafClick={handleLeafClick}
        previewingContentUrl={previewingContentUrl}
      />
    ));
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
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setIsMaximized(true)}
                className="p-1 hover:bg-muted rounded opacity-60 hover:opacity-100 transition-opacity"
                title="Maximize"
              >
                <Maximize2 className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
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
            <CopyButton
              value={popup.content}
              className="absolute top-4 right-12"
            />
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
                <JsonTreeView
                  data={popup.content as object}
                  defaultExpandDepth={2}
                />
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
      {currentMediaFile && (
        <MediaPreviewDialog
          open={mediaPreviewIndex !== null}
          onOpenChange={(open) => !open && handleCloseMediaPreview()}
          file={{
            file_id: currentMediaFile.contentUrl,
            filename: currentMediaFile.displayName,
            content_type: currentMediaFile.contentType,
            url: currentMediaFile.contentUrl,
          }}
          currentIndex={mediaPreviewIndex ?? 0}
          totalCount={allMediaFiles.length}
          onPrevious={handleMediaPrevious}
          onNext={handleMediaNext}
        />
      )}
    </>
  );
}
