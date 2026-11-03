"use client";

import { useEffect, useRef } from "react";
import type { Shot } from "@/hooks/useChat";

/** Thumbnails of the last screenshots. Clicking one replays it in the live view. */
export default function Filmstrip({
  shots,
  selected,
  onSelect,
}: {
  shots: Shot[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (selected === null) ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: "smooth" });
  }, [shots.length, selected]);

  if (!shots.length) return null;
  return (
    <ol className="filmstrip" ref={ref} aria-label="Replay key moments">
      {shots.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            className={selected === i ? "on" : ""}
            onClick={() => onSelect(i)}
            aria-label={`Show screenshot: ${s.caption}`}
            aria-pressed={selected === i}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/jpeg;base64,${s.data}`} alt="" />
            <span>{s.caption}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
