import { ArrowLeft, LogOut, User, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { useDebugMode } from "@/state/hooks/useDebugMode";
import { cn } from "@/core/utils";

interface HeaderProps {
  showBackButton?: boolean;
  onBack?: () => void;
  user?: { username: string; email: string } | null;
  onLogout?: () => void;
  /** Callback when debug mode is toggled (to trigger view refresh) */
  onDebugModeChange?: (enabled: boolean) => void;
}

export function Header({ showBackButton, onBack, user, onLogout, onDebugModeChange }: HeaderProps) {
  const { isDebugMode, toggleDebugMode } = useDebugMode();

  const handleDebugToggle = () => {
    toggleDebugMode();
    // Notify parent to refresh view
    onDebugModeChange?.(!isDebugMode);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-4">
        <div className="flex flex-1 items-center gap-2">
          {showBackButton && onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="mr-2">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Go back</span>
            </Button>
          )}
          <h1 className="text-lg font-semibold">Workflow Engine</h1>
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>{user.username}</span>
              </div>
              {/* Debug Mode Toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDebugToggle}
                className={cn(
                  "gap-1",
                  isDebugMode && "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50"
                )}
                title={isDebugMode ? "Debug mode ON - click to disable" : "Enable debug mode"}
              >
                <Bug className="h-4 w-4" />
                {isDebugMode && <span className="text-xs">Debug</span>}
              </Button>
              {onLogout && (
                <Button variant="ghost" size="sm" onClick={onLogout}>
                  <LogOut className="h-4 w-4 mr-1" />
                  Logout
                </Button>
              )}
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
