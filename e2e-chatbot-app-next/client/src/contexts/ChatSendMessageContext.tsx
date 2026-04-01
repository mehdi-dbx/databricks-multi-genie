import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from 'react';

type SendMessageFn = (message: {
  role: 'user';
  parts: Array<{ type: 'text'; text: string }>;
  metadata?: { source?: string };
}) => void;

export type ShowStaffingDutyOnlyFn = (
  zone: string,
  counter: string,
  assignedById: string,
) => void;

interface ChatSendMessageContextValue {
  /** Pass sendMessage to register, or null to unregister on unmount */
  registerSendMessage: (fn: SendMessageFn | null) => void;
  /** Register callback to clear chat and show staffing duty card directly (used by Go to Task) */
  registerShowStaffingDutyOnly: (fn: ShowStaffingDutyOnlyFn | null) => void;
  sendCheckTasks: (agentId: string) => void;
  /** Clear chat, fetch NEW duty for agentId, show StaffingDutyCard directly (no user message) */
  showStaffingDutyOnly: (agentId: string) => void;
}

const ChatSendMessageContext = createContext<ChatSendMessageContextValue | null>(null);

export function ChatSendMessageProvider({ children }: { children: ReactNode }) {
  const sendMessageRef = useRef<SendMessageFn | null>(null);
  const showStaffingDutyOnlyRef = useRef<ShowStaffingDutyOnlyFn | null>(null);

  const registerSendMessage = useCallback((fn: SendMessageFn | null) => {
    sendMessageRef.current = fn;
  }, []);

  const registerShowStaffingDutyOnly = useCallback((fn: ShowStaffingDutyOnlyFn | null) => {
    showStaffingDutyOnlyRef.current = fn;
  }, []);

  const sendCheckTasks = useCallback((_agentId: string) => {
    const send = sendMessageRef.current;
    if (send) {
      send({
        role: 'user',
        parts: [{ type: 'text', text: 'What are my assigned staffing duties?' }],
      });
    }
  }, []);

  const showStaffingDutyOnly = useCallback(async (agentId: string) => {
    const show = showStaffingDutyOnlyRef.current;
    if (!show) return;
    try {
      const res = await fetch('/api/tables/checkin_agents', { credentials: 'include' });
      if (!res.ok) return;
      const body = await res.json();
      const { columns, rows } = body as { columns: string[]; rows: unknown[][] };
      const agentIdx = columns.findIndex((c) => c.toLowerCase() === 'agent_id');
      const zoneIdx = columns.findIndex((c) => c.toLowerCase() === 'zone');
      const counterIdx = columns.findIndex((c) => c.toLowerCase() === 'counter');
      const statusIdx = columns.findIndex((c) => c.toLowerCase() === 'staffing_status');
      const assignedByIdx = columns.findIndex((c) => c.toLowerCase() === 'assigned_by_id');
      if (agentIdx < 0 || zoneIdx < 0 || counterIdx < 0 || statusIdx < 0) return;
      const row = rows.find(
        (r) =>
          String(r[agentIdx]) === agentId &&
          String(r[statusIdx] ?? '').toUpperCase() === 'NEW',
      );
      if (!row) return;
      const zone = String(row[zoneIdx] ?? '');
      const counter = String(row[counterIdx] ?? '');
      const assignedById = assignedByIdx >= 0 ? String(row[assignedByIdx] ?? '') : '';
      show(zone, counter, assignedById);
    } catch {
      /* ignore */
    }
  }, []);

  const value: ChatSendMessageContextValue = {
    registerSendMessage,
    registerShowStaffingDutyOnly,
    sendCheckTasks,
    showStaffingDutyOnly,
  };

  return (
    <ChatSendMessageContext.Provider value={value}>
      {children}
    </ChatSendMessageContext.Provider>
  );
}

export function useChatSendMessage(): ChatSendMessageContextValue {
  const context = useContext(ChatSendMessageContext);
  if (!context) {
    throw new Error('useChatSendMessage must be used within ChatSendMessageProvider');
  }
  return context;
}

export function useOptionalChatSendMessage(): ChatSendMessageContextValue | null {
  return useContext(ChatSendMessageContext);
}
