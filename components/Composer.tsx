"use client";

import { useRef, useState } from "react";

export default function Composer({
  busy,
  hasAttachment,
  onSend,
  onStop,
  onFile,
}: {
  busy: boolean;
  hasAttachment: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onFile: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !busy && (text.trim().length > 0 || hasAttachment);

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend) return;
        onSend(text);
        setText("");
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".md,text/markdown"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = ""; // allow choosing the same file again
        }}
      />
      <button type="button" className="btn-skill" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach a skill.md file">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
        </svg>
        <span className="btn-skill-label">skill.md</span>
      </button>

      <input
        className="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={hasAttachment ? "Tambah mesej (pilihan) dan tekan hantar" : "Tanya KerjaBot… e.g. Cari kerja IT lecturer di KL"}
        aria-label="Message KerjaBot"
      />

      {busy ? (
        <button type="button" className="btn-stop" onClick={onStop} aria-label="Stop KerjaBot">
          <span aria-hidden>■</span> Stop
        </button>
      ) : (
        <button type="submit" className="btn-send" disabled={!canSend} aria-label="Send message">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </form>
  );
}
