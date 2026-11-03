"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/hooks/useChat";
import FileCard from "./FileCard";
import JobCard from "./JobCard";
import StepsCard, { isBrowserStep } from "./StepsCard";

type Props = {
  msg: ChatMessage;
  busy: boolean;
  onSend: (text: string) => void;
  onRate: (job: string, liked: boolean) => void;
  rated: Record<string, boolean>;
};

function MessageBubble({ msg, busy, onSend, onRate, rated }: Props) {
  if (msg.role === "user") {
    return (
      <div className="msg user">
        {msg.file ? <FileCard file={msg.file} /> : <div className="bubble">{msg.content}</div>}
      </div>
    );
  }

  const working = Boolean(msg.streaming);
  const hasSteps = Boolean(msg.steps?.some(isBrowserStep));
  return (
    <div className="msg bot">
      <span className="avatar-sm" aria-hidden>
        K
      </span>
      <div className="bot-body">
        {hasSteps && <StepsCard steps={msg.steps!} working={working} totalMs={msg.totalMs} jobsTotal={msg.jobs?.total} />}

        {msg.content ? (
          <div className={`bubble ${msg.error ? "error" : ""}`} id={`answer-${msg.id}`}>
            <div className="md">
              <ReactMarkdown>{msg.content.replace(/(?<!\n)\n(?!\n)/g, "  \n")}</ReactMarkdown>
            </div>
          </div>
        ) : (
          working &&
          !hasSteps && (
            <div className="bubble typing" aria-label="KerjaBot is typing">
              <i />
              <i />
              <i />
            </div>
          )
        )}

        {msg.jobs && msg.jobs.jobs.length > 0 && (
          <section className="jobs" aria-label="Job results">
            {msg.jobs.jobs.map((j) => {
              const key = `${j.title} – ${j.company}`;
              return (
                <JobCard
                  key={`${j.index}-${j.title}`}
                  job={j}
                  disabled={busy}
                  onView={() => onSend(`open job ${j.index}`)}
                  onRate={(liked) => onRate(key, liked)}
                  rating={rated[key]}
                />
              );
            })}
          </section>
        )}

      </div>
    </div>
  );
}

export default memo(MessageBubble);
