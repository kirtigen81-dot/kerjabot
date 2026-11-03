/**
 * Shared NDJSON event protocol between POST /api/chat (server) and hooks/useChat (client).
 * Every line of the response body is one AgentEvent.
 */

/** Page coordinates are in this viewport; the client scales them to the displayed image. */
export const VIEWPORT = { width: 1366, height: 900 } as const;

export type StepStatus = "running" | "done" | "error";
export type Box = { x: number; y: number; width: number; height: number };
export type Fit = "high" | "medium" | "low";

export type JobItem = {
  index: number;
  title: string;
  company: string;
  location: string;
  salary: string;
  contract: string;
  hours: string;
  posted: string;
  fit: Fit;
  reason: string;
};

export type JobsPayload = { total: number; keyword: string; location: string; jobs: JobItem[] };

export type AgentEvent =
  | { type: "step"; id: string; status: StepStatus; title: string; detail?: string }
  | { type: "frame"; data: string }
  | { type: "url"; url: string }
  | { type: "cursor"; x: number; y: number; action: "click" | "type"; label: string }
  | { type: "highlight"; box: Box | null; label?: string }
  /** Screenshot after every browser action – the reliable live view (frames are the smooth extra). */
  | { type: "screenshot"; data: string; caption: string; url: string }
  /** `reset: true` discards text streamed so far (the model decided to call a tool instead). */
  | { type: "answer_delta"; text: string; reset?: boolean }
  | { type: "answer"; text: string }
  | ({ type: "jobs" } & JobsPayload)
  | { type: "chips"; chips: string[] }
  | { type: "memory"; memoryId: string | null; profile: string; learned: string[] }
  | { type: "error"; text: string }
  | { type: "done"; ms: number };

export type Emit = (e: AgentEvent) => void;
