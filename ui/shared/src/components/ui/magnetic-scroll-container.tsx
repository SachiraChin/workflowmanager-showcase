/**
 * MagneticScrollContainer - Scrollable container with magnetic card snapping.
 *
 * Features:
 * - Smooth scrollbar feel during drag
 * - Magnetic snap to nearest card after scroll ends
 * - Card position counter (X / Y)
 * - Configurable snap threshold and timing
 *
 * Usage:
 * <MagneticScrollContainer cardCount={5} onCardChange={setIndex}>
 *   <MagneticScrollCard index={0}>Card 1</MagneticScrollCard>
 *   <MagneticScrollCard index={1}>Card 2</MagneticScrollCard>
 *   ...
 * </MagneticScrollContainer>
 */

import { useEffect, useRef, useCallback, useState, type ReactNode } from "react";
import { cn } from "../../utils/cn";

// =============================================================================
// Types
// =============================================================================

interface MagneticScrollContainerProps {
  /** Content to render (each direct child should be a full-height card) */
  children: ReactNode;
  /** Total number of cards (for counter display) */
  cardCount: number;
  /** Called when visible card changes */
  onCardChange?: (index: number) => void;
  /** Additional className for the container */
  className?: string;
  /** Height of container (default: calc(100vh-8rem)) */
  height?: string;
  /**
   * Snap threshold (0-1). How far into next card triggers snap forward.
   * 0.5 = snap to whichever card is more visible (default)
   * 0.3 = snap forward more easily (30% into next card triggers snap)
   */
  snapThreshold?: number;
  /**
   * Debounce time in ms before snapping (default: 150)
   * Lower = more responsive, Higher = more forgiving for slow scrolls
   */
  snapDelay?: number;
  /** Show card counter badge (default: true) */
  showCounter?: boolean;
  /** Ref to scroll to a specific card programmatically */
  scrollToCardRef?: React.MutableRefObject<((index: number, smooth?: boolean) => void) | null>;
}

// =============================================================================
// Component
// =============================================================================

export function MagneticScrollContainer({
  children,
  cardCount,
  onCardChange,
  className,
  height = "calc(100vh - 5rem)",
  snapThreshold = 0.5,
  snapDelay = 100,
  showCounter = true,
  scrollToCardRef,
}: MagneticScrollContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);

  // Scroll state tracking
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSnapScrollingRef = useRef(false); // Prevent re-snapping during programmatic scroll

  // Scroll to specific card
  const scrollToCard = useCallback((index: number, smooth = true) => {
    const container = containerRef.current;
    if (!container) return;

    const cardHeight = container.clientHeight;
    const targetScrollTop = index * cardHeight;

    isSnapScrollingRef.current = true;
    container.scrollTo({
      top: targetScrollTop,
      behavior: smooth ? "smooth" : "instant",
    });

    // Reset flag after scroll completes
    setTimeout(() => {
      isSnapScrollingRef.current = false;
    }, smooth ? 500 : 50);
  }, []);

  // Expose scrollToCard via ref
  useEffect(() => {
    if (scrollToCardRef) {
      scrollToCardRef.current = scrollToCard;
    }
  }, [scrollToCard, scrollToCardRef]);

  // Track visible card using Intersection Observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cards = container.querySelectorAll("[data-card-index]");
    if (cards.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const index = parseInt(entry.target.getAttribute("data-card-index") || "0", 10);
            setCurrentCardIndex(index);
            onCardChange?.(index);
          }
        });
      },
      {
        root: container,
        threshold: 0.5,
      }
    );

    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [cardCount, onCardChange]);

  // JS-based magnetic snap - snaps to nearest card after scroll ends
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Don't interfere with programmatic scrolling
      if (isSnapScrollingRef.current) return;

      isScrollingRef.current = true;

      // Clear any pending snap
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // After scroll stops, snap to nearest card
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;

        // Double-check we're not in a programmatic scroll
        if (isSnapScrollingRef.current) return;

        const cardHeight = container.clientHeight;
        const scrollTop = container.scrollTop;

        // Calculate which card to snap to based on threshold
        const cardProgress = (scrollTop % cardHeight) / cardHeight;
        const baseCardIndex = Math.floor(scrollTop / cardHeight);

        // If we've scrolled past threshold into next card, snap forward
        const nearestCardIndex = cardProgress >= snapThreshold
          ? baseCardIndex + 1
          : baseCardIndex;

        const targetScrollTop = nearestCardIndex * cardHeight;

        // Only snap if we're not already at the target (within 2px tolerance)
        if (Math.abs(scrollTop - targetScrollTop) > 2) {
          isSnapScrollingRef.current = true;
          container.scrollTo({
            top: targetScrollTop,
            behavior: "smooth",
          });

          // Reset flag after animation
          setTimeout(() => {
            isSnapScrollingRef.current = false;
          }, 500);
        }
      }, snapDelay);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [snapThreshold, snapDelay]);

  return (
    <div className="relative">
      {/* Card position counter */}
      {showCounter && cardCount > 1 && (
        <div className="absolute top-2 right-4 z-10 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-medium text-muted-foreground border shadow-sm">
          {currentCardIndex + 1} / {cardCount}
        </div>
      )}

      {/* Scrollable container */}
      <div
        ref={containerRef}
        style={{ height }}
        className={cn(
          "overflow-y-auto overflow-x-hidden",
          // Scrollbar styling - 10px width, rounded
          "[&::-webkit-scrollbar]:w-2.5",
          "[&::-webkit-scrollbar-thumb]:bg-black/20",
          "[&::-webkit-scrollbar-thumb]:rounded-full",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          "dark:[&::-webkit-scrollbar-thumb]:bg-white/30",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Helper component for wrapping card content with proper data attributes.
 * Each card should be full container height.
 */
interface MagneticScrollCardProps {
  /** Card index (0-based) */
  index: number;
  /** Card content */
  children: ReactNode;
  /** Additional className */
  className?: string;
  /** Height (should match container, default: 100%) */
  height?: string;
  /** Ref to the card element */
  cardRef?: React.Ref<HTMLDivElement>;
}

export function MagneticScrollCard({
  index,
  children,
  className,
  height = "100%",
  cardRef,
}: MagneticScrollCardProps) {
  return (
    <div
      ref={cardRef}
      data-card-index={index}
      style={{ height }}
      className={className}
    >
      {children}
    </div>
  );
}
