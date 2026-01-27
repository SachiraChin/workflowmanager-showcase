import React, { type ReactNode, type ReactElement } from "react";

/**
 * Filter children by a data-* attribute matching a specific value.
 *
 * @example
 * const titles = filterByAttr(children, "data-render-as", "card-title");
 */
export function filterByAttr(
  children: ReactNode,
  attr: string,
  value: string
): ReactElement[] {
  const result: ReactElement[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      if (props[attr] === value) {
        result.push(child);
      }
    }
  });

  return result;
}

/**
 * Filter children where a data-* attribute exists and is truthy.
 *
 * @example
 * const highlighted = filterByAttrExists(children, "data-highlight");
 */
export function filterByAttrExists(
  children: ReactNode,
  attr: string
): ReactElement[] {
  const result: ReactElement[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      if (props[attr]) {
        result.push(child);
      }
    }
  });

  return result;
}

/**
 * Filter children excluding those with specific render_as values.
 *
 * @example
 * const body = filterExcludingRenderAs(children, ["card-title", "card-subtitle"]);
 */
export function filterExcludingRenderAs(
  children: ReactNode,
  excludeValues: string[]
): ReactElement[] {
  const result: ReactElement[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      const renderAs = props["data-render-as"] as string | undefined;
      if (!renderAs || !excludeValues.includes(renderAs)) {
        result.push(child);
      }
    }
  });

  return result;
}

/**
 * Convert children to an array of ReactElements.
 *
 * @example
 * const items = childrenToArray(children);
 */
export function childrenToArray(children: ReactNode): ReactElement[] {
  const result: ReactElement[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      result.push(child);
    }
  });

  return result;
}

/**
 * Get a data-* attribute value from a child element.
 *
 * @example
 * const color = getAttr(child, "data-highlight-color");
 */
export function getAttr(child: ReactElement, attr: string): string | undefined {
  const props = child.props as Record<string, unknown>;
  return props[attr] as string | undefined;
}

/**
 * Check if a child element has a specific nudge.
 *
 * @example
 * if (hasNudge(child, "copy")) { ... }
 */
export function hasNudge(child: ReactElement, nudge: string): boolean {
  const nudges = getAttr(child, "data-nudges");
  return nudges?.split(",").includes(nudge) ?? false;
}

/**
 * Extract numeric index from path if the last segment is a number.
 * Used to display item numbers in cards/sections.
 *
 * @example
 * getIndexFromPath(["items", "0"]) // returns 0
 * getIndexFromPath(["title"]) // returns undefined
 */
export function getIndexFromPath(path: string[]): number | undefined {
  if (path.length === 0) return undefined;
  const last = path[path.length - 1];
  const num = parseInt(last, 10);
  return isNaN(num) ? undefined : num;
}
