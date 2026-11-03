import { describeFile, type SkillFileInfo } from "@/lib/skills";
import { DocIcon } from "./FileCard";

/** The chosen skill.md, waiting to be sent. */
export default function AttachmentChip({ file, onRemove }: { file: SkillFileInfo; onRemove: () => void }) {
  return (
    <div className="attach-chip">
      <DocIcon size={16} />
      <span className="file-name" title={file.fileName}>
        {file.fileName}
      </span>
      <span className="file-meta">{describeFile(file)}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${file.fileName}`}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
