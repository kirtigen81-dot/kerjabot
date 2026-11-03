"use client";

import { useCallback, useEffect, useState } from "react";
import AttachmentChip from "@/components/AttachmentChip";
import ChatHeader, { type ChatStatus } from "@/components/ChatHeader";
import Composer from "@/components/Composer";
import LiveView from "@/components/LiveView";
import LoginPanel from "@/components/LoginPanel";
import MessageList from "@/components/MessageList";
import QuickReplies from "@/components/QuickReplies";
import { isBrowserStep } from "@/components/StepsCard";
import { useChat } from "@/hooks/useChat";

const MOBILE_QUERY = "(max-width: 899px)";

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

export default function Home() {
  const chat = useChat();
  const mobile = useIsMobile();
  const [ic, setIc] = useState("");
  const [pw, setPw] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);

  const loginReady = ic.replace(/-/g, "").length === 12 && pw.length > 0;
  const { send: sendRaw, busy } = chat;
  const send = useCallback(
    (text: string) => sendRaw(text, loginReady ? { icNumber: ic.replace(/-/g, ""), password: pw } : null),
    [sendRaw, loginReady, ic, pw],
  );

  // Mobile: open the live panel when the agent starts, fold it away when the answer is ready
  useEffect(() => {
    setLiveOpen(busy);
  }, [busy]);

  const last = chat.messages[chat.messages.length - 1];
  const status: ChatStatus = !busy ? "online" : last?.steps?.some(isBrowserStep) ? "searching" : "typing";
  const hasLive = Boolean(chat.live.image);

  return (
    <main className="page">
      <div className="chat-card">
        <ChatHeader
          status={status}
          skillCount={chat.skills.length}
          loginReady={loginReady}
          loginOpen={loginOpen}
          onToggleLogin={() => setLoginOpen((o) => !o)}
          onNewChat={chat.newChat}
        />
        {loginOpen && <LoginPanel ic={ic} pw={pw} onIc={setIc} onPw={setPw} onDone={() => setLoginOpen(false)} />}

        <MessageList messages={chat.messages} busy={busy} onSend={send} onRate={chat.rate} rated={chat.rated} />

        <div className="bottom">
          {mobile && (busy || hasLive) && (
            <div className="live-mobile">
              <button type="button" className="watch-live" onClick={() => setLiveOpen((o) => !o)} aria-expanded={liveOpen}>
                {busy && <span className="live-dot" aria-hidden />}
                {liveOpen ? "Hide live view" : "Watch live"}
              </button>
              {liveOpen && <LiveView live={chat.live} busy={busy} />}
            </div>
          )}
          {!busy && <QuickReplies chips={chat.chips} onPick={send} />}
          {chat.pending && <AttachmentChip file={chat.pending} onRemove={chat.removePending} />}
          <Composer busy={busy} hasAttachment={Boolean(chat.pending)} onSend={send} onStop={chat.stop} onFile={chat.attach} />
        </div>
      </div>

      {!mobile && (
        <aside className="live-pane">
          <LiveView live={chat.live} busy={busy} />
        </aside>
      )}
    </main>
  );
}
