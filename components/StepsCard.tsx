"use client";

import { useState } from "react";
import type { Step } from "@/hooks/useChat";

/** Browser steps (ids "b…") plus the final thinking step belong in this card. */
export const isBrowserStep = (s: Step) => s.id.startsWith("b") || s.firstTitle.startsWith("Thinking about the best matches");

const VISIBLE_WHILE_RUNNING = 4; // last 3 steps + the current one

export default function StepsCard({
  steps,
  working,
  totalMs,
  jobsTotal,
}: {
  steps: Step[];
  working: boolean;
  totalMs?: number;
  jobsTotal?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = steps.filter(isBrowserStep);
  if (!shown.length) return null;

  const failed = shown.some((s) => s.status === "error");
  const found = jobsTotal ?? Number(shown.map((s) => s.title.match(/Found ([\d,]+) jobs/)?.[1]).find(Boolean)?.replace(/,/g, "") ?? NaN);

  if (!working && !showAll) {
    return (
      <div className={`steps-line ${failed ? "failed" : ""}`}>
        <span className="steps-line-icon" aria-hidden>
          {failed ? "!" : "✓"}
        </span>
        <span className="steps-line-text">
          {failed ? "Stopped" : "Done"}
          {totalMs !== undefined && ` in ${Math.round(totalMs / 1000)}s`} · {shown.length} steps
          {Number.isFinite(found) && ` · ${found.toLocaleString("en-MY")} jobs found`}
        </span>
        <button type="button" onClick={() => setShowAll(true)} aria-expanded={false}>
          Show steps
        </button>
      </div>
    );
  }

  const list = working && !showAll ? shown.slice(-VISIBLE_WHILE_RUNNING) : shown;
  return (
    <div className="steps-card" role="group" aria-label="Agent steps">
      <div className="steps-head">
        <span className="steps-title">{working ? `Searching MYFutureJobs… (step ${shown.length})` : "Done · searched MYFutureJobs"}</span>
        <button type="button" className="steps-toggle" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll}>
          {showAll ? (working ? "Show less" : "Hide steps") : "Show all steps"}
        </button>
      </div>
      <ol className={`steps-list ${showAll ? "all" : ""}`} aria-live="polite">
        {list.map((s) => (
          <li key={s.id} className={`step ${s.status}`}>
            <StepIcon status={s.status} />
            <span className="step-text">
              {s.title}
              {s.detail && <small>{s.detail}</small>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepIcon({ status }: { status: Step["status"] }) {
  if (status === "running") return <span className="step-icon running" aria-label="Running" />;
  if (status === "error")
    return (
      <span className="step-icon error" aria-label="Failed">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
    );
  return (
    <span className="step-icon done" aria-label="Done">
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
