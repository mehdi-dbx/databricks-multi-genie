import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  PlusIcon,
  HistoryIcon,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';

export function ChatPanelHeader({
  showIntermediateSteps,
  onToggleIntermediateSteps,
  onNewChat,
  onHistory,
  expanded,
  onExpand,
  onClose,
}: {
  showIntermediateSteps: boolean;
  onToggleIntermediateSteps: () => void;
  onNewChat: () => void;
  onHistory: () => void;
  expanded: boolean;
  onExpand: () => void;
  onClose?: () => void;
  sendMessage?: (message: {
    role: 'user';
    parts: Array<{ type: 'text'; text: string }>;
    metadata?: { source?: string };
  }) => void;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-background px-3 py-2 min-h-[44px]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate font-semibold tracking-tight text-purple-600 text-sm">
          Teva Data Explorer
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onNewChat}
          aria-label="New chat"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onHistory}
          aria-label="History"
        >
          <HistoryIcon className="h-4 w-4" />
        </Button>
        <Switch
          checked={showIntermediateSteps}
          onCheckedChange={onToggleIntermediateSteps}
          label="Steps"
          title="Show/hide tool steps"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onExpand}
          aria-label={expanded ? 'Tuck chat' : 'Expand chat'}
        >
          {expanded ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
        {onClose != null && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
