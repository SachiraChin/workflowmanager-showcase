/**
 * AccessDeniedView - Full-page view shown when user doesn't have access to a workflow.
 *
 * Displayed when attempting to access a workflow owned by another user.
 * Hides sidebar and workflow content, shows unauthorized message with
 * a button to navigate back home.
 */

import { ShieldX, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AccessDeniedViewProps {
  /** Callback when user clicks "Go to Home" button */
  onGoHome: () => void;
}

export function AccessDeniedView({ onGoHome }: AccessDeniedViewProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center text-center max-w-md px-4">
        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
          <ShieldX className="w-10 h-10 text-destructive" />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Access Denied
        </h1>

        {/* Description */}
        <p className="text-muted-foreground mb-8">
          You don't have permission to view this workflow. This could be because
          the workflow belongs to another user or has been deleted.
        </p>

        {/* Action Button */}
        <Button onClick={onGoHome} size="lg">
          <Home className="w-4 h-4 mr-2" />
          Go to Home
        </Button>
      </div>
    </div>
  );
}
