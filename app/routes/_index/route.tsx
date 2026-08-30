import { timingSafeEqual } from "node:crypto";
import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import { LANDING_HTML } from "./content.server";
import styles from "./styles.module.css";

// Reveal 10 minutes before the submission deadline
// (2026-09-04 05:00 JST = 2026-09-03 20:00 UTC). Override with LANDING_REVEAL_AT.
const DEFAULT_REVEAL_AT = "2026-09-03T19:50:00Z";

/** `?hash=<SKIP_COUNTDOWN_PASS>` previews the page before the reveal time. */
function hasPreviewPass(provided: string | null, expected: string | undefined) {
  if (!expected || !provided) return false;
  const given = Buffer.from(provided);
  const secret = Buffer.from(expected);
  if (given.length !== secret.length) return false;
  return timingSafeEqual(given, secret);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Keep this: Shopify opens the app URL with ?shop=... and expects a redirect
  // into the embedded app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // eslint-disable-next-line no-undef
  const revealAt = process.env.LANDING_REVEAL_AT || DEFAULT_REVEAL_AT;
  const preview = hasPreviewPass(
    url.searchParams.get("hash"),
    // eslint-disable-next-line no-undef
    process.env.SKIP_COUNTDOWN_PASS,
  );
  const revealed = preview || Date.now() >= new Date(revealAt).getTime();

  // The markup is only ever sent once revealed (or with a valid preview pass).
  return { revealAt, html: revealed ? LANDING_HTML : null };
};

// Never let a proxy or browser cache the pre-reveal page past the deadline.
export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store",
});

function useCountdown(revealAt: string) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(revealAt).getTime();
    const tick = () => {
      const left = target - Date.now();
      setRemaining(left);
      if (left <= 0) window.location.reload();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [revealAt]);

  return remaining;
}

function Countdown({ revealAt }: { revealAt: string }) {
  const remaining = useCountdown(revealAt);

  const parts =
    remaining == null
      ? null
      : {
          days: Math.max(0, Math.floor(remaining / 86_400_000)),
          hours: Math.max(0, Math.floor((remaining / 3_600_000) % 24)),
          minutes: Math.max(0, Math.floor((remaining / 60_000) % 60)),
          seconds: Math.max(0, Math.floor((remaining / 1000) % 60)),
        };

  return (
    <main className={styles.card}>
      <span className={styles.badge}>COMING SOON</span>
      <h1 className={styles.heading}>Something is being arranged.</h1>
      <p className={styles.lede}>
        This shop is getting ready. Please check back when the timer runs out.
      </p>

      <div className={styles.clock} aria-live="polite">
        {parts ? (
          <>
            <Unit value={parts.days} label="days" />
            <Unit value={parts.hours} label="hours" />
            <Unit value={parts.minutes} label="minutes" />
            <Unit value={parts.seconds} label="seconds" />
          </>
        ) : (
          <span className={styles.placeholder}>&nbsp;</span>
        )}
      </div>
    </main>
  );
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <span className={styles.unit}>
      <b className={styles.unitValue}>{String(value).padStart(2, "0")}</b>
      <small className={styles.unitLabel}>{label}</small>
    </span>
  );
}

export default function Index() {
  const { revealAt, html } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      {html ? (
        <div
          className={styles.card}
          // Static, server-owned markup — see content.server.ts.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <Countdown revealAt={revealAt} />
      )}
    </div>
  );
}
