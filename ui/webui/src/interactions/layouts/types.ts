import type { ReactNode } from "react";
import type { SchemaProperty, UxConfig } from "../schema/types";

/**
 * Props for all layout components.
 * Layouts receive children with data-* attributes and decide how to place them.
 */
export interface LayoutProps {
  /** Schema definition for this node */
  schema: SchemaProperty;
  /** Path to this node in the data tree */
  path: string[];
  /** Raw data for this node */
  data: unknown;
  /** Pre-extracted UX config */
  ux: UxConfig;
  /** Children with data-* attributes for slot placement */
  children: ReactNode;
}

/**
 * Layout component type.
 * All layouts must accept LayoutProps.
 */
export type LayoutComponent = React.FC<LayoutProps>;
