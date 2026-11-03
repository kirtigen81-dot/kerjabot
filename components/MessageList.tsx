"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useChat";
import MessageBubble from "./MessageBubble";

type Props = {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onRate: (job: string, liked: boolean) => void;
  rated: Record<string, boolean>;
};

export default function MessageList({ messages, busy, onSend, onRate, rated }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const answered = useRef(new Set<string>());
  const last = messages[messages.length - 1];
  const lastHasAnswer = Boolean(last?.role === "bot" && last.content);

  // New message or new steps (before the answer): keep the bottom in view
  useEffect(() => {
    if (!lastHasAnswer) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, last?.steps, lastHasAnswer]);

  // When the answer starts, scroll to the top of the answer (not the end of the steps) and stay there
  useEffect(() => {
    if (!last || !lastHasAnswer || answered.current.has(last.id)) return;
    answered.current.add(last.id);
    document.getElementById(`answer-${last.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [last, lastHasAnswer]);

  return (
    <div className="messages" aria-live="polite" aria-label="Conversation">
      <div className="messages-inner">
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} busy={busy} onSend={onSend} onRate={onRate} rated={rated} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
