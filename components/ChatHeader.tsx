export type ChatStatus = "online" | "typing" | "searching";
const LABEL: Record<ChatStatus, string> = { online: "Online", typing: "Typing…", searching: "Searching MYFutureJobs…" };

export default function ChatHeader({
  status,
  skillCount,
  loginReady,
  loginOpen,
  onToggleLogin,
  onNewChat,
}: {
  status: ChatStatus;
  skillCount: number;
  loginReady: boolean;
  loginOpen: boolean;
  onToggleLogin: () => void;
  onNewChat: () => void;
}) {
  return (
    <header className="chat-header">
      <span className="avatar" aria-hidden>
        K
      </span>
      <div className="header-text">
        <h1>KerjaBot</h1>
        <div className="header-meta">
          <span className={`status ${status}`} role="status">
            <span className="status-dot" aria-hidden />
            {LABEL[status]}
          </span>
          {skillCount > 0 && (
            <span className="skills-pill">
              {skillCount} skill{skillCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className={`btn-login ${loginReady ? "ready" : ""}`}
        onClick={onToggleLogin}
        aria-expanded={loginOpen}
        aria-label={loginReady ? "MYFutureJobs login saved – edit" : "Enter MYFutureJobs login"}
        title="MYFutureJobs login"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        {loginReady && <span className="login-dot" aria-hidden />}
      </button>
      <button type="button" className="btn-new" onClick={onNewChat} aria-label="Start a new chat">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        New chat
      </button>
    </header>
  );
}
