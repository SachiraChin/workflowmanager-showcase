/**
 * Renderers for schema-driven UI.
 *
 * Terminal renderers: handle specific render_as types (text, color, url, datetime, number, image)
 */

// Main router - entry point for primitive rendering
export { TerminalRenderer } from "./TerminalRenderer";

// Terminal renderers - one per render_as type
export { TextRenderer } from "./TextRenderer";
export { ColorRenderer } from "./ColorRenderer";
export { UrlRenderer } from "./UrlRenderer";
export { DateTimeRenderer } from "./DateTimeRenderer";
export { NumberRenderer } from "./NumberRenderer";
export { ImageRenderer } from "./ImageRenderer";
export { ErrorRenderer } from "./ErrorRenderer";

// Nudge components - UI enhancements
export { CopyButton, ColorSwatch, ExternalLink } from "./nudges";

// Decorator components
export { DecoratorBadges } from "./DecoratorBadges";

// Input renderers - editable field components
export { TextareaInputRenderer } from "./TextareaInputRenderer";
export {
  SelectInputRenderer,
  buildOptionsFromSchema,
  type SelectOption,
} from "./SelectInputRenderer";
export { SliderInputRenderer } from "./SliderInputRenderer";

// Re-export shared types
export type { ControlConfig } from "../schema/types";
