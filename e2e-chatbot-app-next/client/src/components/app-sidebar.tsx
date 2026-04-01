import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/sidebar';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import type { ClientSession } from '@chat-template/auth';

export function AppSidebar({
  user: _user,
  preferredUsername: _preferredUsername,
}: {
  user: ClientSession['user'] | undefined;
  preferredUsername: string | null;
}) {
  const { toggleSidebar, state } = useSidebar();

  return (
    <Sidebar
      className="group-data-[side=left]:border-r-0"
      collapsible="icon"
    >
      <SidebarContent />
      <SidebarFooter className="mt-auto p-2">
        <SidebarMenuButton
          onClick={toggleSidebar}
          tooltip={state === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'}
          className="w-full"
        >
          {state === 'collapsed' ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
          <span>{state === 'collapsed' ? 'Expand' : 'Collapse'}</span>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
