/**
 * SectionListLayout - Vertical list of children with gap.
 * Used for arrays where each item is a section.
 */

import React from "react";
import { registerLayout } from "./registry";
import type { LayoutProps } from "./types";

export const SectionListLayout: React.FC<LayoutProps> = ({ children }) => {
  const hasChildren = React.Children.count(children) > 0;

  if (!hasChildren) {
    return (
      <div className="text-center text-muted-foreground py-4">
        No sections
      </div>
    );
  }

  return <div className="flex flex-col gap-3">{children}</div>;
};

registerLayout("section-list", SectionListLayout);
