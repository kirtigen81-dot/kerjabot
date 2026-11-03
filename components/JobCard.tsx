"use client";

import type { JobItem } from "@/lib/events";

const FIT = { high: "High match", medium: "Medium match", low: "Low match" } as const;

export default function JobCard({
  job,
  onView,
  onRate,
  rating,
  disabled,
}: {
  job: JobItem;
  onView: () => void;
  onRate: (liked: boolean) => void;
  rating?: boolean;
  disabled?: boolean;
}) {
  return (
    <article className="job-card">
      <div className="job-top">
        <span className="job-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
          </svg>
        </span>
        <div className="job-head">
          <h4>
            {job.index}. {job.title}
          </h4>
          {job.company && <p>{job.company}</p>}
        </div>
        <span className={`fit-badge fit-${job.fit}`}>{FIT[job.fit]}</span>
      </div>

      <div className="job-chips">
        {job.location && <span className="chip">📍 {job.location}</span>}
        <span className="chip salary">{job.salary || "not stated"}</span>
        {job.contract && <span className="chip">{[job.contract, job.hours].filter(Boolean).join(" · ")}</span>}
      </div>

      {job.reason && <p className="job-reason">{job.reason}</p>}

      <div className="job-actions">
        <button className="btn-view" onClick={onView} disabled={disabled} aria-label={`View details of job ${job.index}`}>
          View details
        </button>
        <button className={`btn-rate ${rating === true ? "on" : ""}`} onClick={() => onRate(true)} aria-label="I like this job" aria-pressed={rating === true}>
          👍
        </button>
        <button className={`btn-rate ${rating === false ? "on" : ""}`} onClick={() => onRate(false)} aria-label="I don't like this job" aria-pressed={rating === false}>
          👎
        </button>
      </div>
    </article>
  );
}
