import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { navLinks } from "@/components/app-shared";
import { CustomTrigger } from "@/components/custom-trigger";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { NotificationsMenu } from "@/components/notifications-menu";
import { useCommandPalette } from "@/components/command-palette";
import { HelpCircleIcon } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpen } = useCommandPalette();
  const activeItem =
    navLinks.find((item) => item.path === pathname) ??
    navLinks.find((item) => item.path !== "/dashboard" && pathname.startsWith(item.path));

  return (
    <header className="sticky top-0 z-50 flex h-(--app-header-height) w-full shrink-0 items-center gap-2 border-b bg-background px-4 md:px-6">
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
        <Tooltip>
          <TooltipTrigger asChild>
            <ThemeSwitcher />
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Help" size="icon-sm" variant="ghost" className="text-muted-foreground">
              <HelpCircleIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setOpen(true)}>
              Command menu
              <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="mailto:support@passline.app">Contact support</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <NotificationsMenu />
      </div>
    </header>
  );
}
