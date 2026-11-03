/**
 * skill.md files the user uploads in the chat. Parsed in the browser, sent with every
 * POST /api/chat as `skills`, and added to DeepSeek's system prompt by lib/agent.ts.
 */

export const MAX_SKILL_BYTES = 50 * 1024;
export const MAX_SKILLS = 5;
/** Server-side cap per skill in the system prompt. */
export const MAX_SKILL_PROMPT_CHARS = 8000;

export type Skill = { title: string; fileName: string; content: string; size: number; lines: number };
export type SkillFileInfo = Omit<Skill, "content">;

export const isMarkdownFile = (name: string) => /\.(md|markdown)$/i.test(name);

/** `name:` in YAML frontmatter, else the first "# " heading, else the file name without extension. */
export function skillTitle(content: string, fileName: string): string {
  const fm = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const name = fm?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1];
  if (name) return name.trim();
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  if (heading) return heading.trim();
  return fileName.replace(/\.[^.]+$/, "");
}

export const countLines = (content: string) => (content ? content.split(/\r?\n/).length : 0);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const describeFile = (f: Pick<SkillFileInfo, "size" | "lines">) => `${formatSize(f.size)} · ${f.lines} lines`;

/** Browser only: reads and validates a chosen file. */
export function readSkillFile(file: File): Promise<{ ok: true; skill: Skill } | { ok: false; error: string }> {
  if (!isMarkdownFile(file.name)) {
    return Promise.resolve({ ok: false, error: `"${file.name}" bukan fail .md. Sila pilih fail skill dalam format Markdown (.md).` });
  }
  if (file.size > MAX_SKILL_BYTES) {
    return Promise.resolve({ ok: false, error: `"${file.name}" terlalu besar (${formatSize(file.size)}). Had maksimum ialah 50 KB.` });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      if (!content.trim()) {
        resolve({ ok: false, error: `"${file.name}" kosong.` });
        return;
      }
      resolve({
        ok: true,
        skill: { title: skillTitle(content, file.name), fileName: file.name, content, size: file.size, lines: countLines(content) },
      });
    };
    reader.onerror = () => resolve({ ok: false, error: `Tak dapat baca "${file.name}".` });
    reader.readAsText(file);
  });
}

/** Server side: validates the `skills` field of a request body. */
export function sanitizeSkills(raw: unknown): { title: string; content: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is { title: unknown; content: unknown } => typeof s === "object" && s !== null)
    .map((s) => ({ title: String(s.title ?? "Skill").slice(0, 120), content: String(s.content ?? "").slice(0, MAX_SKILL_PROMPT_CHARS) }))
    .filter((s) => s.content.trim())
    .slice(0, MAX_SKILLS);
}
