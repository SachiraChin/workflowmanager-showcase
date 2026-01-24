import { ArrowLeft, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";

interface HeaderProps {
  showBackButton?: boolean;
  onBack?: () => void;
  user?: { username: string; email: string } | null;
  onLogout?: () => void;
}

export function Header({ showBackButton, onBack, user, onLogout }: HeaderProps) {
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
