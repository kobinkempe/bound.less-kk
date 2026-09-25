import React, { useCallback, useEffect, useRef, useState } from "react";
import useClickAway from "./useClickAway";

/**
 * Sync state in the editor (SYNC-PLAN R9, the 2026-09-23 redesign): a status button inside the
 * title chip (icon only on a phone, icon and a short label on a desktop) that opens a details
 * card, and a banner under the top bar while another tab or device has the pen, while the pen
 * moves, and for a few seconds after "Edit here". `sync` is CanvasSession.state.
 */

/** The full sentence for the state: the status button's accessible name. */
export function syncLabel(sync, signedIn) {
    if (!sync) return "Opening…";
    if (sync.mode === "readonly") return sync.why === "tab" ? "Read-only — open in another tab" : `Read-only — editing on ${(sync.holder && sync.holder.name) || "another device"}`;
    if (sync.mode === "taking") return "Taking over…";
    if (sync.mode === "handing") return "Handing over…";
    if (sync.mode === "starting") return "Checking for changes…";
    if (!signedIn || sync.cloud === "off" || sync.cloud === "local") return "Saved on this device";
    if (sync.cloud === "saving") return "Saving…";
    if (sync.cloud === "offline") return "Offline, saved on this device";
    if (sync.cloud === "error") return "Not synced — saved on this device";
    if (sync.cloud === "checking") return "Checking for changes…";
    return "Saved";
}

/** `{ key, short, icon, tone }`: what the status button shows. An error shows, except offline editing's. */
export function syncStatus(sync, signedIn) {
    if (!sync) return { key: "opening", short: "Opening…", icon: "up", tone: "muted" };
    if (sync.error && !(sync.mode === "editing" && sync.cloud === "offline")) {
        return { key: "error", short: sync.mode === "editing" ? "Not synced — saved here" : "Sync problem", icon: "alert", tone: "red" };
    }
    if (sync.mode === "readonly" || sync.mode === "taking") return { key: "viewing", short: "Viewing", icon: "eye", tone: "muted" };
    if (sync.mode === "handing") return { key: "saving", short: "Saving…", icon: "up", tone: "muted" };
    if (sync.mode === "starting") return { key: "checking", short: "Checking…", icon: "up", tone: "muted" };
    if (!signedIn || sync.cloud === "off" || sync.cloud === "local") return { key: "local", short: "Saved here", icon: "check", tone: "muted" };
    if (sync.cloud === "saving") return { key: "saving", short: "Saving…", icon: "up", tone: "muted" };
    if (sync.cloud === "offline") return { key: "offline", short: "Offline — saved here", icon: "off", tone: "amber" };
    if (sync.cloud === "error") return { key: "error", short: "Not synced — saved here", icon: "alert", tone: "red" };
    if (sync.cloud === "checking") return { key: "checking", short: "Checking…", icon: "up", tone: "muted" };
    return { key: "saved", short: "Saved", icon: "cloudCheck", tone: "green" };
}

/** The details card's headline: the error when there is one. */
export function syncSentence(sync, signedIn) {
    if (sync && sync.error) return sync.error;
    const s = syncStatus(sync, signedIn);
    if (s.key === "saved") return "Saved to your account";
    if (s.key === "saving" && signedIn && sync.mode === "editing") return "Saving to your account…";
    return syncLabel(sync, signedIn);
}

/**
 * The status button's name: the full sentence and any error; on a desktop it begins with the
 * visible label (WCAG label in name).
 */
export function syncName(sync, signedIn, compact) {
    const s = syncStatus(sync, signedIn);
    const label = syncLabel(sync, signedIn);
    const name = compact || s.short === label ? label : `${s.short} — ${label}`;
    return sync && sync.error ? `${name}. ${sync.error}` : name;
}

// The pen moving is the banner's to show; a notice would say it twice.
const PEN_NOTICES = new Set(["handed", "lost", "stolen"]);
/** Whether a session notice gets the notice banner. */
export function showsNotice(n) {
    return !!n && !!n.message && !PEN_NOTICES.has(n.kind);
}

/** True at a phone's width (≤ 480 px): the status button is an icon and the title chip is bounded. */
export function useNarrow(max = 480) {
    const query = `(max-width: ${max}px)`;
    const read = () => (typeof window === "undefined" ? false
        : window.matchMedia ? window.matchMedia(query).matches : window.innerWidth <= max);
    const [narrow, setNarrow] = useState(read);
    useEffect(() => {
        const on = () => setNarrow(read());
        window.addEventListener("resize", on);
        on();
        return () => window.removeEventListener("resize", on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);
    return narrow;
}

const svg = (size, children, stroke = "currentColor", width = 1.8) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const CLOUD = <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5Z" />;
function StatusIcon({ icon, size }) {
    switch (icon) {
        case "cloudCheck": return svg(size, <>{CLOUD}<path d="m9.5 13 2 2 3.5-3.5" /></>);
        case "up": return svg(size, <>{CLOUD}<path d="M12 16v-5" /><path d="m9.5 13 2.5-2.5 2.5 2.5" /></>);
        case "off": return svg(size, <><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 9 5.6" /><path d="M14.5 5.3A6 6 0 0 1 18 8.5a4 4 0 0 1 1.9 7.3" /><path d="M3 3l18 18" /></>);
        case "alert": return svg(size, <>{CLOUD}<path d="M12 10v3" /><path d="M12 16h.01" /></>);
        case "eye": return svg(size, <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>);
        default: return svg(size, <path d="m5 12 4 4 10-10" />);
    }
}
const CheckIcon = ({ size = 16 }) => svg(size, <path d="m5 12 4 4 10-10" />, "var(--bl-sync-green)", 2);

function SyncDetails({ sync, signedIn, deviceName, onClose, anchorRef }) {
    const ref = useClickAway(onClose, anchorRef);
    useEffect(() => {
        if (ref.current) ref.current.focus();   // a dialog takes the focus; Escape hands it back
        const onKey = (e) => {
            if (e.key !== "Escape") return;
            onClose();
            if (anchorRef.current) anchorRef.current.focus();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose, anchorRef, ref]);
    const s = syncStatus(sync, signedIn);
    const good = s.key === "saved" && !(sync && sync.error);
    return (
        <div ref={ref} className="bl-sync-details" role="dialog" aria-label="Sync details" tabIndex={-1}>
            <div className="bl-sync-details-head">
                {good ? <CheckIcon /> : <span className={`bl-sync-tone--${s.tone}`}><StatusIcon icon={s.icon} size={16} /></span>}
                <span>{syncSentence(sync, signedIn)}</span>
            </div>
            <p className="bl-sync-details-note">Only one device draws at a time. Others can watch and take over.</p>
            <div className="bl-sync-details-rule" />
            <div className="bl-sync-details-device"><span>This device</span><b>{deviceName}</b></div>
        </div>
    );
}

/** The save state as a button inside the title chip; it opens the details card. */
export function SyncStatus({ sync, signedIn, deviceName, compact }) {
    const [open, setOpen] = useState(false);
    const anchorRef = useRef(null);
    const close = useCallback(() => setOpen(false), []);
    const s = syncStatus(sync, signedIn);
    return (
        <span className="bl-sync-status-anchor">
            <button ref={anchorRef} type="button" aria-label={syncName(sync, signedIn, compact)} aria-haspopup="dialog" aria-expanded={open}
                data-sync={s.key} className={`bl-sync-status bl-sync-tone--${s.tone}${compact ? " bl-sync-status--icon" : ""}`}
                onClick={() => setOpen((o) => !o)}>
                <span className="bl-sync-status-face">
                    <StatusIcon icon={s.icon} size={compact ? 18 : 16} />
                    {!compact && <span className="bl-sync-status-label">{s.short}</span>}
                </span>
            </button>
            {open && <SyncDetails sync={sync} signedIn={signedIn} deviceName={deviceName} onClose={close} anchorRef={anchorRef} />}
        </span>
    );
}

/**
 * Where the banner stack and the tool rail go (Kobin 2026-09-23: on the phone the banner met the
 * rail): the stack `gap` under the top bar, and the rail `gap` under the stack when they share
 * columns (a phone), else left centred (a desktop's pill is clear of it). Rects in the editor's
 * coordinates; `notices` is the stack's height and its children's rects. `railTop` null: centred.
 */
export function bannerClearance({ bar, notices, rail, gap = 12 }) {
    const bottoms = (bar || []).filter(Boolean).map((r) => r.bottom);
    const noticesTop = Math.round((bottoms.length ? Math.max(...bottoms) : 0) + gap);
    const spans = (notices && notices.spans) || [];
    if (!rail || !notices || !(notices.height > 0) || !spans.length) return { noticesTop, railTop: null };
    const left = Math.min(...spans.map((r) => r.left)), right = Math.max(...spans.map((r) => r.right));
    if (!(left < rail.right && rail.left < right)) return { noticesTop, railTop: null };
    return { noticesTop, railTop: Math.round(noticesTop + notices.height + gap) };
}

/**
 * Keeps `bannerClearance` applied to the editor at `rootRef`: `--bl-notices-top`, and
 * `--bl-rail-top` with the rail's `bl-editor-left--below`, as the top bar, the banner stack or the
 * rail change size. Measured, because the bar is 40 or 44 px, a banner grows with an error line and
 * a phone's 100vh counts its hidden URL bar.
 */
export function useBannerClearance(rootRef) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        const q = (sel) => root.querySelector(sel);
        let at = null;
        const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left - at.left, right: r.right - at.left, top: r.top - at.top, bottom: r.bottom - at.top, height: r.height };
        };
        let timer = null;
        const apply = () => {
            timer = null;
            at = root.getBoundingClientRect();
            const stack = q(".bl-top-notices"), railBox = q(".bl-editor-left");
            const c = bannerClearance({
                bar: [rect(q(".bl-editor-top-left")), rect(q(".bl-editor-top-right-group"))],
                notices: stack ? { height: stack.offsetHeight, spans: [...stack.children].map(rect) } : null,
                rail: rect(railBox && railBox.firstElementChild),
            });
            root.style.setProperty("--bl-notices-top", `${c.noticesTop}px`);
            if (c.railTop != null) root.style.setProperty("--bl-rail-top", `${c.railTop}px`);
            if (railBox) railBox.classList.toggle("bl-editor-left--below", c.railTop != null);
        };
        const schedule = () => { if (!timer) timer = setTimeout(apply, 0); };
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
        if (ro) for (const sel of [".bl-editor-top-left", ".bl-editor-top-right-group", ".bl-top-notices", ".bl-editor-left"]) { const el = q(sel); if (el) ro.observe(el); }
        window.addEventListener("resize", schedule);
        apply();
        return () => { clearTimeout(timer); if (ro) ro.disconnect(); window.removeEventListener("resize", schedule); };
    }, [rootRef]);
}

// What the banner shows for a state, or null. `took`: the name of who had the pen, just after
// this tab took it with "Edit here".
function bannerOf(sync, took) {
    const mode = sync && sync.mode;
    if (mode === "readonly") {
        const sub = sync.why === "tab" ? "This canvas is open in another tab" : `${(sync.holder && sync.holder.name) || "Another device"} has the pen`;
        return { kind: "viewing", title: "Viewing only", sub, icon: "eye", error: sync.error || null };   // e.g. a failed Edit here
    }
    if (mode === "taking") return { kind: "moving", title: "Taking over…", sub: null, icon: "up" };
    if (mode === "handing") return { kind: "moving", title: "Handing over…", sub: null, icon: "up" };
    if (mode === "editing" && took) return { kind: "pen", title: "You have the pen", sub: `${took} is watching`, icon: "check" };
    return null;
}

/**
 * The banner under the top bar: "Viewing only" with Edit here while another tab or device has the
 * pen, "Taking over…" / "Handing over…" while it moves, and "You have the pen" for `penMs` after an
 * Edit here lands (dismissable). Nothing in the title row grows.
 */
export function SyncBanner({ sync, onTakeOver, compact, penMs = 4000 }) {
    const [took, setTook] = useState(null);
    const seen = useRef({ asked: false, from: null });
    const mode = sync && sync.mode;
    useEffect(() => {
        const s = seen.current;
        if (mode === "readonly") { s.asked = false; s.from = sync.why === "tab" ? "Your other tab" : (sync.holder && sync.holder.name) || "The other device"; }
        else if (mode === "taking") s.asked = true;
        else if (mode === "editing" && s.asked) { s.asked = false; setTook(s.from || "The other device"); }
        if (mode !== "editing") setTook(null);
    }, [mode, sync]);
    useEffect(() => {
        if (!took) return undefined;
        const t = setTimeout(() => setTook(null), penMs);
        return () => clearTimeout(t);
    }, [took, penMs]);
    const b = bannerOf(sync, took);
    if (!b) return null;
    return (
        <div className={`bl-sync-banner bl-sync-banner--${b.kind}${compact ? " bl-sync-banner--compact" : ""}`} role="status">
            <span className="bl-sync-banner-icon">{b.icon === "check" ? <CheckIcon size={compact ? 20 : 18} /> : <StatusIcon icon={b.icon} size={compact ? 20 : 18} />}</span>
            <span className="bl-sync-banner-text">
                <span className="bl-sync-banner-title">{b.title}</span>
                {b.sub && <span className="bl-sync-banner-sub">{b.sub}</span>}
                {b.error && <span className="bl-sync-banner-error" role="alert">{b.error}</span>}
            </span>
            {b.kind === "viewing" && (
                <button type="button" className="bl-sync-banner-action" onClick={onTakeOver}>Edit here</button>
            )}
            {b.kind === "pen" && (
                <button type="button" className="bl-sync-banner-dismiss" aria-label="Dismiss" onClick={() => setTook(null)}>
                    {svg(18, <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>)}
                </button>
            )}
        </div>
    );
}
