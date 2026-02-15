import { useEffect, useRef, useCallback, useState } from "react";

// =============================================================================
// Mermaid Diagram Definition (matches README.md)
// =============================================================================

const diagramDefinition = `
flowchart TB
    subgraph Clients["Clients"]
        direction LR
        WebUI["Web UI<br/>(React + Vite)"]
        TUI["Terminal UI<br/>(Textual)"]
        Status["Status Monitor"]
    end

    subgraph Backend["Backend Services"]
        direction LR
        subgraph Server["FastAPI Server"]
            direction TB
            Engine["Workflow Engine"]
            Registry["Module Registry"]
            SSE["SSE Streaming"]
        end
        
        Queue[("Task Queue")]
        
        subgraph Worker["Background Worker"]
            direction TB
            Leonardo["Leonardo"]
            OpenAI["OpenAI"]
            ElevenLabs["ElevenLabs"]
            MoreProviders["..."]
        end
    end

    subgraph Data["Data Layer"]
        direction LR
        subgraph DocStore["MongoDB"]
            direction TB
            Workflows["Workflows"]
            Events["Events"]
            Content["Content<br/>(JSON/Text)"]
            Users["Users"]
            MediaRefs["Media Refs"]
        end
        
        subgraph FileStore["File System"]
            direction TB
            Images["Images"]
            Videos["Videos"]
            Audio["Audio"]
        end
    end

    Clients --> Server
    Server --> Queue
    Queue --> Worker
    Server --> DocStore
    Worker --> DocStore
    Worker --> FileStore
    MediaRefs -.-> FileStore
`;

// =============================================================================
// Theme Configuration
// =============================================================================

function getThemeVariables(isDark: boolean) {
  if (isDark) {
    return {
      // Dark theme - muted colors
      primaryColor: "#3f3f46",
      primaryTextColor: "#e4e4e7",
      primaryBorderColor: "#52525b",
      secondaryColor: "#3f3f46",
      secondaryTextColor: "#e4e4e7",
      secondaryBorderColor: "#52525b",
      tertiaryColor: "#3f3f46",
      tertiaryTextColor: "#e4e4e7",
      tertiaryBorderColor: "#52525b",
      background: "#18181b",
      mainBkg: "#27272a",
      nodeBorder: "#52525b",
      clusterBkg: "#27272a",
      clusterBorder: "#3f3f46",
      lineColor: "#52525b",
      textColor: "#e4e4e7",
      fontSize: "14px",
      edgeLabelBackground: "transparent",
    };
  } else {
    return {
      // Light theme
      primaryColor: "#e4e4e7",
      primaryTextColor: "#27272a",
      primaryBorderColor: "#a1a1aa",
      secondaryColor: "#e4e4e7",
      secondaryTextColor: "#27272a",
      secondaryBorderColor: "#a1a1aa",
      tertiaryColor: "#e4e4e7",
      tertiaryTextColor: "#27272a",
      tertiaryBorderColor: "#a1a1aa",
      background: "#fafafa",
      mainBkg: "#ffffff",
      nodeBorder: "#d4d4d8",
      clusterBkg: "#f4f4f5",
      clusterBorder: "#d4d4d8",
      lineColor: "#a1a1aa",
      textColor: "#27272a",
      fontSize: "14px",
      edgeLabelBackground: "transparent",
    };
  }
}

// =============================================================================
// Zoom Controls Component
// =============================================================================

function ZoomControls({ 
  zoom, 
  onZoomIn, 
  onZoomOut, 
  onReset 
}: { 
  zoom: number; 
  onZoomIn: () => void; 
  onZoomOut: () => void; 
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border bg-card/90 p-1 backdrop-blur-sm">
      <button
        onClick={onZoomOut}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title="Zoom out"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35M8 11h6" />
        </svg>
      </button>
      <button
        onClick={onReset}
        className="flex h-7 min-w-[3rem] items-center justify-center rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={onZoomIn}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title="Zoom in"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35M11 8v6M8 11h6" />
        </svg>
      </button>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function ArchitectureDiagram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(z + 0.2, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(z - 0.2, 0.4));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
  }, []);

  // Drag to pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollContainerRef.current.scrollLeft,
      scrollTop: scrollContainerRef.current.scrollTop,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    scrollContainerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    scrollContainerRef.current.scrollTop = dragStart.scrollTop - dy;
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const renderDiagram = useCallback(async () => {
    if (!svgContainerRef.current) return;
    const { default: mermaid } = await import("mermaid");

    // Detect dark mode
    const isDark = document.documentElement.classList.contains("dark");
    const themeVars = getThemeVariables(isDark);

    // Initialize mermaid with theme
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: themeVars,
      flowchart: {
        curve: "basis",
        padding: 20,
        nodeSpacing: 50,
        rankSpacing: 60,
        htmlLabels: true,
        useMaxWidth: false,
      },
      securityLevel: "loose",
    });

    // Generate unique ID for this render
    const renderId = `mermaid-diagram-${++renderIdRef.current}`;

    try {
      // Clear previous content
      svgContainerRef.current.innerHTML = "";

      // Render the diagram
      const { svg } = await mermaid.render(renderId, diagramDefinition);
      
      if (svgContainerRef.current) {
        svgContainerRef.current.innerHTML = svg;

        // Apply additional styling to the SVG
        const svgElement = svgContainerRef.current.querySelector("svg");
        if (svgElement) {
          svgElement.style.maxWidth = "none";
          svgElement.style.height = "auto";
        }
      }
    } catch (error) {
      console.error("Mermaid rendering error:", error);
    }
  }, []);

  // Initial render
  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  // Re-render on theme change
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          renderDiagram();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [renderDiagram]);

  // Handle scroll wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(z => Math.min(Math.max(z + delta, 0.4), 2));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div 
      ref={containerRef}
      className="relative w-full rounded-lg border border-border bg-card overflow-hidden"
    >
      <div 
        ref={scrollContainerRef}
        className={`diagram-scroll-container overflow-auto p-4 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ maxHeight: '600px' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <div 
          ref={svgContainerRef}
          className="mermaid-container flex items-center justify-center min-h-[500px] transition-transform duration-200 origin-top-left select-none"
          style={{ transform: `scale(${zoom})`, pointerEvents: isDragging ? 'none' : 'auto' }}
        />
      </div>
      <ZoomControls 
        zoom={zoom} 
        onZoomIn={handleZoomIn} 
        onZoomOut={handleZoomOut} 
        onReset={handleReset}
      />
      <style>{`
        /* Custom scrollbar styling - Light mode */
        .diagram-scroll-container::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        .diagram-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .diagram-scroll-container::-webkit-scrollbar-thumb {
          background: #d4d4d8;
          border-radius: 4px;
        }
        
        .diagram-scroll-container::-webkit-scrollbar-thumb:hover {
          background: #a1a1aa;
        }
        
        .diagram-scroll-container::-webkit-scrollbar-corner {
          background: transparent;
        }
        
        /* Firefox scrollbar - Light mode */
        .diagram-scroll-container {
          scrollbar-width: thin;
          scrollbar-color: #d4d4d8 transparent;
        }
        
        /* Dark mode scrollbar overrides */
        .dark .diagram-scroll-container::-webkit-scrollbar-thumb {
          background: #3f3f46;
        }
        
        .dark .diagram-scroll-container::-webkit-scrollbar-thumb:hover {
          background: #52525b;
        }
        
        .dark .diagram-scroll-container {
          scrollbar-color: #3f3f46 transparent;
        }
        
        .mermaid-container .node rect,
        .mermaid-container .node circle,
        .mermaid-container .node ellipse,
        .mermaid-container .node polygon,
        .mermaid-container .node path {
          stroke-width: 1.5px;
        }
        
        .mermaid-container .cluster rect {
          rx: 8px;
          ry: 8px;
        }
        
        .mermaid-container .node rect {
          rx: 6px;
          ry: 6px;
        }
        
        /* Hide ALL edge labels and their backgrounds completely */
        .mermaid-container .edgeLabel {
          display: none !important;
        }
        
        .mermaid-container .flowchart-link {
          stroke-width: 1.5px;
        }
        
        /* ===========================================
           LIGHT MODE STYLES (default)
           =========================================== */
        
        /* Clients - blue tint */
        .mermaid-container [id*="Clients"] > rect {
          fill: rgba(59, 130, 246, 0.35) !important;
          stroke: rgba(59, 130, 246, 0.8) !important;
        }
        .mermaid-container [id*="WebUI"] rect,
        .mermaid-container [id*="TUI"] rect,
        .mermaid-container [id*="Status"] rect {
          fill: rgba(59, 130, 246, 0.4) !important;
          stroke: rgba(59, 130, 246, 0.85) !important;
        }
        
        /* FastAPI Server - green tint */
        .mermaid-container [id*="Server"]:not([id*="Backend"]) > rect {
          fill: rgba(34, 197, 94, 0.35) !important;
          stroke: rgba(34, 197, 94, 0.8) !important;
        }
        .mermaid-container [id*="Engine"] rect,
        .mermaid-container [id*="Registry"] rect,
        .mermaid-container [id*="SSE"] rect {
          fill: rgba(34, 197, 94, 0.4) !important;
          stroke: rgba(34, 197, 94, 0.85) !important;
        }
        
        /* Task Queue - orange/amber tint */
        .mermaid-container [id*="Queue"] path,
        .mermaid-container [id*="Queue"] rect {
          fill: rgba(249, 115, 22, 0.4) !important;
          stroke: rgba(249, 115, 22, 0.85) !important;
        }
        
        /* Background Worker - purple tint */
        .mermaid-container [id*="Worker"]:not([id*="Backend"]) > rect {
          fill: rgba(168, 85, 247, 0.35) !important;
          stroke: rgba(168, 85, 247, 0.8) !important;
        }
        .mermaid-container [id*="Leonardo"] rect,
        .mermaid-container [id*="OpenAI"] rect,
        .mermaid-container [id*="ElevenLabs"] rect,
        .mermaid-container [id*="MoreProviders"] rect {
          fill: rgba(168, 85, 247, 0.4) !important;
          stroke: rgba(168, 85, 247, 0.85) !important;
        }
        
        /* MongoDB - cyan tint */
        .mermaid-container [id*="DocStore"] > rect {
          fill: rgba(6, 182, 212, 0.35) !important;
          stroke: rgba(6, 182, 212, 0.8) !important;
        }
        .mermaid-container [id*="Workflows"] rect,
        .mermaid-container [id*="Events"] rect,
        .mermaid-container [id*="Content"] rect,
        .mermaid-container [id*="Users"] rect,
        .mermaid-container [id*="MediaRefs"] rect {
          fill: rgba(6, 182, 212, 0.4) !important;
          stroke: rgba(6, 182, 212, 0.85) !important;
        }
        
        /* File System - amber/yellow tint */
        .mermaid-container [id*="FileStore"] > rect {
          fill: rgba(245, 158, 11, 0.35) !important;
          stroke: rgba(245, 158, 11, 0.8) !important;
        }
        .mermaid-container [id*="Images"] rect,
        .mermaid-container [id*="Videos"] rect,
        .mermaid-container [id*="Audio"] rect {
          fill: rgba(245, 158, 11, 0.4) !important;
          stroke: rgba(245, 158, 11, 0.85) !important;
        }
        
        /* Outer containers - Backend Services & Data Layer (Light) */
        .mermaid-container [id*="Backend"] > rect {
          fill: rgba(161, 161, 170, 0.4) !important;
          stroke: rgba(82, 82, 91, 0.7) !important;
        }
        
        .mermaid-container [id*="Data"]:not([id*="Doc"]):not([id*="File"]) > rect {
          fill: rgba(161, 161, 170, 0.4) !important;
          stroke: rgba(82, 82, 91, 0.7) !important;
        }
        
        /* Text colors (Light) */
        .mermaid-container .nodeLabel {
          color: #27272a !important;
        }
        
        .mermaid-container .cluster-label .nodeLabel {
          color: #52525b !important;
        }
        
        /* Edge/line colors (Light) */
        .mermaid-container .flowchart-link {
          stroke: #a1a1aa !important;
        }
        
        .mermaid-container marker path {
          fill: #a1a1aa !important;
        }
        
        /* ===========================================
           DARK MODE STYLES
           =========================================== */
        
        /* Clients - blue tint (Dark) */
        .dark .mermaid-container [id*="Clients"] > rect {
          fill: rgba(59, 130, 246, 0.15) !important;
          stroke: rgba(59, 130, 246, 0.5) !important;
        }
        .dark .mermaid-container [id*="WebUI"] rect,
        .dark .mermaid-container [id*="TUI"] rect,
        .dark .mermaid-container [id*="Status"] rect {
          fill: rgba(59, 130, 246, 0.2) !important;
          stroke: rgba(59, 130, 246, 0.6) !important;
        }
        
        /* FastAPI Server - green tint (Dark) */
        .dark .mermaid-container [id*="Server"]:not([id*="Backend"]) > rect {
          fill: rgba(34, 197, 94, 0.15) !important;
          stroke: rgba(34, 197, 94, 0.5) !important;
        }
        .dark .mermaid-container [id*="Engine"] rect,
        .dark .mermaid-container [id*="Registry"] rect,
        .dark .mermaid-container [id*="SSE"] rect {
          fill: rgba(34, 197, 94, 0.2) !important;
          stroke: rgba(34, 197, 94, 0.6) !important;
        }
        
        /* Task Queue - orange/amber tint (Dark) */
        .dark .mermaid-container [id*="Queue"] path,
        .dark .mermaid-container [id*="Queue"] rect {
          fill: rgba(249, 115, 22, 0.2) !important;
          stroke: rgba(249, 115, 22, 0.6) !important;
        }
        
        /* Background Worker - purple tint (Dark) */
        .dark .mermaid-container [id*="Worker"]:not([id*="Backend"]) > rect {
          fill: rgba(168, 85, 247, 0.15) !important;
          stroke: rgba(168, 85, 247, 0.5) !important;
        }
        .dark .mermaid-container [id*="Leonardo"] rect,
        .dark .mermaid-container [id*="OpenAI"] rect,
        .dark .mermaid-container [id*="ElevenLabs"] rect,
        .dark .mermaid-container [id*="MoreProviders"] rect {
          fill: rgba(168, 85, 247, 0.2) !important;
          stroke: rgba(168, 85, 247, 0.6) !important;
        }
        
        /* MongoDB - cyan tint (Dark) */
        .dark .mermaid-container [id*="DocStore"] > rect {
          fill: rgba(6, 182, 212, 0.15) !important;
          stroke: rgba(6, 182, 212, 0.5) !important;
        }
        .dark .mermaid-container [id*="Workflows"] rect,
        .dark .mermaid-container [id*="Events"] rect,
        .dark .mermaid-container [id*="Content"] rect,
        .dark .mermaid-container [id*="Users"] rect,
        .dark .mermaid-container [id*="MediaRefs"] rect {
          fill: rgba(6, 182, 212, 0.2) !important;
          stroke: rgba(6, 182, 212, 0.6) !important;
        }
        
        /* File System - amber/yellow tint (Dark) */
        .dark .mermaid-container [id*="FileStore"] > rect {
          fill: rgba(245, 158, 11, 0.15) !important;
          stroke: rgba(245, 158, 11, 0.5) !important;
        }
        .dark .mermaid-container [id*="Images"] rect,
        .dark .mermaid-container [id*="Videos"] rect,
        .dark .mermaid-container [id*="Audio"] rect {
          fill: rgba(245, 158, 11, 0.2) !important;
          stroke: rgba(245, 158, 11, 0.6) !important;
        }
        
        /* Outer containers - Backend Services & Data Layer (Dark) */
        .dark .mermaid-container [id*="Backend"] > rect {
          fill: rgba(39, 39, 42, 0.6) !important;
          stroke: rgba(63, 63, 70, 0.8) !important;
        }
        
        .dark .mermaid-container [id*="Data"]:not([id*="Doc"]):not([id*="File"]) > rect {
          fill: rgba(39, 39, 42, 0.6) !important;
          stroke: rgba(63, 63, 70, 0.8) !important;
        }
        
        /* Text colors (Dark) */
        .dark .mermaid-container .nodeLabel {
          color: #e4e4e7 !important;
        }
        
        .dark .mermaid-container .cluster-label .nodeLabel {
          color: #a1a1aa !important;
        }
        
        /* Edge/line colors (Dark) */
        .dark .mermaid-container .flowchart-link {
          stroke: #71717a !important;
        }
        
        .dark .mermaid-container marker path {
          fill: #71717a !important;
        }
      `}</style>
    </div>
  );
}
