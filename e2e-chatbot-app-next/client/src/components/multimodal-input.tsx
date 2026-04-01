import type { UIMessage } from 'ai';
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage, useWindowSize } from 'usehooks-ts';

import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import { SuggestedActions } from './suggested-actions';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from './elements/prompt-input';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  Loader2,
  Mic,
  Paperclip,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';
import type { VisibilityType } from './visibility-selector';
import type { Attachment, ChatMessage } from '@chat-template/core';
import { softNavigateToChatId } from '@/lib/navigation';
import { useAppConfig } from '@/contexts/AppConfigContext';

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  selectedVisibilityType,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>['status'];
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<UIMessage>;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  selectedVisibilityType: VisibilityType;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const { chatHistoryEnabled } = useAppConfig();

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
    // adjustHeight is stable (useCallback with empty deps)
  }, [adjustHeight]);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  }, []);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'input',
    '',
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      adjustHeight();
    }
  }, [localStorageInput, setInput, adjustHeight]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);

  type VoiceState = 'idle' | 'listening' | 'processing';
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const isSpeaking = status === 'streaming';
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');

  const submitForm = useCallback(
    (overrideText?: string) => {
      const text = overrideText ?? input;
      softNavigateToChatId(chatId, chatHistoryEnabled);

      sendMessage({
        role: 'user',
        parts: [
          ...attachments.map((attachment) => ({
            type: 'file' as const,
            url: attachment.url,
            name: attachment.name,
            mediaType: attachment.contentType,
          })),
          {
            type: 'text',
            text,
          },
        ],
      });

      setAttachments([]);
      setLocalStorageInput('');
      resetHeight();
      setInput('');

      if (width && width > 768) {
        textareaRef.current?.focus();
      }
    },
    [
      input,
      setInput,
      attachments,
      sendMessage,
      setAttachments,
      setLocalStorageInput,
      width,
      chatId,
      chatHistoryEnabled,
      resetHeight,
    ],
  );

  const transcribe = useCallback(async (blob: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    const res = await fetch('/api/audio/transcribe', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Transcription failed');
    }
    const { text } = (await res.json()) as { text: string };
    return text;
  }, []);

  const startRecording = useCallback(async () => {
    try {
      console.log('[voice] Recording started');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      mimeTypeRef.current = mimeType;
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.start();
      setVoiceState('listening');
    } catch (err) {
      console.error('[voice] Microphone access denied', err);
      toast.error('Microphone access denied');
    }
  }, []);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    const stream = streamRef.current;
    if (!mr || mr.state !== 'recording') return;
    mr.stop();
    stream?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;

    mr.onstop = async () => {
      setVoiceState('processing');
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      console.log('[voice] Recording stopped, transcribing, blob size=', blob.size);
      try {
        const text = await transcribe(blob);
        console.log('[voice] Transcription success, length=', text.length);
        setVoiceState('idle');
        if (text.trim()) submitForm(text);
        else console.log('[voice] Empty transcription, not submitting');
      } catch (err) {
        console.error('[voice] Transcription failed', err);
        toast.error('Transcription failed');
        setVoiceState('idle');
      }
    };
  }, [transcribe, submitForm]);

  const abortRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    const stream = streamRef.current;
    if (!mr || mr.state !== 'recording') return;
    mr.onstop = () => setVoiceState('idle');
    mr.stop();
    stream?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType: contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (_error) {
      toast.error('Failed to upload file, please try again!');
    }
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined,
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error('Error uploading files!', error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile],
  );

  const { isAtBottom, scrollToBottom } = useScrollToBottom();

  useEffect(() => {
    if (status === 'submitted') {
      scrollToBottom();
    }
  }, [status, scrollToBottom]);

  return (
    <div className="relative flex w-full flex-col gap-4">
      <AnimatePresence>
        {!isAtBottom && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="-top-12 -translate-x-1/2 absolute left-1/2 z-50"
          >
            <Button
              data-testid="scroll-to-bottom-button"
              className="rounded-full"
              size="icon"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                scrollToBottom();
              }}
            >
              <ArrowDown />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions
            sendMessage={sendMessage}
            chatId={chatId}
            selectedVisibilityType={selectedVisibilityType}
          />
        )}

      <input
        type="file"
        className="-top-4 -left-4 pointer-events-none fixed size-0.5 opacity-0"
        ref={fileInputRef}
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
      />

      <PromptInput
        className="rounded-xl border-2 border-primary bg-background p-3 shadow-xs transition-all duration-200 focus-within:border-primary hover:border-primary/80"
        onSubmit={(event) => {
          event.preventDefault();
          if (status !== 'ready') {
            toast.error('Please wait for the model to finish its response!');
          } else {
            submitForm();
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            data-testid="attachments-preview"
            className="flex flex-row items-end gap-2 overflow-x-scroll"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                key={attachment.url}
                attachment={attachment}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url),
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                key={filename}
                attachment={{
                  url: '',
                  name: filename,
                  contentType: '',
                }}
                isUploading={true}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <PromptInputTextarea
              data-testid="multimodal-input"
              ref={textareaRef}
              placeholder="Ask Garv"
              value={input}
              onChange={handleInput}
              minHeight={44}
              maxHeight={200}
              disableAutoResize={true}
              className="w-full resize-none border-0! border-none! bg-transparent p-2 text-sm outline-none ring-0 [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden"
              rows={1}
              autoFocus
            />
            </div>
            {voiceState === 'listening' && (
              <div
                className="flex min-w-8 items-center justify-center gap-1 h-8 shrink-0 overflow-visible"
                aria-hidden
              >
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="min-w-[2px] w-0.5 rounded-full bg-muted-foreground/60"
                    style={{
                      animation: 'voice-bar 1.2s ease-in-out infinite',
                      animationDelay: `${i * 0.1}s`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4 text-muted-foreground" />
          </Button>
          {voiceState === 'listening' ? (
            <button
              type="button"
              className="voice-mic-listening flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none text-muted-foreground shadow-[0_0_4px_8px_rgba(254,226,226,0.5)] transition-colors hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 dark:shadow-[0_0_4px_10px_rgba(127,29,29,0.4)] [&_svg]:size-4"
              style={{ WebkitAppearance: 'none', appearance: 'none' }}
              disabled={false}
              onClick={stopRecording}
              aria-label="Stop recording"
            >
              <Mic className="h-4 w-4 text-muted-foreground" />
            </button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={
                status !== 'ready' ||
                uploadQueue.length > 0 ||
                voiceState === 'processing'
              }
              onClick={startRecording}
              aria-label={
                voiceState === 'processing'
                  ? 'Transcribing...'
                  : 'Record voice message'
              }
            >
              {voiceState === 'processing' ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Mic className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          )}
          {(voiceState === 'listening' ||
            status === 'submitted' ||
            status === 'streaming') ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/80"
              aria-label="Cancel"
              data-testid="cancel-button"
              onClick={() => {
                if (voiceState === 'listening') abortRecording();
                else {
                  stop();
                  setMessages((messages) => messages);
                }
              }}
            >
              <X className="size-3.5" />
            </Button>
          ) : (
            <PromptInputSubmit
              data-testid="send-button"
              status={status}
              disabled={!input.trim() || uploadQueue.length > 0}
              className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground transition-colors duration-200 hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
            >
              <ArrowRight size={14} />
            </PromptInputSubmit>
          )}
        </div>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(PureMultimodalInput, (prevProps, nextProps) => {
  if (prevProps.input !== nextProps.input) return false;
  if (prevProps.status !== nextProps.status) return false;
  if (!equal(prevProps.attachments, nextProps.attachments)) return false;
  if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType)
    return false;

  return true;
});

