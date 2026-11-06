"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Box, JobsPayload, StepStatus } from "@/lib/events";
import { MAX_SKILLS, readSkillFile, type Skill, type SkillFileInfo } from "@/lib/skills";

export type Step = { id: string; status: StepStatus; title: string; /** title when it started, used to place it in the plan */ firstTitle: string; detail?: string };

export type ChatMessage = {
  id: string;
  role: "user" | "bot";
  content: string;
  file?: SkillFileInfo;
  steps?: Step[];
  jobs?: JobsPayload;
  streaming?: boolean;
  error?: boolean;
  /** run duration, from the server's done event */
  totalMs?: number;
};

export type Shot = { data: string; caption: string; url: string };
export type LiveState = {
  /** latest image: a screencast frame or a screenshot */
  image: string | null;
  url: string;
  caption: string;
  /** last 12 screenshots, for replay */
  shots: Shot[];
  cursor: { x: number; y: number; action: "click" | "type"; label: string; seq: number } | null;
  highlight: { box: Box; label: string } | null;
};
const EMPTY_LIVE: LiveState = { image: null, url: "", caption: "", shots: [], cursor: null, highlight: null };

export type Credentials = { icNumber: string; password: string } | null;

const GREETING =
  "Hai! Saya KerjaBot 👋 Saya boleh cari kerja di MYFutureJobs untuk anda.\nApakah tahap pendidikan tertinggi dan bidang pengajian anda?";
const START_CHIPS = ["Ijazah Sains Komputer", "Diploma Perakaunan"];

let seq = 0;
const newId = () => `m${Date.now().toString(36)}${++seq}`;
// Fixed id: the greeting is server-rendered, so a time-based id would not match on hydration
const greeting = (): ChatMessage => ({ id: "greeting", role: "bot", content: GREETING });

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [greeting()]);
  const [chips, setChips] = useState<string[]>(START_CHIPS);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pending, setPending] = useState<Skill | null>(null);
  const [busy, setBusy] = useState(false);
  const [memoryId, setMemoryId] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);
  const abortRef = useRef<AbortController | null>(null);
  /** step id -> id of an earlier step with the same title (repeats are merged into one row) */
  const stepAlias = useRef(new Map<string, string>());
  const cursorSeq = useRef(0);

  useEffect(() => {
    setMemoryId(safeStorage()?.getItem("kerjabot.memoryId") ?? null);
  }, []);

  const addBot = useCallback((content: string, error = false) => {
    setMessages((ms) => [...ms, { id: newId(), role: "bot", content, error }]);
  }, []);

  /** Updates the bot message that is currently streaming (always the last message). */
  const patchLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((ms) => {
      const i = ms.length - 1;
      if (i < 0 || ms[i].role !== "bot") return ms;
      const copy = ms.slice();
      copy[i] = fn(ms[i]);
      return copy;
    });
  }, []);

  const handle = useCallback(
    (ev: AgentEvent) => {
      switch (ev.type) {
        case "step":
          patchLast((m) => {
            const steps = m.steps ?? [];
            let id = stepAlias.current.get(ev.id) ?? ev.id;
            let at = steps.findIndex((s) => s.id === id);
            if (at < 0) {
              // Same title as an earlier step (e.g. a repeated search) -> update that row instead of adding one
              const same = steps.findIndex((s) => s.firstTitle === ev.title || s.title === ev.title);
              if (same >= 0) {
                stepAlias.current.set(ev.id, steps[same].id);
                id = steps[same].id;
                at = same;
              }
            }
            if (at < 0) return { ...m, steps: [...steps, { id, status: ev.status, title: ev.title, firstTitle: ev.title, detail: ev.detail }] };
            const copy = steps.slice();
            copy[at] = { ...copy[at], status: ev.status, title: ev.title, detail: ev.detail };
            return { ...m, steps: copy };
          });
          if (ev.status === "running") setLive((l) => ({ ...l, caption: ev.title }));
          break;
        case "frame":
          setLive((l) => ({ ...l, image: ev.data }));
          break;
        case "screenshot":
          setLive((l) => ({
            ...l,
            image: ev.data,
            url: ev.url || l.url,
            caption: ev.caption,
            shots: [...l.shots, { data: ev.data, caption: ev.caption, url: ev.url }].slice(-12),
          }));
          break;
        case "url":
          setLive((l) => ({ ...l, url: ev.url }));
          break;
        case "cursor":
          setLive((l) => ({ ...l, cursor: { x: ev.x, y: ev.y, action: ev.action, label: ev.label, seq: ++cursorSeq.current } }));
          break;
        case "highlight":
          setLive((l) => ({ ...l, highlight: ev.box ? { box: ev.box, label: ev.label ?? "" } : null }));
          break;
        case "done":
          patchLast((m) => ({ ...m, totalMs: ev.ms }));
          break;
        case "answer_delta":
          patchLast((m) => ({ ...m, content: ev.reset ? "" : m.content + ev.text }));
          break;
        case "answer":
          patchLast((m) => ({ ...m, content: ev.text }));
          break;
        case "jobs": {
          const { type: _type, ...jobs } = ev;
          patchLast((m) => ({ ...m, jobs }));
          break;
        }
        case "chips":
          setChips(ev.chips);
          break;
        case "memory":
          if (ev.memoryId) {
            setMemoryId(ev.memoryId);
            safeStorage()?.setItem("kerjabot.memoryId", ev.memoryId);
          }
          break;
        case "error":
          addBot(`⚠️ ${ev.text}`, true);
          break;
      }
    },
    [patchLast, addBot],
  );

  /** Streams one agent run. `history` already contains the new user message. */
  const run = useCallback(
    async (history: ChatMessage[], credentials: Credentials, skillList: Skill[]) => {
      setMessages([...history, { id: newId(), role: "bot", content: "", steps: [], streaming: true }]);
      setChips([]);
      setBusy(true);
      stepAlias.current.clear();
      setLive((l) => ({ ...l, caption: "", shots: [], cursor: null, highlight: null }));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const started = Date.now();
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            messages: history
              .filter((m) => m.content && !m.file && !m.error)
              .map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.content })),
            memoryId,
            credentials,
            skills: skillList.map(({ title, content }) => ({ title, content })),
          }),
        });
        if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              handle(JSON.parse(line) as AgentEvent);
            } catch {
              /* skip a malformed line */
            }
          }
        }
      } catch (err) {
        if (ctrl.signal.aborted) patchLast((m) => ({ ...m, content: m.content || "⏹ Dihentikan." }));
        else addBot(`⚠️ ${(err as Error).message || "Network error"}`, true);
      } finally {
        abortRef.current = null;
        setBusy(false);
        setLive((l) => ({ ...l, caption: "", cursor: null, highlight: null }));
        // Drop an empty streaming bubble and settle any step left running
        const settled: StepStatus = ctrl.signal.aborted ? "error" : "done";
        setMessages((ms) =>
          ms
            .map((m) =>
              m.streaming
                ? {
                    ...m,
                    streaming: false,
                    totalMs: m.totalMs ?? Date.now() - started,
                    steps: m.steps?.map((s) => (s.status === "running" ? { ...s, status: settled } : s)),
                  }
                : m,
            )
            .filter((m) => m.role === "user" || m.content || m.steps?.some((s) => s.id.startsWith("b")) || m.jobs),
        );
      }
    },
    [memoryId, handle, patchLast, addBot],
  );

  /** Choose a skill.md file: validated now, sent with the next message. */
  const attach = useCallback(
    async (file: File) => {
      if (skills.length >= MAX_SKILLS) {
        addBot(`Maksimum ${MAX_SKILLS} skill setiap chat. Tekan "New chat" untuk mula semula.`, true);
        return;
      }
      const r = await readSkillFile(file);
      if (r.ok) setPending(r.skill);
      else addBot(r.error, true);
    },
    [skills.length, addBot],
  );

  const send = useCallback(
    (text: string, credentials: Credentials) => {
      const content = text.trim();
      if (busy || (!content && !pending)) return;
      let history = messages;
      let skillList = skills;

      if (pending) {
        const { content: _c, ...info } = pending;
        skillList = [...skills, pending];
        history = [
          ...history,
          { id: newId(), role: "user", content: "", file: info },
          { id: newId(), role: "bot", content: `Skill ditambah: ${pending.title}. Saya akan ikut arahan dalam fail ini.` },
        ];
        setSkills(skillList);
        setPending(null);
      }
      if (!content) {
        setMessages(history);
        return;
      }
      void run([...history, { id: newId(), role: "user", content }], credentials, skillList);
    },
    [busy, pending, messages, skills, run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([greeting()]);
    setChips(START_CHIPS);
    setSkills([]);
    setPending(null);
    setRated({});
    setLive(EMPTY_LIVE);
  }, []);

  const rate = useCallback(
    async (job: string, liked: boolean) => {
      setRated((r) => ({ ...r, [job]: liked }));
      // Always sent: the shared ACE playbook learns from feedback even without a personal memory id
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryId, job, liked }),
      }).catch(() => {});
    },
    [memoryId],
  );

  return {
    messages,
    chips,
    skills,
    pending,
    busy,
    rated,
    live,
    send,
    stop,
    attach,
    removePending: () => setPending(null),
    newChat,
    rate,
  };
}
