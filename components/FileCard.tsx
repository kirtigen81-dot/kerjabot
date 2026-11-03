import { describeFile, type SkillFileInfo } from "@/lib/skills";

export function DocIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

/** A skill.md the user sent, shown on the user side of the chat. */
export default function FileCard({ file }: { file: SkillFileInfo }) {
  return (
    <div className="file-card">
      <span className="file-icon">
        <DocIcon />
      </span>
      <div className="file-info">
        <span className="file-name" title={file.fileName}>
          {file.fileName}
        </span>
        <span className="file-meta">{describeFile(file)}</span>
      </div>
      <span className="skill-pill">Skill</span>
    </div>
  );
}
