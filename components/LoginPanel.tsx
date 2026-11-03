"use client";

import { useState } from "react";

/** MYFutureJobs IC number + password, opened from the lock button in the header. */
export default function LoginPanel({
  ic,
  pw,
  onIc,
  onPw,
  onDone,
}: {
  ic: string;
  pw: string;
  onIc: (v: string) => void;
  onPw: (v: string) => void;
  onDone: () => void;
}) {
  const [showPw, setShowPw] = useState(false);
  const ready = ic.replace(/-/g, "").length === 12 && pw.length > 0;

  return (
    <form
      className="login-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onDone();
      }}
    >
      <div className="login-fields">
        <label>
          <span>Nombor Kad Pengenalan</span>
          <input
            inputMode="numeric"
            placeholder="tanpa (-) e.g. 900101145678"
            value={ic}
            maxLength={14}
            onChange={(e) => onIc(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          <span>Kata Laluan</span>
          <div className="pw">
            <input type={showPw ? "text" : "password"} value={pw} onChange={(e) => onPw(e.target.value)} autoComplete="current-password" />
            <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        <button type="submit" className="btn-save" disabled={!ready}>
          Save
        </button>
      </div>
      <p className="login-hint">🔒 Kept only in this tab and used to log in to MYFutureJobs for you. Never stored, never shown to the AI.</p>
    </form>
  );
}
