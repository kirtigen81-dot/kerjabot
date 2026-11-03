"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LiveState } from "@/hooks/useChat";
import { VIEWPORT } from "@/lib/events";
import Filmstrip from "./Filmstrip";

/** Where the 1366x900 page lands inside the stage (object-fit: contain). */
type Fit = { scale: number; dx: number; dy: number };

/** Live screen of the agent's browser: URL bar, LIVE badge, caption, cursor overlay and replay thumbnails. */
export default function LiveView({ live, busy }: { live: LiveState; busy: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ scale: 0, dx: 0, dy: 0 });
  const [selected, setSelected] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const scale = Math.min(width / VIEWPORT.width, height / VIEWPORT.height);
      setFit({ scale, dx: (width - VIEWPORT.width * scale) / 2, dy: (height - VIEWPORT.height * scale) / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new run clears the thumbnails -> back to live
  useEffect(() => {
    if (!live.shots.length) setSelected(null);
  }, [live.shots.length]);

  const replay = selected !== null ? live.shots[selected] : undefined;
  const image = replay?.data ?? live.image;
  const url = replay?.url ?? live.url;
  const overlay = !replay && busy;
  const px = (x: number) => fit.dx + x * fit.scale;
  const py = (y: number) => fit.dy + y * fit.scale;

  let host = "";
  try {
    host = url ? new URL(url).host : "";
  } catch {
    /* not a URL */
  }

  return (
    <section className="live" aria-label="Agent live view">
      <div className="live-chrome">
        <span className="live-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <div className="urlbar" title={url}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden className={url.startsWith("https") ? "lock" : "lock off"}>
            <path fill="currentColor" d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V7Z" />
          </svg>
          <span className="url-text">
            {url ? (
              <>
                <b>{host}</b>
                {url.slice(url.indexOf(host) + host.length)}
              </>
            ) : (
              "about:blank"
            )}
          </span>
        </div>
        {replay ? (
          <button type="button" className="back-live" onClick={() => setSelected(null)} aria-label="Back to live view">
            ↻ Back to live
          </button>
        ) : (
          busy && (
            <span className="live-badge" aria-label="Live">
              ● LIVE
            </span>
          )
        )}
      </div>

      <div className="stage" ref={stageRef}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="screen" src={`data:image/jpeg;base64,${image}`} alt={replay ? replay.caption : "Live view of KerjaBot's browser"} />
        ) : (
          <div className="live-empty">
            <svg viewBox="0 0 160 110" width="140" aria-hidden>
              <rect x="10" y="12" width="140" height="86" rx="12" fill="var(--page)" stroke="var(--line)" />
              <rect x="10" y="12" width="140" height="18" rx="9" fill="var(--navy-tint)" />
              <circle cx="22" cy="21" r="3" fill="#C2490A" />
              <rect x="26" y="44" width="70" height="10" rx="5" fill="var(--line)" />
              <rect x="26" y="62" width="100" height="8" rx="4" fill="var(--line)" />
              <rect x="26" y="76" width="56" height="8" rx="4" fill="var(--line)" />
              <path d="M112 46l14 6-6 2-2 6z" fill="#C2490A" />
            </svg>
            <p>Bila KerjaBot guna MYFutureJobs, anda boleh tengok di sini.</p>
          </div>
        )}

        {(overlay ? live.caption : replay?.caption) && (
          <div className="caption-bar" aria-live="polite">
            {overlay && <i className="caption-spin" aria-hidden />}
            {overlay ? `${live.caption}…` : `⏸ ${replay!.caption}`}
          </div>
        )}

        {overlay && live.highlight && fit.scale > 0 && (
          <div
            className="hl-box"
            style={{
              left: px(live.highlight.box.x) - 4,
              top: py(live.highlight.box.y) - 4,
              width: live.highlight.box.width * fit.scale + 8,
              height: live.highlight.box.height * fit.scale + 8,
            }}
          >
            <span>{live.highlight.label}</span>
          </div>
        )}

        {overlay && live.cursor && fit.scale > 0 && (
          <div className="cursor" style={{ transform: `translate(${px(live.cursor.x)}px, ${py(live.cursor.y)}px)` }} aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M4 2l15 8-6.5 1.6L9.7 18z" fill="#241E6B" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            {live.cursor.action === "click" && <span key={live.cursor.seq} className="ripple" />}
          </div>
        )}
      </div>

      <Filmstrip shots={live.shots} selected={selected} onSelect={setSelected} />
    </section>
  );
}
