/**
 * DefaultLayout - Simple container for children.
 * Used when no specific layout is specified.
 *
 * Supports selection when ux.selectable is true.
 */

import React from "react";
import { registerLayout } from "./registry";
import type { LayoutProps } from "./types";
import { useSelectable } from "../schema/useSelectable";
import { SelectableWrapper } from "../schema/SelectableWrapper";

export const DefaultLayout: React.FC<LayoutProps> = ({ schema: _schema, path, data, ux, children }) => {
  // Check if this object should be selectable
  const selectable = useSelectable(path, data, ux);

  const content = <div className="space-y-2">{children}</div>;

  // If selectable, wrap in SelectableWrapper
  if (selectable) {
    return (
      <SelectableWrapper selectable={selectable}>
        {content}
      </SelectableWrapper>
    );
  }

  return content;
};

registerLayout("default", DefaultLayout);
