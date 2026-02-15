import type { ReactNode } from "react";

type ModuleNodeShellProps = {
  expanded: boolean;
  borderClass: string;
  badgeText: string;
  badgeClass: string;
  moduleId: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onBodyClick?: () => void;
  onContainerClick?: () => void;
  bodyClassName?: string;
};

export function ModuleNodeShell({
  expanded,
  borderClass,
  badgeText,
  badgeClass,
  moduleId,
  title,
  actions,
  children,
  onBodyClick,
  onContainerClick,
  bodyClassName,
}: ModuleNodeShellProps) {
  const containerClassName = [
    "relative w-[340px] rounded-lg border-2 bg-card",
    borderClass,
    expanded ? "shadow-lg" : "shadow-sm",
  ].join(" ");

  const computedBodyClassName = [
    "px-3 pb-3",
    onBodyClick ? "cursor-pointer" : "",
    bodyClassName ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClassName} onClick={onContainerClick}>
      <div
        className={[
          "absolute -top-2 -right-2 rounded px-1.5 py-0.5 text-[9px] font-medium text-white shadow-sm",
          expanded ? "z-10" : "",
          badgeClass,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {badgeText}
      </div>

      <div className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {moduleId}
          </p>
          {title}
        </div>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </div>

      <div className={computedBodyClassName} onClick={onBodyClick}>
        {children}
      </div>
    </div>
  );
}
