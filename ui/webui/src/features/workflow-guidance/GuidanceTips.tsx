import { Lightbulb } from "lucide-react";

interface GuidanceTipsProps {
  tips: string[];
  title?: string;
}

export function GuidanceTips({ tips, title = "Guidance" }: GuidanceTipsProps) {
  if (!tips.length) {
    return null;
  }

  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <span>{title}</span>
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {tips.map((tip) => (
          <li key={tip}>- {tip}</li>
        ))}
      </ul>
    </div>
  );
}
