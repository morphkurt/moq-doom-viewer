// moq-doom viewer / test player.
//
// Video: the <moq-watch> element subscribes to the game broadcast and renders
// it into its <canvas>.
// Control: we open our own MoQ connection, publish a viewer broadcast, and serve
// a "command" track carrying the set of currently-held keys. The backend diffs
// successive snapshots into key-down / key-up events for Doom.
//
// Input comes from both the physical keyboard and the on-screen buttons; both
// funnel through setHeld(), which keeps the published state and the button
// highlights in sync.

import "@moq/watch/element";
import * as Json from "@moq/json";
import * as Moq from "@moq/net";

const RELAY = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? "https://cdn.moq.dev/anon";
const PREFIX = "anon/doom";
const NAME = new URLSearchParams(location.search).get("name") ?? "e1m1";

// --- Status badge ---
type State = "connecting" | "live" | "error";
const statusEl = document.getElementById("status")!;
function setStatus(state: State, text: string) {
	statusEl.className = `badge ${state}`;
	statusEl.textContent = text;
}

const overlay = document.getElementById("overlay")!;
document.getElementById("session")!.textContent = `stream: ${PREFIX}/game/${NAME}`;

// --- Video element ---
const player = document.getElementById("player") as HTMLElement & { muted: boolean; volume: number };
player.setAttribute("url", RELAY);
player.setAttribute("name", `${PREFIX}/game/${NAME}`);

// --- Audio ---
// Start muted so the browser's autoplay policy doesn't block playback before a
// user gesture. The Sound button both unmutes and, being a click, unlocks the
// AudioContext so the Opus track from the backend becomes audible.
player.muted = true;
player.volume = 0.6;
const soundBtn = document.getElementById("sound")!;
soundBtn.addEventListener("click", () => {
	player.muted = !player.muted;
	if (!player.muted && player.volume === 0) player.volume = 0.6;
	soundBtn.textContent = player.muted ? "🔇 Sound off" : "🔊 Sound on";
});

// --- Quality selector (ABR rendition pick) ---
// The broadcast carries two video renditions (full ~4.3 Mbps, low 640x360
// ~0.5 Mbps). We steer <moq-watch>'s picker with a bitrate cap on its
// `controls.target` signal, which composes with the width/height the element
// derives from its own size:
//   Auto  - no cap, so the picker adapts to measured bandwidth.
//   High  - huge cap, so it ignores bandwidth and takes the best that fits.
//   Low   - cap below the full rendition, pinning the 640x360 rung to save data.
const QUALITY_BITRATE: Record<string, number | undefined> = {
	auto: undefined,
	high: Number.MAX_SAFE_INTEGER,
	low: 800_000,
};
const target = (player as unknown as {
	controls: { target: { update(fn: (prev: Record<string, unknown>) => Record<string, unknown>): void } };
}).controls.target;
const qbtns = [...document.querySelectorAll<HTMLElement>("#quality .qbtn")];
for (const b of qbtns) {
	b.addEventListener("click", () => {
		const q = b.dataset.q!;
		target.update((prev) => ({ ...prev, bitrate: QUALITY_BITRATE[q] }));
		for (const other of qbtns) other.classList.toggle("active", other === b);
	});
}

// --- Control state ---
// Keys we forward, by KeyboardEvent.code. Must stay in sync with the backend
// keymap (moq-doom/src/keymap.rs) — this is the full keyboard so gameplay,
// menus, automap, console, chat and cheat codes all work.
const FORWARDED = new Set([
	// Arrows.
	"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
	// Full alphabet (movement w/a/s/d/e/q, automap, console, chat, cheats).
	"KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI",
	"KeyJ", "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR",
	"KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
	// Digits (weapon select + cheat entry).
	"Digit0", "Digit1", "Digit2", "Digit3", "Digit4",
	"Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
	// Punctuation.
	"Comma", "Period", "Minus", "Equal", "BracketLeft", "BracketRight",
	"Backslash", "Semicolon", "Quote", "Backquote", "Slash",
	// Action modifiers.
	"ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
	"AltLeft", "AltRight", "CapsLock", "Space",
	// Menu / prompts / automap navigation.
	"Enter", "NumpadEnter", "Escape", "Tab", "Backspace", "Pause",
	"Insert", "Delete", "Home", "End", "PageUp", "PageDown",
	// Function keys.
	"F1", "F2", "F3", "F4", "F5", "F6",
	"F7", "F8", "F9", "F10", "F11", "F12",
]);

const held = new Set<string>();
type Command = { keys: string[]; t: number };
let producer: Json.Snapshot.Producer<Command> | undefined;

/** Publish the current held-key set, stamped with our clock for RTT latency. */
const publishCmd = () => producer?.update({ keys: [...held], t: performance.now() });

/** Single entry point for all input; publishes only on an actual change. */
function setHeld(code: string, pressed: boolean) {
	if (!FORWARDED.has(code)) return;
	const changed = pressed ? !held.has(code) && (held.add(code), true) : held.delete(code);
	if (!changed) return;
	publishCmd();
}

/** Release everything (e.g. on blur / connection loss) so keys don't stick. */
function releaseAll() {
	held.clear();
	publishCmd();
}

// --- Keyboard ---
// Capture-phase, on window, so the <moq-watch> element (which handles some keys
// for its own controls) can't swallow them before we see them.
window.addEventListener(
	"keydown",
	(e) => {
		if (!FORWARDED.has(e.code)) return;
		e.preventDefault();
		e.stopPropagation();
		if (!e.repeat) setHeld(e.code, true);
	},
	{ capture: true },
);
window.addEventListener(
	"keyup",
	(e) => {
		if (!FORWARDED.has(e.code)) return;
		e.preventDefault();
		e.stopPropagation();
		setHeld(e.code, false);
	},
	{ capture: true },
);
// Don't leave keys stuck if focus/visibility is lost mid-press.
addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => document.hidden && releaseAll());

// Keyboard events only reach a focused document. Grab focus on load and on any
// click so keys register without the user hunting for the right element.
document.body.tabIndex = -1;
const grabFocus = () => window.focus();
grabFocus();
addEventListener("click", grabFocus);
addEventListener("pointerdown", grabFocus);

// --- Fullscreen (with iOS fallback + landscape lock) ---
// iPhone Safari has no Fullscreen API for non-<video> elements, so fall back to
// a CSS "immersive" mode that fills the viewport (100dvh) instead.
const stage = document.getElementById("stage")!;
const immersive = () => stage.classList.contains("immersive");
const inFullscreen = () => !!document.fullscreenElement || immersive();

async function enterFullscreen() {
	if (stage.requestFullscreen) {
		try {
			await stage.requestFullscreen();
			// Best-effort: many phones only allow the lock while fullscreen.
			await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => {});
			return;
		} catch {
			/* not supported (iOS) — use the CSS fallback below */
		}
	}
	stage.classList.add("immersive");
	document.body.classList.add("immersive-lock");
	window.scrollTo(0, 0);
}

function exitFullscreen() {
	if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
	stage.classList.remove("immersive");
	document.body.classList.remove("immersive-lock");
}

document.getElementById("fs")!.addEventListener("click", () => (inFullscreen() ? exitFullscreen() : enterFullscreen()));
document.getElementById("exit")!.addEventListener("click", (e) => {
	e.preventDefault();
	exitFullscreen();
});

// --- Touch controls (mobile overlay) ---
// Each button holds a single key while pressed. `pointerleave`/`cancel` release
// so a key never sticks if the thumb slides off.
for (const b of document.querySelectorAll<HTMLElement>("#touch .tbtn[data-code]")) {
	const code = b.dataset.code!;
	const press = (e: Event) => {
		e.preventDefault();
		b.classList.add("held");
		setHeld(code, true);
	};
	const release = (e: Event) => {
		e.preventDefault();
		b.classList.remove("held");
		setHeld(code, false);
	};
	b.addEventListener("pointerdown", (e) => {
		(e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
		press(e);
	});
	b.addEventListener("pointerup", release);
	b.addEventListener("pointercancel", release);
	b.addEventListener("pointerleave", release);
	b.addEventListener("contextmenu", (e) => e.preventDefault());
}

// --- Telemetry rendering ---
interface StatusMsg {
	fps: number;
	drops: number;
	drop_pct: number;
	encode_ms: number;
	viewers: number;
	echo: Record<string, number>;
}
const statsEl = document.getElementById("stats")!;
function renderStats(s: StatusMsg, viewerId: string) {
	statsEl.hidden = false;
	document.getElementById("s-fps")!.textContent = s.fps.toFixed(0);
	document.getElementById("s-drop")!.textContent = String(s.drop_pct);
	document.getElementById("s-enc")!.textContent = String(s.encode_ms);
	document.getElementById("s-viewers")!.textContent = String(s.viewers);

	// Control round-trip latency: time since the backend last echoed our command.
	const sent = s.echo?.[viewerId];
	const latEl = document.getElementById("s-lat")!;
	if (sent && sent > 0) {
		latEl.textContent = String(Math.max(0, Math.round(performance.now() - sent)));
	} else {
		latEl.textContent = "–";
	}

	// Colour the drop/latency chips as they degrade.
	const drop = document.getElementById("stat-drop")!;
	drop.className = `stat ${s.drop_pct >= 40 ? "bad" : s.drop_pct >= 15 ? "warn" : ""}`;
}

type Established = Moq.Connection.Established;

/** Subscribe to the game's `status` track and render telemetry until it ends. */
async function watchStatus(conn: Established, viewerId: string, signal: AbortSignal) {
	const game = conn.consume(Moq.Path.from(`${PREFIX}/game/${NAME}`));
	const track = game.subscribe("status", { priority: 10 });
	signal.addEventListener("abort", () => track.close());
	const consumer = new Json.Snapshot.Consumer<StatusMsg>(track);
	try {
		for (;;) {
			const s = await consumer.next();
			if (!s) break;
			renderStats(s, viewerId);
		}
	} finally {
		track.close();
	}
}

/** Publish the held-key `command` track and watch telemetry on `conn`. */
async function controlSession(conn: Established, signal: AbortSignal) {
	const viewerId = Math.random().toString(36).slice(2, 8);
	const broadcast = new Moq.Broadcast.Producer();
	conn.publish(Moq.Path.from(`${PREFIX}/viewer/${NAME}/${viewerId}`), broadcast);
	setStatus("live", `live · controlling as ${viewerId}`);
	overlay.classList.add("hidden");

	watchStatus(conn, viewerId, signal).catch((err) => {
		if (!signal.aborted) console.warn("status error:", err);
	});

	// Heartbeat: republish state so RTT latency and viewer presence stay fresh
	// even when no keys change.
	const heartbeat = setInterval(publishCmd, 500);
	signal.addEventListener("abort", () => clearInterval(heartbeat));

	try {
		for (;;) {
			const req = await broadcast.requested();
			if (!req) break; // connection closed
			if (req.name === "command") {
				const track = req.accept();
				producer = new Json.Snapshot.Producer<Command>({ track });
				publishCmd(); // send current state immediately
			}
		}
	} finally {
		clearInterval(heartbeat);
		producer = undefined;
	}
}

// --- Control channel: reuse the <moq-watch> element's connection ---
// The element already dials a reconnecting MoQ session for the video/audio sub.
// Rather than open a second dial, we publish held keys and subscribe to `status`
// over that SAME session. `player.connection` is its reconnecting handle and
// `.established` is a signal of the live session (undefined while reconnecting);
// `.watch` fires now and on every change, so each new session gets a fresh
// publish and the old one is torn down.
const reload = (player as unknown as {
	connection: { established: { watch(fn: (v: Established | undefined) => void): () => void } };
}).connection;

let sessionAbort: AbortController | undefined;
reload.established.watch((conn) => {
	sessionAbort?.abort();
	sessionAbort = undefined;
	producer = undefined;

	if (!conn) {
		setStatus("connecting", "connecting…");
		overlay.classList.remove("hidden");
		return;
	}
	const abort = new AbortController();
	sessionAbort = abort;
	controlSession(conn, abort.signal).catch((err) => {
		if (!abort.signal.aborted) console.warn("control session error:", err);
	});
});
