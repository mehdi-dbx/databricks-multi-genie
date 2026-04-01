import { motion } from 'framer-motion';
import React, { memo, useEffect, useState } from 'react';
import { AnimatedAssistantIcon } from './animation-assistant-icon';
import { Response } from './elements/response';
import { MessageContent } from './elements/message';
import { TurnaroundStartedCard } from './elements/turnaround-started-card';
import { LiveTurnaroundChecklistCard } from './elements/live-turnaround-checklist';
import { KnowledgeBaseCard } from './elements/knowledge-base-card';
import { parseResponseBlocks, hasResponseBlocks } from '@/lib/response-blocks';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  type ToolState,
} from './elements/tool';
import {
  McpTool,
  McpToolHeader,
  McpToolContent,
  McpToolInput,
  McpApprovalActions,
} from './elements/mcp-tool';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { MessageEditor } from './message-editor';
import { MessageReasoning } from './message-reasoning';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@chat-template/core';
import { useDataStream } from './data-stream-provider';
import {
  createMessagePartSegments,
  formatNamePart,
  isNamePart,
  joinMessagePartSegments,
} from './databricks-message-part-transformers';
import { MessageError } from './message-error';
import { ChatLoadingIndicator, getActiveToolMessage, getToolMessage } from './chat-loading-indicator';
import { MessageOAuthError } from './message-oauth-error';
import { isCredentialErrorMessage } from '@/lib/oauth-error-utils';
import { Streamdown } from 'streamdown';
import { useApproval } from '@/hooks/use-approval';
import { useSession } from '@/contexts/SessionContext';
import { useTableRefresh } from '@/contexts/TableRefreshContext';

function RefreshTableTrigger({ table }: { table: string }) {
  const { refresh } = useTableRefresh();
  useEffect(() => {
    if (table) refresh(table);
  }, [table, refresh]);
  return null;
}

function getInitials(displayName: string, maxLetters = 2): string {
  const trimmed = displayName.trim();
  if (!trimmed) return 'U';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase().slice(0, maxLetters);
  }
  return trimmed.slice(0, maxLetters).toUpperCase() || trimmed.charAt(0).toUpperCase();
}

const PurePreviewMessage = ({
  message,
  allMessages,
  isLoading,
  setMessages,
  addToolApprovalResponse,
  sendMessage,
  regenerate,
  isReadonly,
  requiresScrollPadding,
  showIntermediateSteps,
  isLastMessage,
}: {
  chatId: string;
  message: ChatMessage;
  allMessages: ChatMessage[];
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>['addToolApprovalResponse'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  showIntermediateSteps: boolean;
  isLastMessage: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [showErrors, setShowErrors] = useState(false);
  const { session } = useSession();
  const displayName =
    session?.user?.preferredUsername ||
    session?.user?.name ||
    session?.user?.email ||
    'User';
  const userInitials = getInitials(displayName);

  const { submitApproval, isSubmitting, pendingApprovalId } = useApproval({
    addToolApprovalResponse,
    sendMessage,
  });

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === 'file',
  );

  const errorParts = React.useMemo(
    () =>
      message.parts
        .filter((part) => part.type === 'data-error')
        .filter((part) => {
          return !isCredentialErrorMessage(part.data);
        }),
    [message.parts],
  );

  useDataStream();

  const partSegments = React.useMemo(
    () =>
      createMessagePartSegments(
        message.parts.filter(
          (part) =>
            part.type !== 'data-error' || isCredentialErrorMessage(part.data),
        ),
      ),
    [message.parts],
  );

  const hasOnlyErrors = React.useMemo(() => {
    const nonErrorParts = message.parts.filter(
      (part) => part.type !== 'data-error',
    );
    return errorParts.length > 0 && nonErrorParts.length === 0;
  }, [message.parts, errorParts.length]);

  return (
    <div
      data-testid={`message-${message.role}`}
      className="group/message w-full"
      data-role={message.role}
    >
      <div
        className={cn('flex w-full items-start gap-2 md:gap-3', {
          'justify-end': message.role === 'user',
          'justify-start': message.role === 'assistant',
        })}
      >
        {message.role === 'assistant' && (
          <AnimatedAssistantIcon size={14} isLoading={isLoading} />
        )}

        <div
          className={cn('flex min-w-0 flex-col gap-3', {
            'w-full': message.role === 'assistant' || mode === 'edit',
            'min-h-96': message.role === 'assistant' && requiresScrollPadding,
            'max-w-[70%] sm:max-w-[min(fit-content,80%)]':
              message.role === 'user' && mode !== 'edit',
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              data-testid={`message-attachments`}
              className="flex flex-row justify-end gap-2"
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  key={attachment.url}
                  attachment={{
                    name: attachment.filename ?? 'file',
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                />
              ))}
            </div>
          )}

          {partSegments?.map((parts, index) => {
            const [part] = parts;
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === 'reasoning' && part.text?.trim().length > 0) {
              return (
                <MessageReasoning
                  key={key}
                  isLoading={isLoading}
                  reasoning={part.text}
                />
              );
            }

            if (type === 'text') {
              if (isNamePart(part)) {
                return (
                  <Streamdown
                    key={key}
                    className="-mb-2 mt-0 border-l-4 pl-2 text-muted-foreground"
                  >{`# ${formatNamePart(part)}`}</Streamdown>
                );
              }
              if (mode === 'view') {
                const text = joinMessagePartSegments(parts);
                const sanitized = sanitizeText(text);
                const useBlocks = hasResponseBlocks(sanitized);
                return (
                  <MessageContent
                    key={key}
                    data-testid="message-content"
                    className={cn({
                      'w-fit break-words rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-lg border px-3 py-2 text-right text-foreground bg-[#EBF0F8] dark:bg-slate-800/60 border-slate-200 dark:border-slate-600':
                        message.role === 'user',
                      'bg-transparent px-0 py-0 text-left':
                        message.role === 'assistant',
                    })}
                  >
                    {useBlocks ? (
                      <div className="flex flex-col gap-3">
                        {parseResponseBlocks(sanitized).map((seg, i) => {
                          if (seg.type === 'markdown') {
                            return (
                              <Response key={i}>{seg.content}</Response>
                            );
                          }
                          if (seg.type === 'turnaround_started') {
                            return (
                              <TurnaroundStartedCard
                                key={i}
                                flight={seg.parsed.flight}
                                etaMin={seg.parsed.etaMin}
                                tobt={seg.parsed.tobt}
                              />
                            );
                          }
                          if (seg.type === 'live_turnaround_checklist') {
                            return (
                              <LiveTurnaroundChecklistCard
                                key={i}
                                flight={seg.parsed.flight}
                                tasks={seg.parsed.tasks}
                                readiness={seg.parsed.readiness}
                              />
                            );
                          }
                          if (seg.type === 'knowledge_base') {
                            return (
                              <KnowledgeBaseCard
                                key={i}
                                header={seg.parsed.header}
                                items={seg.parsed.items}
                                footer={seg.parsed.footer}
                              />
                            );
                          }
                          if (seg.type === 'refresh_table') {
                            return (
                              <RefreshTableTrigger
                                key={i}
                                table={seg.parsed.table}
                              />
                            );
                          }
                          return null;
                        })}
                      </div>
                    ) : (
                      <Response>{sanitized}</Response>
                    )}
                  </MessageContent>
                );
              }

              if (mode === 'edit') {
                return (
                  <div
                    key={key}
                    className="flex w-full flex-row items-start gap-3"
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        setMode={setMode}
                        setMessages={setMessages}
                        regenerate={regenerate}
                      />
                    </div>
                  </div>
                );
              }
            }

            if (part.type === `dynamic-tool`) {
              if (!showIntermediateSteps) return null;
              const { toolCallId, input, state, errorText, output, toolName } = part;

              const isMcpApproval = part.callProviderMetadata?.databricks?.approvalRequestId != null;
              const mcpServerName = part.callProviderMetadata?.databricks?.mcpServerName?.toString();

              const approved: boolean | undefined =
                'approval' in part ? part.approval?.approved : undefined;

              const effectiveState: ToolState = (() => {
                if (part.providerExecuted && !isLoading && state === 'input-available') {
                  return 'output-available';
                }
                return state;
              })();

              if (isMcpApproval) {
                return (
                  <McpTool key={toolCallId} defaultOpen={true}>
                    <McpToolHeader
                      serverName={mcpServerName}
                      toolName={toolName}
                      state={effectiveState}
                      approved={approved}
                    />
                    <McpToolContent>
                      <McpToolInput input={input} />
                      {state === 'approval-requested' && (
                        <McpApprovalActions
                          onApprove={() =>
                            submitApproval({
                              approvalRequestId: toolCallId,
                              approve: true,
                            })
                          }
                          onDeny={() =>
                            submitApproval({
                              approvalRequestId: toolCallId,
                              approve: false,
                            })
                          }
                          isSubmitting={
                            isSubmitting && pendingApprovalId === toolCallId
                          }
                        />
                      )}
                      {state === 'output-available' && output != null && (
                        <ToolOutput
                          output={
                            errorText ? (
                              <div className="rounded border p-2 text-red-500">
                                Error: {errorText}
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap font-mono text-sm">
                                {typeof output === 'string'
                                  ? output
                                  : JSON.stringify(output, null, 2)}
                              </div>
                            )
                          }
                          errorText={undefined}
                        />
                      )}
                    </McpToolContent>
                  </McpTool>
                );
              }

              return (
                <Tool key={toolCallId} defaultOpen={true}>
                  <ToolHeader
                    type={toolName}
                    state={effectiveState}
                    statusMessage={getToolMessage(toolName)}
                  />
                  <ToolContent>
                    <ToolInput input={input} />
                    {state === 'output-available' && (
                      <ToolOutput
                        output={
                          errorText ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {errorText}
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap font-mono text-sm">
                              {typeof output === 'string'
                                ? output
                                : JSON.stringify(output, null, 2)}
                            </div>
                          )
                        }
                        errorText={undefined}
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            if (type === 'source-url') {
              return (
                <a
                  key={key}
                  href={part.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-baseline text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <sup className="text-xs">[{part.title || part.url}]</sup>
                </a>
              );
            }

            if (type === 'data-error' && isCredentialErrorMessage(part.data)) {
              return (
                <MessageOAuthError
                  key={key}
                  error={part.data}
                  allMessages={allMessages}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                />
              );
            }
          })}

          {message.role === 'assistant' &&
            isLoading &&
            !message.parts.some(
              (p) => p.type === 'text' && (p as { text?: string }).text?.trim()
            ) && (
              <div className="mt-1">
                <ChatLoadingIndicator
                  activeToolMessage={getActiveToolMessage(message)}
                />
              </div>
            )}

          {!isReadonly && !hasOnlyErrors && (
            <MessageActions
              key={`action-${message.id}`}
              message={message}
              isLoading={isLoading}
              setMode={setMode}
              errorCount={errorParts.length}
              showErrors={showErrors}
              onToggleErrors={() => setShowErrors(!showErrors)}
            />
          )}

          {errorParts.length > 0 && (hasOnlyErrors || showErrors) && (
            <div className="flex flex-col gap-2">
              {errorParts.map((part, index) => (
                <MessageError
                  key={`error-${message.id}-${index}`}
                  error={part.data}
                />
              ))}
            </div>
          )}
        </div>

        {message.role === 'user' && (
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-800 text-xs font-medium text-white"
            data-testid="message-user-avatar"
          >
            {userInitials}
          </div>
        )}
      </div>
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding)
      return false;
    if (prevProps.showIntermediateSteps !== nextProps.showIntermediateSteps)
      return false;
    if (prevProps.isLastMessage !== nextProps.isLastMessage) return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;

    return true;
  },
);

export const AwaitingResponseMessage = ({
  activeToolMessage,
}: {
  activeToolMessage?: string | null;
} = {}) => {
  const role = 'assistant';

  return (
    <div
      data-testid="message-assistant-loading"
      className="group/message w-full"
      data-role={role}
    >
      <div className="flex items-start justify-start gap-3">
        <AnimatedAssistantIcon size={14} isLoading={false} muted={true} />

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="p-0">
            <ChatLoadingIndicator activeToolMessage={activeToolMessage} />
          </div>
        </div>
      </div>
    </div>
  );
};
