import { runAgent, type ChatTurn } from "@/lib/agent";
import type { AgentEvent } from "@/lib/events";
import { sanitizeSkills } from "@/lib/skills";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby max. Raise on Pro if searches time out.
export const dynamic = "force-dynamic";

type Body = {
  messages: ChatTurn[];
  memoryId?: string | null;
  credentials?: { icNumber: string; password: string } | null;
  skills?: { title: string; content: string }[];
};

/** Streams newline-delimited JSON AgentEvents (see lib/events.ts). */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return new Response("messages required", { status: 400 });
  }

  const creds =
    body.credentials?.icNumber && body.credentials?.password
      ? { icNumber: String(body.credentials.icNumber), password: String(body.credentials.password) }
      : null;

  // Last line of defence: no event text may ever contain the IC number or password.
  const secrets = creds ? [creds.icNumber, creds.icNumber.replace(/-/g, ""), creds.password].filter((s) => s.length >= 4) : [];
  const redact = (line: string) => secrets.reduce((l, s) => l.split(s).join("•••"), line);

  // Aborts when the client presses Stop (fetch aborted) or the connection drops.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const enc = new TextEncoder();
  const started = Date.now();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        if (closed) return;
        // Image data is base64 only; every text field goes through redact()
        const line =
          e.type === "frame"
            ? JSON.stringify(e)
            : e.type === "screenshot"
              ? JSON.stringify({ ...e, caption: redact(e.caption), url: redact(e.url) })
              : redact(JSON.stringify(e));
        try {
          controller.enqueue(enc.encode(line + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await runAgent({
          messages: body.messages
            .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
          creds,
          memoryId: body.memoryId ?? null,
          emit,
          signal: abort.signal,
          skills: sanitizeSkills(body.skills),
        });
      } catch (err) {
        if (!abort.signal.aborted) emit({ type: "error", text: (err as Error).message });
      } finally {
        emit({ type: "done", ms: Date.now() - started });
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
