import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, History, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
  showNav?: boolean;
  title?: string;
  headerRight?: ReactNode;
  headerLeft?: ReactNode;
}

export function Layout({
  children,
  showNav = true,
  title,
  headerLeft,
  headerRight,
}: LayoutProps) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground overflow-x-hidden relative">
      {/* Mobile Top Header (if title exists) */}
      {title && (
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between bg-card/80 px-4 backdrop-blur-md border-b">
          <div className="w-12 flex items-center justify-start">{headerLeft}</div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground truncate max-w-[200px] text-center">
            {title}
          </h1>
          <div className="w-12 flex items-center justify-end">{headerRight}</div>
        </header>
      )}

      {/* Main Content Area */}
      <main className={cn("flex-1 flex flex-col w-full", showNav && "pb-20")}>
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around bg-card border-t border-border/60 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(0,0,0,0.03)] px-2">
          <Link href="/" className="flex-1">
            <div
              className={cn(
                "flex flex-col items-center justify-center h-full space-y-1 transition-colors",
                location === "/" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Home size={22} strokeWidth={location === "/" ? 2.5 : 2} />
              <span className="text-[10px] font-medium">Home</span>
            </div>
          </Link>

          <Link href="/history" className="flex-1">
            <div
              className={cn(
                "flex flex-col items-center justify-center h-full space-y-1 transition-colors",
                location === "/history" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <History size={22} strokeWidth={location === "/history" ? 2.5 : 2} />
              <span className="text-[10px] font-medium">History</span>
            </div>
          </Link>

          <Link href="/settings" className="flex-1">
            <div
              className={cn(
                "flex flex-col items-center justify-center h-full space-y-1 transition-colors",
                location === "/settings" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Settings size={22} strokeWidth={location === "/settings" ? 2.5 : 2} />
              <span className="text-[10px] font-medium">Settings</span>
            </div>
          </Link>
        </nav>
      )}
    </div>
  );
}
