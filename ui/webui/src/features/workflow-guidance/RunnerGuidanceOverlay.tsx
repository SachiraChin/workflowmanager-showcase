/**
 * RunnerGuidanceOverlay - Toggle-able help overlay for workflow runner page.
 *
 * When active, displays:
 * - Semi-transparent backdrop (30% opacity)
 * - Highlighted regions around key UI areas with inner borders
 * - Collapsible callout badges that expand on hover to show descriptions
 * - Special connectors for Exit and Guide buttons
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface GuidanceItem {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  /** Where the badge appears relative to target */
  badgePosition: "top" | "bottom" | "left" | "right" | "custom-exit" | "custom-guide";
}

const GUIDANCE_ITEMS: GuidanceItem[] = [
  {
    id: "guide-button",
    targetSelector: '[data-guidance="guide-button"]',
    title: "Guide",
    description: `Opens this help overlay.

Click anywhere on the backdrop to close.
Use the Guide button to reopen anytime.`,
    badgePosition: "custom-guide",
  },
  {
    id: "debug-toggle",
    targetSelector: '[data-guidance="debug-toggle"]',
    title: "Debug Mode (Experimental)",
    description: `Enables debug inspection tools for development.

• Inspect UI nodes and their schemas
• View raw rendering data and state
• Only affects the active view session
• Changes are NOT persisted to the workflow`,
    badgePosition: "bottom",
  },
  {
    id: "model-selector",
    targetSelector: '[data-guidance="model-selector"]',
    title: "Model",
    description: `Select the AI model for LLM interactions.

• Switch models at any point during the workflow
• Selection applies to all subsequent LLM calls
• Supports OpenAI (GPT-4o, o1, o3) and Anthropic (Claude)
• "Default" uses the workflow's configured model`,
    badgePosition: "right",
  },
  {
    id: "exit-button",
    targetSelector: '[data-guidance="exit-button"]',
    title: "Exit",
    description: `Leave the current workflow run.

• Returns to the start page
• Workflow state is automatically preserved
• Resume anytime from the Runs tab`,
    badgePosition: "custom-exit",
  },
  {
    id: "view-mode-toggle",
    targetSelector: '[data-guidance="view-mode-toggle"]',
    title: "View Mode",
    description: `Toggle between interaction display modes.

Single (Recommended):
  Focused view of one interaction at a time.
  Best for active workflow input.

Scroll (Experimental):
  All interactions in a scrollable timeline.
  Best for reviewing the full run history.`,
    badgePosition: "bottom",
  },
  {
    id: "state-tab",
    targetSelector: '[data-guidance="state-tab"]',
    title: "State",
    description: `Full workflow state inspector.

• Complete state tree with all variables
• Interaction request/response data
• Everything sent to and received from the server
• Useful for debugging and understanding data flow`,
    badgePosition: "bottom",
  },
  {
    id: "files-tab",
    targetSelector: '[data-guidance="files-tab"]',
    title: "Files",
    description: `Workflow file browser.

• Raw LLM/API request and response files
• Generated media artifacts (images, audio, video)
• Files appear as they are created during the run
• Download or preview any generated content`,
    badgePosition: "bottom",
  },
  {
    id: "interaction-panel",
    targetSelector: '[data-guidance="interaction-panel"]',
    title: "Workflow Panel",
    description: `Primary interaction area.

This is where the workflow executes:
• Each step presents an interaction request
• Submit responses to advance the workflow
• View LLM outputs and generated content
• The iterative process continues until completion`,
    badgePosition: "left",
  },
];

const ARROW_HEAD_SIZE = 6;
const GAP = 16;

interface ConnectorLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  arrowPoints: string;
}

/**
 * Calculate SVG line coordinates from badge to target element
 */
function getConnectorLine(
  targetRect: TargetRect,
  badgePosition: "top" | "bottom" | "left" | "right",
  badgeRef: React.RefObject<HTMLDivElement | null>
): ConnectorLine | null {
  const badgeEl = badgeRef.current;
  if (!badgeEl) return null;

  const badgeRect = badgeEl.getBoundingClientRect();
  let x1: number, y1: number, x2: number, y2: number;
  let arrowPoints: string;

  switch (badgePosition) {
    case "top":
      // Badge above target, line goes down
      x1 = badgeRect.left + badgeRect.width / 2;
      y1 = badgeRect.bottom;
      x2 = targetRect.left + targetRect.width / 2;
      y2 = targetRect.top;
      arrowPoints = `${x2 - ARROW_HEAD_SIZE},${y2 - 8} ${x2 + ARROW_HEAD_SIZE},${y2 - 8} ${x2},${y2}`;
      break;
    case "bottom":
      // Badge below target, line goes up
      x1 = badgeRect.left + badgeRect.width / 2;
      y1 = badgeRect.top;
      x2 = targetRect.left + targetRect.width / 2;
      y2 = targetRect.top + targetRect.height;
      arrowPoints = `${x2 - ARROW_HEAD_SIZE},${y2 + 8} ${x2 + ARROW_HEAD_SIZE},${y2 + 8} ${x2},${y2}`;
      break;
    case "left":
      // Badge left of target, line goes right
      x1 = badgeRect.right;
      y1 = badgeRect.top + badgeRect.height / 2;
      x2 = targetRect.left;
      y2 = targetRect.top + targetRect.height / 2;
      arrowPoints = `${x2 - 8},${y2 - ARROW_HEAD_SIZE} ${x2 - 8},${y2 + ARROW_HEAD_SIZE} ${x2},${y2}`;
      break;
    case "right":
      // Badge right of target, line goes left
      x1 = badgeRect.left;
      y1 = badgeRect.top + badgeRect.height / 2;
      x2 = targetRect.left + targetRect.width;
      y2 = targetRect.top + targetRect.height / 2;
      arrowPoints = `${x2 + 8},${y2 - ARROW_HEAD_SIZE} ${x2 + 8},${y2 + ARROW_HEAD_SIZE} ${x2},${y2}`;
      break;
  }

  return { x1, y1, x2, y2, arrowPoints };
}

function getBadgePosition(
  rect: TargetRect,
  badgePosition: "top" | "bottom" | "left" | "right"
): React.CSSProperties {
  switch (badgePosition) {
    case "top":
      return {
        position: "fixed",
        bottom: `calc(100vh - ${rect.top}px + ${GAP}px)`,
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%)",
      };
    case "bottom":
      return {
        position: "fixed",
        top: rect.top + rect.height + GAP,
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%)",
      };
    case "left":
      return {
        position: "fixed",
        top: rect.top + rect.height / 2,
        right: `calc(100vw - ${rect.left}px + ${GAP}px)`,
        transform: "translateY(-50%)",
      };
    case "right":
      return {
        position: "fixed",
        top: rect.top + rect.height / 2,
        left: rect.left + rect.width + GAP,
        transform: "translateY(-50%)",
      };
  }
}

interface CollapsibleBadgeProps {
  item: GuidanceItem;
  targetRect: TargetRect | null;
  viewModeRect?: TargetRect | null;
  debugToggleRect?: TargetRect | null;
}

function CollapsibleBadge({ item, targetRect, viewModeRect, debugToggleRect }: CollapsibleBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const badgeRef = useRef<HTMLDivElement>(null);
  const [connectorLine, setConnectorLine] = useState<ConnectorLine | null>(null);

  // Determine if this is a standard badge position (not custom)
  const isStandardPosition = !item.badgePosition.startsWith("custom-");

  // Update connector line position when badge renders or expands (only for standard positions)
  useEffect(() => {
    if (!isStandardPosition || !targetRect) return;

    const updateLine = () => {
      const line = getConnectorLine(targetRect, item.badgePosition as "top" | "bottom" | "left" | "right", badgeRef);
      setConnectorLine(line);
    };
    // Small delay to ensure badge has rendered
    const timeout = setTimeout(updateLine, 10);
    return () => clearTimeout(timeout);
  }, [targetRect, item.badgePosition, isExpanded, isStandardPosition]);

  if (!targetRect) return null;

  // Badge content component (reused across all badge types)
  const badgeContent = (
    <div
      className={`
        rounded-md border-2 border-amber-400 bg-amber-50 shadow-lg
        transition-all duration-200 ease-out
        dark:border-amber-500 dark:bg-amber-950
        ${isExpanded ? "p-3" : "px-2 py-1"}
      `}
      style={{
        maxWidth: isExpanded ? "320px" : "auto",
        whiteSpace: isExpanded ? "pre-line" : "nowrap",
      }}
    >
      <h4
        className={`
          font-semibold text-amber-900 dark:text-amber-100
          ${isExpanded ? "mb-2 text-sm" : "text-xs"}
        `}
      >
        {item.title}
      </h4>
      {isExpanded && (
        <div className="text-xs leading-relaxed text-amber-800 dark:text-amber-200 animate-in fade-in duration-150">
          {item.description}
        </div>
      )}
    </div>
  );

  // Special handling for guide button - position below debug mode button with vertical line
  if (item.badgePosition === "custom-guide") {
    if (!debugToggleRect) return null;

    // Position below debug toggle badge
    const debugBadgeBottom = debugToggleRect.top + debugToggleRect.height + GAP;
    const badgeTop = debugBadgeBottom + 40; // Below debug badge
    const badgeCenterX = targetRect.left + targetRect.width / 2;

    // Guide button bottom
    const guideButtonBottom = targetRect.top + targetRect.height;

    // Line coordinates
    const lineX = badgeCenterX;
    const lineStartY = badgeTop;
    const lineEndY = guideButtonBottom;

    return (
      <>
        {/* Vertical connector line from badge to guide button */}
        <svg
          className="pointer-events-none fixed inset-0 z-[69] h-full w-full"
        >
          <line
            x1={lineX}
            y1={lineStartY}
            x2={lineX}
            y2={lineEndY}
            stroke="rgb(251 191 36)"
            strokeWidth="2"
          />
          {/* Arrow head pointing up at guide button */}
          <polygon
            points={`${lineX - ARROW_HEAD_SIZE},${lineEndY + 8} ${lineX + ARROW_HEAD_SIZE},${lineEndY + 8} ${lineX},${lineEndY}`}
            fill="rgb(251 191 36)"
          />
        </svg>

        {/* Badge */}
        <div
          className={`cursor-pointer ${isExpanded ? "z-[80]" : "z-[70]"}`}
          style={{
            position: "fixed",
            top: badgeTop,
            left: badgeCenterX,
            transform: "translateX(-50%)",
          }}
          onMouseEnter={() => setIsExpanded(true)}
          onMouseLeave={() => setIsExpanded(false)}
        >
          {badgeContent}
        </div>
      </>
    );
  }

  // Special handling for exit button - position parallel to view mode badge but to the right
  if (item.badgePosition === "custom-exit") {
    if (!viewModeRect) return null;

    // Same vertical level as View Mode badge (which is below the view mode button)
    const badgeTop = viewModeRect.top + viewModeRect.height + GAP;
    // Position to the right of View Mode badge
    const badgeLeft = viewModeRect.left + viewModeRect.width + GAP;

    // Exit button position - connect to TOP of exit button
    const exitCenterX = targetRect.left + targetRect.width / 2;
    const exitTop = targetRect.top;

    // Horizontal line Y position - above both buttons
    const horizontalLineY = Math.min(targetRect.top, viewModeRect.top) - 15;

    // Badge top center (where line starts) - estimate badge width ~30px for collapsed state
    const badgeWidth = 30;
    const badgeStartX = badgeLeft + badgeWidth / 2;
    const badgeStartY = badgeTop;

    // Path: start at top center of badge, go up to horizontal line, go left to above exit button, go down to top of exit button
    const path = `M ${badgeStartX} ${badgeStartY} 
                  L ${badgeStartX} ${horizontalLineY} 
                  L ${exitCenterX} ${horizontalLineY} 
                  L ${exitCenterX} ${exitTop}`;

    return (
      <>
        {/* L-shaped connector - rendered separately to avoid transform issues */}
        <svg
          className="pointer-events-none fixed inset-0 z-[69] h-full w-full"
        >
          <path
            d={path}
            fill="none"
            stroke="rgb(251 191 36)"
            strokeWidth="2"
          />
          {/* Arrow head pointing down at top of exit button */}
          <polygon
            points={`${exitCenterX - ARROW_HEAD_SIZE},${exitTop - 8} ${exitCenterX + ARROW_HEAD_SIZE},${exitTop - 8} ${exitCenterX},${exitTop}`}
            fill="rgb(251 191 36)"
          />
        </svg>

        {/* Badge */}
        <div
          className={`cursor-pointer ${isExpanded ? "z-[80]" : "z-[70]"}`}
          style={{
            position: "fixed",
            top: badgeTop,
            left: badgeLeft,
          }}
          onMouseEnter={() => setIsExpanded(true)}
          onMouseLeave={() => setIsExpanded(false)}
        >
          {badgeContent}
        </div>
      </>
    );
  }

  // Standard badge positions (top, bottom, left, right)
  const positionStyle = getBadgePosition(targetRect, item.badgePosition as "top" | "bottom" | "left" | "right");

  return (
    <>
      {/* SVG connector line */}
      {connectorLine && (
        <svg className="pointer-events-none fixed inset-0 z-[69] h-full w-full">
          <line
            x1={connectorLine.x1}
            y1={connectorLine.y1}
            x2={connectorLine.x2}
            y2={connectorLine.y2}
            stroke="rgb(251 191 36)"
            strokeWidth="2"
          />
          <polygon
            points={connectorLine.arrowPoints}
            fill="rgb(251 191 36)"
          />
        </svg>
      )}

      {/* Badge */}
      <div
        ref={badgeRef}
        className={`cursor-pointer ${isExpanded ? "z-[80]" : "z-[70]"}`}
        style={positionStyle as React.CSSProperties}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        {badgeContent}
      </div>
    </>
  );
}

interface HighlightRingProps {
  rect: TargetRect;
}

function HighlightRing({ rect }: HighlightRingProps) {
  // Use inset box-shadow for inner border effect
  return (
    <div
      className="pointer-events-none fixed z-[60] rounded"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        boxShadow: "inset 0 0 0 2px rgb(251 191 36)",
      }}
    />
  );
}

// LocalStorage key for tracking if user has seen the guide
const GUIDE_SEEN_KEY = "workflow-runner-guide-seen";

// Check if user has seen the guide before
function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

// Mark guide as seen
function markGuideSeen(): void {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, "true");
  } catch {
    // Ignore storage errors
  }
}

// Shared state for overlay visibility (allows header button to control it)
// Initialize to true if user hasn't seen the guide before
let overlayOpenState = !hasSeenGuide();
let overlayListeners: Array<(isOpen: boolean) => void> = [];

function setOverlayOpen(isOpen: boolean) {
  overlayOpenState = isOpen;
  // Mark as seen when closing (user has now seen it)
  if (!isOpen) {
    markGuideSeen();
  }
  overlayListeners.forEach((listener) => listener(isOpen));
}

function useOverlayState() {
  const [isOpen, setIsOpen] = useState(overlayOpenState);

  useEffect(() => {
    const listener = (newState: boolean) => setIsOpen(newState);
    overlayListeners.push(listener);
    return () => {
      overlayListeners = overlayListeners.filter((l) => l !== listener);
    };
  }, []);

  return [isOpen, setOverlayOpen] as const;
}

/** Button component to trigger the guide overlay - used in header */
export function RunnerGuideButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1"
      onClick={() => setOverlayOpen(true)}
      title="Show runner guide"
    >
      <HelpCircle className="h-4 w-4" />
      <span className="text-xs">Guide</span>
    </Button>
  );
}

/** Overlay component - renders the actual overlay when open */
export function RunnerGuidanceOverlay() {
  const [isOpen, setIsOpen] = useOverlayState();
  const [targetRects, setTargetRects] = useState<Record<string, TargetRect | null>>({});
  const wasPageFocusedRef = useRef(true);

  // Track window focus state
  useEffect(() => {
    const handleFocus = () => {
      // Small delay to allow click events to process first
      setTimeout(() => {
        wasPageFocusedRef.current = true;
      }, 100);
    };

    const handleBlur = () => {
      wasPageFocusedRef.current = false;
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Update target positions when overlay opens or window resizes
  useEffect(() => {
    if (!isOpen) return;

    const updateRects = () => {
      const rects: Record<string, TargetRect | null> = {};
      for (const item of GUIDANCE_ITEMS) {
        const el = document.querySelector(item.targetSelector);
        if (el) {
          const rect = el.getBoundingClientRect();
          rects[item.id] = {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          };
        } else {
          rects[item.id] = null;
        }
      }
      setTargetRects(rects);
    };

    updateRects();
    window.addEventListener("resize", updateRects);
    window.addEventListener("scroll", updateRects, true);

    return () => {
      window.removeEventListener("resize", updateRects);
      window.removeEventListener("scroll", updateRects, true);
    };
  }, [isOpen]);

  // Handle backdrop click - only close if page was already focused
  const handleBackdropClick = () => {
    if (wasPageFocusedRef.current) {
      setIsOpen(false);
    }
  };

  if (!isOpen) return null;

  const overlayContent = (
    <>
      {/* Backdrop - 30% opacity */}
      <div
        className="fixed inset-0 z-50 bg-black/30"
        onClick={handleBackdropClick}
      />

      {/* Center instruction panel - muted styling */}
      <div className="fixed left-1/2 top-1/2 z-[65] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-amber-300/50 bg-background/95 px-6 py-4 shadow-lg dark:border-amber-700/50">
        <p className="text-center text-sm text-muted-foreground">
          Hover on each label to see details
        </p>
      </div>

      {/* Highlight rings */}
      {GUIDANCE_ITEMS.map((item) => {
        const rect = targetRects[item.id];
        return rect ? <HighlightRing key={`ring-${item.id}`} rect={rect} /> : null;
      })}

      {/* Collapsible badges */}
      {GUIDANCE_ITEMS.map((item) => (
        <CollapsibleBadge
          key={`badge-${item.id}`}
          item={item}
          targetRect={targetRects[item.id] || null}
          viewModeRect={targetRects["view-mode-toggle"]}
          debugToggleRect={targetRects["debug-toggle"]}
        />
      ))}
    </>
  );

  return createPortal(overlayContent, document.body);
}
