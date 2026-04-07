import { ReactNode } from "react";
import { Printer, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TournamentNavItem {
  key: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

interface TournamentWorkspaceNavProps {
  items: TournamentNavItem[];
  onPrint?: () => void;
  onSettings?: () => void;
  actions?: ReactNode;
}

export function TournamentWorkspaceNav({ items, onPrint, onSettings, actions }: TournamentWorkspaceNavProps) {
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <nav className="flex flex-1 items-center gap-8 overflow-x-auto text-sm font-medium">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={cn(
                "relative pb-2 transition-colors",
                item.active
                  ? "text-foreground after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                {item.icon}
                {item.label}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onPrint && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrint}
              className="flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
          )}
          {onSettings && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSettings}
              className="flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export default TournamentWorkspaceNav;
