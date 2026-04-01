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

interface ChatSendMessageContextValue {
  /** Pass sendMessage to register, or null to unregister on unmount */
  registerSendMessage: (fn: SendMessageFn | null) => void;
}

const ChatSendMessageContext = createContext<ChatSendMessageContextValue | null>(null);

export function ChatSendMessageProvider({ children }: { children: ReactNode }) {
  const sendMessageRef = useRef<SendMessageFn | null>(null);

  const registerSendMessage = useCallback((fn: SendMessageFn | null) => {
    sendMessageRef.current = fn;
  }, []);

  const value: ChatSendMessageContextValue = {
    registerSendMessage,
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
