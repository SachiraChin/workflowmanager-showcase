/**
 * Shared utilities re-exports.
 */

export { cn } from "./cn";
export { renderTemplate } from "./template-service";
export { getUx, hasUx } from "./ux-utils";
export {
  formatLabel,
  getItemAddon,
  formatTimeAgo,
  getDecorators,
  type DecoratorInfo,
} from "./schema-utils";
export {
  filterByAttr,
  filterByAttrExists,
  filterExcludingRenderAs,
  childrenToArray,
  getAttr,
  hasNudge,
  getIndexFromPath,
} from "./layout-utils";
export {
  formatTimeAgo as formatInteractionTimeAgo,
  getTimeBasedColor,
  isValidHexColor,
  normalizeHexColor,
  hexToStyle,
  hexToSwatchStyle,
  getHighlightClasses,
  getHighlightStyle,
  parseSelectionInput,
} from "./interaction-utils";
