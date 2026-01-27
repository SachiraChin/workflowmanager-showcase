/**
 * CardStackLayout - Vertical stack of children with gap.
 * Used for arrays where each item is a card.
 */

import React from "react";
import { registerLayout } from "./registry";
import type { LayoutProps } from "./types";

export const CardStackLayout: React.FC<LayoutProps> = ({ children }) => {
  const hasChildren = React.Children.count(children) > 0;

  if (!hasChildren) {
    return (
      <div className="text-center text-muted-foreground py-4">
        No items
      </div>
    );
  }

  return <div className="flex flex-col gap-3">{children}</div>;
};

registerLayout("card-stack", CardStackLayout);
