/**
 * Template Service - Nunjucks-based template rendering for display_format.
 *
 * Used by SchemaRenderer to process display_format templates in schemas.
 * Nunjucks is Jinja2-compatible, matching the Python TUI's template syntax.
 *
 * Context building:
 * - Objects: all keys available directly (e.g., {{ name }}, {{ description }})
 * - Arrays: available as {{ value }} (e.g., {{ value | join(', ') }})
 * - State: available as {{ state.key }} if provided
 */

import nunjucks from "nunjucks";

// =============================================================================
// Nunjucks Environment Configuration
// =============================================================================

const env = new nunjucks.Environment(null, {
  autoescape: false, // Templates are for display, not HTML
  throwOnUndefined: false, // Graceful handling of missing vars
});

// =============================================================================
// Template Rendering
// =============================================================================

/**
 * Render a display_format template with the given data and optional state context.
 *
 * @param template - The Jinja2/Nunjucks template string (e.g., "{{ value | join(', ') }}")
 * @param item - The data to render (object, array, or primitive)
 * @param state - Optional workflow state for {{ state.key }} access
 * @returns The rendered string, or an error message if rendering fails
 *
 * @example
 * // Object data - keys available directly
 * renderTemplate("{{ name }} - {{ description }}", { name: "Test", description: "Desc" })
 * // Returns: "Test - Desc"
 *
 * @example
 * // Array data - available as "value"
 * renderTemplate("{{ value | join(', ') }}", ["a", "b", "c"])
 * // Returns: "a, b, c"
 *
 * @example
 * // With state context
 * renderTemplate("{{ state.user.name }}", {}, { user: { name: "John" } })
 * // Returns: "John"
 */
export function renderTemplate(
  template: string,
  item: unknown,
  state?: Record<string, unknown>
): string {
  // Build context
  const context: Record<string, unknown> = {};

  if (item !== null && typeof item === "object" && !Array.isArray(item)) {
    // Object: spread all keys into context
    Object.assign(context, item);
  } else {
    // Array or primitive: available as "value"
    context.value = item;
  }

  if (state) {
    context.state = state;
  }

  try {
    return env.renderString(template, context);
  } catch (error) {
    console.error("[TemplateService] Render error:", error);
    return `[Template Error: ${(error as Error).message}]`;
  }
}
