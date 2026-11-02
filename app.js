// True Stories: futuristic UI effects. Everything degrades gracefully without JS.
(() => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---------- Header: solidify once the page scrolls ---------- */
  const header = document.querySelector("header.site");
  const onScroll = () => header.classList.toggle("scrolled", scrollY > 30);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Text scramble ("decoding") effect for banner titles ---------- */
  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/\\[]{}";
  function scramble(el) {
    // Only plain-text headings: rewriting textContent would wipe out child elements (logos).
    if (!el || el.children.length) return;
    const text = el.dataset.text || (el.dataset.text = el.textContent);
    cancelAnimationFrame(el._raf);
    if (reduceMotion) return void (el.textContent = text);
    const total = 32;
    let frame = 0;
    const tick = () => {
      const revealed = (frame / total) * text.length;
      el.textContent = [...text]
        .map((ch, i) => (ch === " " || i < revealed ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
        .join("");
      if (frame++ < total) el._raf = requestAnimationFrame(tick);
      else el.textContent = text;
    };
    tick();
  }

  /* ---------- Banner carousel with progress dots ---------- */
  const carousel = document.querySelector(".carousel");
  if (carousel) {
    const slides = [...carousel.querySelectorAll(".slide")];
    const dots = [...carousel.querySelectorAll(".dot")];
    const DURATION = 8000;
    let index = 0;
    let elapsed = 0;
    let last = performance.now();
    let paused = false;

    const show = (i) => {
      index = (i + slides.length) % slides.length;
      elapsed = 0;
      slides.forEach((s, k) => s.classList.toggle("active", k === index));
      dots.forEach((d, k) => {
        d.classList.toggle("active", k === index);
        d.style.setProperty("--p", "0");
      });
      scramble(slides[index].querySelector("h1"));
    };

    dots.forEach((d, k) => d.addEventListener("click", () => show(k)));

    // Swipe left/right on touch screens; vertical scrolling is left alone.
    let startX = 0, startY = 0, swiping = false;
    carousel.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      swiping = true;
      paused = true;
    }, { passive: true });
    carousel.addEventListener("touchend", (e) => {
      paused = false;
      if (!swiping) return;
      swiping = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
    }, { passive: true });
    carousel.addEventListener("mouseenter", () => (paused = true));
    carousel.addEventListener("mouseleave", () => (paused = false));
    addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight") show(index + 1);
      if (e.key === "ArrowLeft") show(index - 1);
    });

    if (slides.length > 1) {
      const loop = (now) => {
        const dt = now - last;
        last = now;
        if (!paused && !document.hidden) elapsed += dt;
        dots[index]?.style.setProperty("--p", Math.min(elapsed / DURATION, 1).toFixed(4));
        if (elapsed >= DURATION) show(index + 1);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    show(0);
  } else {
    scramble(document.querySelector(".billboard h1, .hero h1"));
  }

  /* ---------- Bottom tab bar: highlight the current section ---------- */
  {
    // Paths look like /movies, /category/crime/movie/page/2 or /title/tv/101 (static hosts add a trailing /).
    const seg = location.pathname.split("/").filter(Boolean);
    const current =
      seg[0] === "category" && seg[1] === "netflix" ? "/category/netflix"
      : seg[0] === "search" ? "/search/"
      : seg[0] === "movies" || (seg[0] === "category" && seg[2] === "movie") || (seg[0] === "title" && seg[1] === "movie") ? "/movies"
      : seg[0] === "tv" || (seg[0] === "category" && seg[2] === "tv") || (seg[0] === "title" && seg[1] === "tv") ? "/tv"
      : seg.length === 0 ? "/" : null;
    document.querySelectorAll(".tabbar .tab").forEach((tab) =>
      tab.classList.toggle("active", tab.getAttribute("href") === current)
    );
  }

  /* ---------- Static search (exported site): filter the pre-rendered titles ---------- */
  const staticSearch = document.querySelector(".static-search");
  if (staticSearch) {
    const raw = (new URLSearchParams(location.search).get("q") || "").trim();
    const q = raw.toLowerCase();
    staticSearch.querySelector('input[name="q"]').value = raw;
    let found = 0;
    staticSearch.querySelectorAll(".search-item").forEach((item) => {
      const hit = q !== "" && item.dataset.search.includes(q);
      item.hidden = !hit;
      if (hit) item.querySelector(".card").style.setProperty("--i", found++);
    });
    staticSearch.querySelector(".search-status").textContent = q ? `${found} results for “${raw}”` : "";
    staticSearch.querySelector(".search-hint").hidden = q !== "";
    staticSearch.querySelector(".search-none").hidden = !(q && found === 0);
    if (!q) staticSearch.querySelector('input[name="q"]').focus();
  }

  /* ---------- Reveal-on-scroll with stagger ---------- */
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" }
    );
    // Cards and row titles get cinematic 3D reveals from cinema.js (GSAP) instead.
    document.querySelectorAll(".hero, .tabs, .categories").forEach((el) => {
      el.classList.add("reveal");
      io.observe(el);
    });
  }

  /* ---------- Row arrows ---------- */
  document.querySelectorAll(".rail").forEach((rail) => {
    const scroller = rail.querySelector(".scroller");
    for (const dir of [-1, 1]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `arrow ${dir < 0 ? "left" : "right"}`;
      btn.setAttribute("aria-label", dir < 0 ? "Scroll left" : "Scroll right");
      btn.textContent = dir < 0 ? "‹" : "›";
      btn.addEventListener("click", () =>
        scroller.scrollBy({ left: dir * scroller.clientWidth * 0.85, behavior: "smooth" })
      );
      rail.append(btn);
    }
    const update = () => {
      rail.classList.toggle("at-start", scroller.scrollLeft < 8);
      rail.classList.toggle("at-end", scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - 8);
    };
    scroller.addEventListener("scroll", update, { passive: true });
    update();
  });

  /* ---------- 3D tilt + glare on posters ---------- */
  if (finePointer && !reduceMotion) {
    document.querySelectorAll(".frame, .billboard-poster").forEach((el) => {
      const strength = el.classList.contains("frame") ? 16 : 10;
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--rx", `${(0.5 - y) * strength}deg`);
        el.style.setProperty("--ry", `${(x - 0.5) * strength}deg`);
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      });
    });
  }

  /* ---------- Poster morph into the title page (View Transitions API) ---------- */
  const clearTransitionNames = () =>
    document.querySelectorAll(".card .poster").forEach((p) => (p.style.viewTransitionName = ""));
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    clearTransitionNames();
    const poster = card.querySelector(".poster");
    if (poster) poster.style.viewTransitionName = "hero-poster";
  });
  addEventListener("pageshow", clearTransitionNames);

  /* ---------- Cursor glow ---------- */
  const glow = document.querySelector(".cursor-glow");
  if (glow && finePointer && !reduceMotion) {
    let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty;
    let running = false;
    const follow = () => {
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      // Only keep animating while the glow is still catching up with the cursor.
      running = Math.abs(tx - x) + Math.abs(ty - y) > 0.5;
      if (running) requestAnimationFrame(follow);
    };
    addEventListener("pointermove", (e) => {
      tx = e.clientX;
      ty = e.clientY;
      glow.classList.add("on");
      if (!running) {
        running = true;
        requestAnimationFrame(follow);
      }
    }, { passive: true });
    document.addEventListener("pointerleave", () => glow.classList.remove("on"));
  }

  /* ---------- Particle network background ----------
     Fallback only: cinema.js draws a WebGL scene on #bg, and calls this if WebGL is unavailable. */
  window.trueStoriesParticles = () => {
  const canvas = document.getElementById("bg");
  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    const LINK = 130;
    const LINK_SQ = LINK * LINK;
    const MOUSE_LINK = 180;
    let w, h, points;
    const mouse = { x: -9999, y: -9999 };

    // Glow dots are pre-rendered once; drawImage is far cheaper than shadowBlur per dot.
    const sprite = (color) => {
      const s = document.createElement("canvas");
      s.width = s.height = 24;
      const g = s.getContext("2d");
      const grad = g.createRadialGradient(12, 12, 0, 12, 12, 12);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.18, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 24, 24);
      return s;
    };
    const sprites = [sprite("rgba(0,229,255,0.55)"), sprite("rgba(255,43,214,0.55)")];

    // A soft background doesn't need retina resolution; 1x keeps the per-frame cost low.
    const resize = () => {
      w = canvas.width = innerWidth;
      h = canvas.height = innerHeight;
      const count = Math.min(70, Math.floor((w * h) / 22000));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 18,
        vy: (Math.random() - 0.5) * 18,
        size: Math.random() * 10 + 8,
        sprite: sprites[Math.random() < 0.8 ? 0 : 1],
      }));
    };
    let resizeTimer;
    addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    });
    addEventListener("pointermove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }, { passive: true });
    resize();

    let last = performance.now();
    const draw = (now) => {
      // Frame-rate independent motion (px per second), capped so a stalled tab doesn't jump.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, w, h);

      for (const p of points) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }

      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "rgb(0,229,255)";
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_SQ) {
            ctx.globalAlpha = (1 - Math.sqrt(d2) / LINK) * 0.22;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      ctx.strokeStyle = "rgb(255,43,214)";
      for (const p of points) {
        const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (d < MOUSE_LINK) {
          ctx.globalAlpha = (1 - d / MOUSE_LINK) * 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
      for (const p of points) {
        ctx.drawImage(p.sprite, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }
  };
})();
