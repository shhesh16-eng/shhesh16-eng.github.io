// Home page intro: scrolling scrubs a space fly-through (WebP frames on a canvas) and the
// catalog's titles ride on the glowing film frames. Chapters, frame ranges and screen positions
// live in intro-config.js; ?debug=1 shows the frame number and lets you edit the screens.
//
// The markup is rendered by the server (src/views.rs) and works without this script: if the
// intro is off (see INTRO_GATE in views.rs) or anything here fails, html.intro-on is removed and
// the page falls back to a static hero followed by the normal home page.

const root = document.documentElement;
const section = document.getElementById("intro");
const cfg = window.INTRO_CONFIG;
const debug = /[?&]debug=1/.test(location.search);
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

const PRELOAD = 30; // frames loaded before the intro starts
const PARALLEL = 4; // background downloads at a time after that
const LOADER_TIMEOUT = 6000; // start anyway after this long (ms)
const HEADER = 70; // px kept clear at the top for the site header (featured card)

if (section && cfg && root.classList.contains("intro-on")) {
  start().catch(fallback);
}

/** Turns the intro back into the static hero and brings back the rest of the 3D layer. */
function fallback(err) {
  console.warn("Intro disabled:", err);
  root.classList.remove("intro-on", "intro-inside");
  document.querySelector(".intro-progress")?.remove();
  window.trueStoriesStartScene?.();
  window.ScrollTrigger?.refresh();
}

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(s);
  });

async function start() {
  /* ---------- Config, frames, libraries ---------- */
  if (debug) {
    // Keep unsaved edits across reloads until they are copied into intro-config.js.
    const draft = localStorage.getItem("introConfigDraft");
    if (draft) Object.assign(cfg, JSON.parse(draft));
  }
  const manifest = await (await fetch("/assets/frames/manifest.json")).json();
  const count = manifest.count;
  const aspect = manifest.aspect;
  const set = Math.min(innerWidth, innerHeight) <= 720 ? "mobile" : "desktop";
  const frameUrl = (i) =>
    `/assets/frames/${set}/${manifest.pattern.replace("{i}", String(i).padStart(manifest.pad, "0"))}`;
  section.style.setProperty("--intro-scroll", cfg.scroll ?? 6);

  // cinema.js loads GSAP / ScrollTrigger / Lenis; load them here if it didn't (e.g. reduced motion forced on).
  const motion = (await window.trueStoriesMotion?.catch(() => null)) || {};
  if (!window.gsap) await loadScript("/vendor/gsap.min.js");
  if (!window.ScrollTrigger) await loadScript("/vendor/ScrollTrigger.min.js");
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  const lenis = motion.lenis || null;

  /* ---------- Elements ---------- */
  const stage = section.querySelector(".intro-stage");
  const canvas = section.querySelector(".intro-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const fade = Math.max(cfg.fade ?? 4, 1);

  const chapters = cfg.chapters.map((ch) => {
    const el = section.querySelector(`[data-chapter="${ch.id}"]`);
    const slotEls = el ? [...el.querySelectorAll(".intro-slot")] : [];
    const head = el?.querySelector(".intro-head");
    if (head && ch.headY != null) head.style.setProperty("--head-y", `${ch.headY}%`);
    const layers = Object.entries(ch.layers || {}).map(([name, range]) => ({
      el: el?.querySelector(`[data-layer="${name}"]`),
      range,
    }));
    return { cfg: ch, el, slotEls, layers, on: false, lit: false };
  });

  /* ---------- Frame loading: first PRELOAD up front, then nearest-first in the background ---------- */
  const images = new Array(count);
  const state = new Uint8Array(count); // 0 = not requested, 1 = loading, 2 = ready, 3 = failed
  const load = (i) =>
    new Promise((resolve) => {
      state[i] = 1;
      const img = new Image();
      img.decoding = "async";
      img.onload = () =>
        (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => {
          images[i] = img;
          state[i] = 2;
          if (Math.abs(i - want) < Math.abs(shown - want) || shown < 0) requestDraw();
          resolve(true);
        });
      img.onerror = () => {
        state[i] = 3;
        resolve(false);
      };
      img.src = frameUrl(i);
    });

  let want = 0; // frame the scroll position asks for
  let shown = -1; // frame on the canvas
  let ready = false; // set once everything below is wired up; frames may arrive before that
  let drawQueued = false;
  const nextToLoad = () => {
    for (let d = 0; d < count; d++) {
      for (const i of [want + d, want - d]) if (i >= 0 && i < count && state[i] === 0) return i;
    }
    return -1;
  };
  const backgroundLoad = async () => {
    for (let i = nextToLoad(); i >= 0; i = nextToLoad()) await load(i);
  };

  const first = await Promise.race([
    Promise.all(Array.from({ length: Math.min(PRELOAD, count) }, (_, i) => load(i))),
    new Promise((r) => setTimeout(r, LOADER_TIMEOUT)),
  ]);
  if (state[0] !== 2) throw new Error("could not load the first frame");
  if (!first) console.info("Intro: starting before all preload frames arrived");
  for (let k = 0; k < PARALLEL; k++) backgroundLoad();

  /* ---------- Canvas: cover-fit, devicePixelRatio aware, redraw only on change ---------- */
  const geo = { cw: 0, ch: 0, dx: 0, dy: 0, dw: 0, dh: 0 };
  let dirty = true;
  const resize = () => {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    if (cw === geo.cw && ch === geo.ch) return;
    // No point in a backing store sharper than the frames themselves.
    const dpr = Math.min(devicePixelRatio || 1, 2, (manifest.sets[set] * 1.25) / Math.max(cw, ch * aspect));
    canvas.width = Math.round(cw * Math.max(dpr, 1));
    canvas.height = Math.round(ch * Math.max(dpr, 1));
    ctx.setTransform(canvas.width / cw, 0, 0, canvas.height / ch, 0, 0);
    Object.assign(geo, { cw, ch });
    if (cw / ch > aspect) Object.assign(geo, { dw: cw, dh: cw / aspect });
    else Object.assign(geo, { dw: ch * aspect, dh: ch });
    geo.dx = (cw - geo.dw) / 2;
    geo.dy = (ch - geo.dh) / 2;
    dirty = true;
    sizeSlots();
    requestDraw();
  };

  const nearestReady = (i) => {
    for (let d = 0; d < count; d++) {
      if (state[i - d] === 2) return i - d;
      if (state[i + d] === 2) return i + d;
    }
    return -1;
  };
  function requestDraw() {
    if (!ready || drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      const i = nearestReady(want);
      if (i < 0 || (i === shown && !dirty)) return;
      ctx.drawImage(images[i], geo.dx, geo.dy, geo.dw, geo.dh);
      const changed = i !== shown || dirty;
      shown = i;
      dirty = false;
      if (changed) overlay(i);
    });
  }

  /* ---------- Slots: keyframed rectangles in % of the video, mapped onto the screen ---------- */
  const keyAt = (keys, f) => {
    if (!keys?.length || f < keys[0].f || f > keys.at(-1).f) return null;
    let k = 1;
    while (k < keys.length && keys[k].f < f) k++;
    const a = keys[Math.min(k, keys.length) - 1], b = keys[Math.min(k, keys.length - 1)];
    const t = b.f === a.f ? 0 : (f - a.f) / (b.f - a.f);
    const mix = (p) => (a[p] ?? 0) + ((b[p] ?? 0) - (a[p] ?? 0)) * t;
    return { x: mix("x"), y: mix("y"), w: mix("w"), h: mix("h"), r: mix("r") };
  };
  const toScreen = (r) => ({
    x: geo.dx + (r.x / 100) * geo.dw,
    y: geo.dy + (r.y / 100) * geo.dh,
    w: (r.w / 100) * geo.dw,
    h: (r.h / 100) * geo.dh,
    r: r.r,
  });
  /** Keeps a rectangle inside the visible screen (the big featured frame on narrow phones). */
  const clampToScreen = (s) => {
    const m = 14;
    const bottom = geo.cw <= 720 ? 150 : 90; // progress bar, skip button and phone tab bar
    const x0 = Math.max(s.x, m), x1 = Math.min(s.x + s.w, geo.cw - m);
    const y0 = Math.max(s.y, HEADER), y1 = Math.min(s.y + s.h, geo.ch - bottom);
    return { x: x0, y: y0, w: Math.max(x1 - x0, 0), h: Math.max(y1 - y0, 0), r: s.r };
  };
  const slotScreen = (ch, slot, f) => {
    const k = keyAt(slot.keys, f);
    if (!k) return null;
    const s = toScreen(k);
    return ch.clamp ? clampToScreen(s) : s;
  };

  // Rows are laid out once at the size their screen has at the chapter's focus frame and then only
  // transformed (cheap to animate); the featured card (clamp) is resized so its text reflows.
  function sizeSlots() {
    for (const c of chapters) {
      c.cfg.slots?.forEach((slot, i) => {
        const el = c.slotEls[i];
        if (!el || c.cfg.clamp) return;
        const keys = slot.keys || [];
        if (!keys.length) return;
        const focus = c.cfg.focus ?? keys[0].f;
        const f = Math.min(Math.max(focus, keys[0].f), keys.at(-1).f);
        const s = slotScreen(c.cfg, slot, f);
        el._base = s;
        el.style.setProperty("--w", `${s.w}px`);
        el.style.setProperty("--h", `${s.h}px`);
      });
    }
  }

  const ramp = (f, a, b, edgeA = true, edgeB = true) => {
    if (f < a || f > b) return 0;
    const inA = edgeA ? (f - a + 1) / fade : 1;
    const outB = edgeB ? (b - f + 1) / fade : 1;
    return Math.max(0, Math.min(1, inA, outB));
  };

  let activeStep = -1;
  function overlay(f) {
    for (const c of chapters) {
      const ch = c.cfg;
      if (!c.el) continue;
      const o = ramp(f, ch.start, ch.end, ch.start > 0, ch.end < count - 1);
      c.el.style.setProperty("--o", o.toFixed(3));
      if (c.on !== o > 0) c.el.classList.toggle("on", (c.on = o > 0));
      if (c.lit !== o >= 0.5) c.el.classList.toggle("lit", (c.lit = o >= 0.5));
      for (const l of c.layers) {
        l.el?.style.setProperty("--lo", ramp(f, l.range[0], l.range[1], l.range[0] > 0).toFixed(3));
      }
      if (!c.on) continue;

      c.slotEls.forEach((el, i) => {
        const slot = ch.slots?.[i];
        const s = slot && slotScreen(ch, slot, f);
        const visible = !!s && s.w > 4 && s.h > 4;
        el.classList.toggle("on", visible);
        if (!visible) return;
        const keys = slot.keys;
        el.style.setProperty("--so", ramp(f, keys[0].f, keys.at(-1).f, keys[0].f > ch.start, keys.at(-1).f < ch.end).toFixed(3));
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        if (ch.clamp) {
          el.style.setProperty("--w", `${s.w}px`);
          el.style.setProperty("--h", `${s.h}px`);
          el.style.transform = `translate3d(${cx}px, ${cy}px, 0) rotate(${s.r}deg) translate(-50%, -50%)`;
        } else {
          const b = el._base;
          el.style.transform =
            `translate3d(${cx}px, ${cy}px, 0) rotate(${s.r}deg) scale(${s.w / b.w}, ${s.h / b.h}) translate(-50%, -50%)`;
        }
      });
    }
    progress(f);
    if (debug) debugDraw(f);
  }

  /* ---------- Scroll: the section is pinned with CSS (sticky); GSAP scrubs the frame ---------- */
  const play = { f: 0 };
  const tween = gsap.to(play, {
    f: count - 1,
    ease: "none",
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: "bottom bottom",
      scrub: debug ? true : 0.3,
    },
    onUpdate: () => {
      want = Math.round(play.f);
      requestDraw();
    },
  });
  const st = tween.scrollTrigger;
  const frameY = (f) => st.start + (f / (count - 1)) * (st.end - st.start);
  const goTo = (f, immediate = false) => {
    const y = frameY(f);
    if (lenis) lenis.scrollTo(y, { duration: immediate ? 0 : 1.6, immediate });
    else scrollTo({ top: y, behavior: immediate ? "instant" : "smooth" });
  };

  /* ---------- Progress bar (4 chapters) ---------- */
  const steps = (cfg.steps || []).map((label, i) => {
    const own = cfg.chapters.filter((ch) => ch.step === i);
    return {
      label,
      start: Math.min(...own.map((ch) => ch.start)),
      end: Math.max(...own.map((ch) => ch.end)),
      focus: own[0]?.focus ?? own[0]?.start ?? 0,
      netflix: own.some((ch) => ch.id === "netflix"),
    };
  });
  const bar = document.createElement("nav");
  bar.className = "intro-progress";
  bar.setAttribute("aria-label", "Intro chapters");
  steps.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = s.netflix ? "netflix" : "";
    b.innerHTML = `<span></span>`;
    b.firstChild.textContent = s.label;
    b.setAttribute("aria-label", `Go to ${s.label}`);
    b.addEventListener("click", () => goTo(i === 0 ? 0 : s.focus));
    bar.append(b);
    s.button = b;
  });
  // Fixed-position controls live in <body>: <main>'s entrance animation leaves a transform on it,
  // which would make them fixed to <main> instead of the screen.
  document.body.append(bar);

  const tabs = [...document.querySelectorAll(".tabbar .tab")];
  function progress(f) {
    let current = 0;
    steps.forEach((s, i) => {
      const p = Math.max(0, Math.min(1, (f - s.start) / Math.max(s.end - s.start, 1)));
      s.button.style.setProperty("--p", p.toFixed(3));
      if (f >= s.start) current = i;
    });
    if (current === activeStep) return;
    activeStep = current;
    steps.forEach((s, i) => s.button.classList.toggle("current", i === current));
    // Light up the matching phone tab while the intro is on screen.
    const nav = cfg.chapters.find((ch) => ch.step === current && ch.nav)?.nav?.[0] ?? "/";
    tabs.forEach((t) => t.classList.toggle("active", t.getAttribute("href") === nav));
  }

  /* ---------- Menu links scroll to their chapter; "Skip intro" jumps to the catalog ---------- */
  const navTargets = new Map();
  for (const ch of cfg.chapters) for (const href of ch.nav || []) navTargets.set(href, href === "/" ? 0 : ch.focus);
  document.addEventListener("click", (e) => {
    if (!root.classList.contains("intro-on") || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("header.site a, .tabbar a");
    const f = a && navTargets.get(a.getAttribute("href"));
    if (f == null) return;
    e.preventDefault();
    goTo(f);
  });

  // The progress bar and "Skip intro" show while the fly-through is on screen.
  const markInside = () => root.classList.toggle("intro-inside", scrollY < st.end + innerHeight * 0.25);
  addEventListener("scroll", markInside, { passive: true });
  ScrollTrigger.addEventListener("refresh", markInside);

  const catalog = document.getElementById("catalog");
  const skip = section.querySelector(".intro-skip");
  if (skip) document.body.append(skip);
  skip?.addEventListener("click", (e) => {
    e.preventDefault();
    const y = catalog ? catalog.getBoundingClientRect().top + scrollY - 60 : st.end + innerHeight;
    if (lenis) lenis.scrollTo(y, { immediate: true });
    else scrollTo({ top: y, behavior: "instant" });
    if (catalog) {
      catalog.tabIndex = -1;
      catalog.focus({ preventScroll: true });
    }
  });

  /* ---------- Posters lean toward the cursor ---------- */
  if (finePointer) {
    let tilted = null;
    stage.addEventListener("pointermove", (e) => {
      const card = e.target.closest(".intro-card");
      if (tilted && tilted !== card) tilted.style.removeProperty("--rx"), tilted.style.removeProperty("--ry");
      tilted = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty("--rx", `${(-y * 14).toFixed(2)}deg`);
      card.style.setProperty("--ry", `${(x * 14).toFixed(2)}deg`);
    });
    stage.addEventListener("pointerleave", () => {
      tilted?.style.removeProperty("--rx");
      tilted?.style.removeProperty("--ry");
      tilted = null;
    });
  }

  /* ---------- Go ---------- */
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });
  ready = true;
  resize();
  ScrollTrigger.refresh();
  want = Math.round(play.f);
  requestDraw();
  root.classList.add("intro-ready");

  /* =====================================================================================
     ?debug=1: frame number, slot outlines, drag / resize slots, copy the config
     ===================================================================================== */
  let debugDraw = () => {};
  if (debug) debugDraw = setupDebug();

  function setupDebug() {
    const hud = document.createElement("div");
    hud.className = "intro-debug-hud";
    hud.innerHTML = `
      <div>frame <b data-f>0</b> / ${count - 1} &nbsp; <span data-ch></span></div>
      <div>
        <button data-act="prev">◀ frame</button><button data-act="next">frame ▶</button>
        <button data-act="hide">hide posters</button>
      </div>
      <div>
        chapter: <button data-act="start">start = here</button><button data-act="end">end = here</button>
        <button data-act="focus">focus = here</button>
      </div>
      <div>
        slot: <button data-act="add">+ add</button><button data-act="del">delete key</button>
        <button data-act="drop">remove slot</button>
      </div>
      <div><button data-act="copy">Copy config</button><button data-act="reset">Discard edits</button></div>
      <p>Drag a box to move it, its corner to resize; [ and ] rotate. Each edit sets a keyframe
      at this frame (solid outline). The Left/Right arrow keys step one frame. Paste the copied config into
      assets/js/intro-config.js.</p>
      <p data-msg></p>`;
    document.body.append(hud);
    const $ = (sel) => hud.querySelector(sel);
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;z-index:50;pointer-events:none";
    stage.append(layer);

    let selected = null; // { c, i }
    let frame = 0;
    const save = () => localStorage.setItem("introConfigDraft", JSON.stringify(cfg));
    const say = (msg) => ($("[data-msg]").textContent = msg);
    const activeChapters = () => chapters.filter((c) => frame >= c.cfg.start && frame <= c.cfg.end);
    const redraw = () => {
      dirty = true;
      sizeSlots();
      overlay(shown);
    };

    /** The keyframe for this slot at the current frame, created from the interpolated position if needed. */
    const keyHere = (slot) => {
      let k = slot.keys.find((q) => q.f === frame);
      if (!k) {
        const at = keyAt(slot.keys, frame) || slot.keys.reduce((a, b) => (Math.abs(b.f - frame) < Math.abs(a.f - frame) ? b : a));
        k = { f: frame, x: at.x, y: at.y, w: at.w, h: at.h, r: at.r ?? 0 };
        slot.keys.push(k);
        slot.keys.sort((a, b) => a.f - b.f);
      }
      slot.track = false; // hand-edited: the tracker leaves it alone from now on
      return k;
    };
    const round = (v) => Math.round(v * 10) / 10;

    layer.addEventListener("pointerdown", (e) => {
      const box = e.target.closest(".intro-debug-box");
      if (!box) return;
      e.preventDefault();
      const c = chapters[box.dataset.c], i = +box.dataset.i;
      selected = { c, i };
      const slot = c.cfg.slots[i];
      const k = keyHere(slot);
      const start = { x: e.clientX, y: e.clientY, k: { ...k } };
      const resizing = e.target.tagName === "I";
      const move = (ev) => {
        const dx = ((ev.clientX - start.x) / geo.dw) * 100;
        const dy = ((ev.clientY - start.y) / geo.dh) * 100;
        if (resizing) {
          k.w = round(Math.max(1, start.k.w + dx));
          k.h = round(Math.max(1, start.k.h + dy));
        } else {
          k.x = round(start.k.x + dx);
          k.y = round(start.k.y + dy);
        }
        redraw();
      };
      const up = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        save();
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      redraw();
    });

    const step = (d) => goTo(Math.max(0, Math.min(count - 1, frame + d)), true);
    addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        step(e.key === "ArrowRight" ? 1 : -1);
      } else if ((e.key === "[" || e.key === "]") && selected) {
        const k = keyHere(selected.c.cfg.slots[selected.i]);
        k.r = round((k.r ?? 0) + (e.key === "]" ? 0.5 : -0.5));
        save();
        redraw();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        act("del");
      }
    });

    const act = async (what) => {
      const ch = activeChapters()[0];
      const slot = selected && selected.c.cfg.slots[selected.i];
      switch (what) {
        case "prev": return step(-1);
        case "next": return step(1);
        case "hide": stage.classList.toggle("intro-debug-hide"); return say("");
        case "start": case "end": case "focus":
          if (!ch) return say("No chapter at this frame.");
          ch.cfg[what] = frame;
          say(`${ch.cfg.id}.${what} = ${frame}`);
          break;
        case "add": {
          if (!ch) return say("No chapter at this frame.");
          ch.cfg.slots = ch.cfg.slots || [];
          ch.cfg.slots.push({ keys: [{ f: frame, x: 40, y: 40, w: 20, h: 20, r: 0 }] });
          selected = { c: ch, i: ch.cfg.slots.length - 1 };
          say(`Added slot ${selected.i} to ${ch.cfg.id}${ch.slotEls[selected.i] ? "" : " (the page has no title for it)"}.`);
          break;
        }
        case "del": {
          if (!slot) return say("Select a slot first.");
          if (slot.keys.length < 2) return say("A slot needs at least one key; use “remove slot”.");
          slot.keys = slot.keys.filter((k) => k.f !== frame);
          say(`Removed the key at frame ${frame}.`);
          break;
        }
        case "drop": {
          if (!slot) return say("Select a slot first.");
          selected.c.cfg.slots.splice(selected.i, 1);
          selected = null;
          say("Slot removed (the titles after it move up one slot).");
          break;
        }
        case "copy": {
          const text = `window.INTRO_CONFIG = ${stringify(cfg)};\n`;
          try {
            await navigator.clipboard.writeText(text);
            say("Copied. Paste it over window.INTRO_CONFIG in assets/js/intro-config.js.");
          } catch {
            const ta = Object.assign(document.createElement("textarea"), { value: text });
            ta.style.cssText = "position:fixed;inset:10%;z-index:200;font:11px monospace";
            document.body.append(ta);
            ta.select();
            say("Clipboard blocked: the config is in the box, copy it from there (click outside to close).");
            setTimeout(() => addEventListener("pointerdown", (ev) => ev.target !== ta && ta.remove(), { once: true }));
          }
          return;
        }
        case "reset":
          localStorage.removeItem("introConfigDraft");
          return location.reload();
      }
      save();
      redraw();
    };
    hud.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (b) act(b.dataset.act);
    });

    const style = document.createElement("style");
    style.textContent = ".intro-debug-hide .intro-slot, .intro-debug-hide .intro-head { opacity: 0.15 !important; }";
    document.head.append(style);

    return (f) => {
      frame = f;
      $("[data-f]").textContent = f;
      const here = activeChapters();
      $("[data-ch]").textContent = here.map((c) => `${c.cfg.id} ${c.cfg.start}–${c.cfg.end}`).join(", ");
      layer.textContent = "";
      for (const c of here) {
        c.cfg.slots?.forEach((slot, i) => {
          const s = slotScreen(c.cfg, slot, f);
          if (!s) return;
          const box = document.createElement("div");
          box.className = "intro-debug-box";
          box.classList.toggle("key", slot.keys.some((k) => k.f === f));
          box.classList.toggle("sel", selected?.c === c && selected?.i === i);
          box.dataset.c = chapters.indexOf(c);
          box.dataset.i = i;
          box.style.width = `${s.w}px`;
          box.style.height = `${s.h}px`;
          box.style.transform = `translate(${s.x + s.w / 2}px, ${s.y + s.h / 2}px) rotate(${s.r}deg) translate(-50%, -50%)`;
          box.innerHTML = `<span>${c.cfg.id} ${i}</span><i></i>`;
          layer.append(box);
        });
      }
    };
  }
}

/** JSON with each keyframe on one line (same format as scripts/track-slots.mjs writes). */
function stringify(obj) {
  return JSON.stringify(obj, null, 2).replace(/\{\s+"f": [^}]+\}/g, (m) => m.replace(/\s+/g, " "));
}
