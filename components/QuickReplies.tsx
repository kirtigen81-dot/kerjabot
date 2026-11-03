export default function QuickReplies({ chips, onPick }: { chips: string[]; onPick: (text: string) => void }) {
  if (!chips.length) return null;
  return (
    <div className="quick-replies" role="group" aria-label="Quick replies">
      {chips.map((c) => (
        <button key={c} type="button" onClick={() => onPick(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}
