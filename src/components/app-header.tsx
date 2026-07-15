import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { navLinks } from "@/components/app-shared";
import { CustomTrigger } from "@/components/custom-trigger";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { HelpCircleIcon, BellIcon } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeItem =
    navLinks.find((item) => item.path === pathname) ??
    navLinks.find((item) => item.path !== "/dashboard" && pathname.startsWith(item.path));

  return (
    <header className="sticky top-0 z-50 flex h-(--app-header-height) w-full shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60 md:px-6">
      <div className="flex items-center gap-2">
        <CustomTrigger place="navbar" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="text-muted-foreground">Passline</BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{activeItem?.title ?? "Overview"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <ThemeSwitcher />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Help"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
            >
              <HelpCircleIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Notifications"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
            >
              <BellIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
