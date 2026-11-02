// True Stories: cinematic 3D layer.
// - Three.js: a "film archive in space" behind the page. Posters on film-strip frames float in a
//   corridor, with drifting dust and light shafts. Scrolling the page flies the camera through it.
// - GSAP + ScrollTrigger: scroll-driven reveals (3D card fly-ins, banner pull-away).
// - Lenis: smooth inertial scrolling on desktop (phones keep native scrolling).
// All three are free and open source, installed with npm (see package.json) and served from
// /vendor by this site itself. If anything fails to load, the page still works and app.js falls
// back to its 2D particle background.

const THREE_URL = "/vendor/three.module.min.js";

/** Loads a classic script (the GSAP and Lenis builds set globals: gsap, ScrollTrigger, Lenis). */
const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(s);
  });

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
const phone = matchMedia("(max-width: 720px)").matches;
// The home page intro (assets/js/intro.js) brings its own space scene; skip ours while it runs.
const introOn = () => document.documentElement.classList.contains("intro-on");

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/* =====================================================================================
   3D scene
   ===================================================================================== */
async function startScene() {
  const canvas = document.getElementById("bg");
  if (!canvas || reduceMotion || !webglAvailable()) return false;
  const THREE = await import(THREE_URL);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !phone,
    powerPreference: phone ? "default" : "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1 : 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04050b, phone ? 0.075 : 0.06);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 90);

  const POSTERS = phone ? 12 : 26;
  const SPACING = 3.4;
  const LENGTH = POSTERS * SPACING;

  /* ---------- Shared film-strip frame texture (drawn once, no network) ---------- */
  const filmTexture = (() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 340;
    const g = c.getContext("2d");
    g.fillStyle = "#07080f";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgba(200,220,255,0.55)";
    for (let y = 10; y < c.height - 10; y += 26) {
      g.beginPath();
      g.roundRect(9, y, 14, 15, 3);
      g.roundRect(c.width - 23, y, 14, 15, 3);
      g.fill();
    }
    g.strokeStyle = "rgba(0,229,255,0.6)";
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  /* ---------- Posters: reuse the images already on this page ---------- */
  const sources = [...new Set(
    [...document.querySelectorAll("img.poster")].map((img) => img.currentSrc || img.src).filter(Boolean)
  )];
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const textureCache = new Map();
  const posterTexture = (src) => {
    if (!textureCache.has(src)) {
      const t = loader.load(src);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = phone ? 1 : 4;
      textureCache.set(src, t);
    }
    return textureCache.get(src);
  };

  const posterGeo = new THREE.PlaneGeometry(1.5, 2.25);
  const frameGeo = new THREE.PlaneGeometry(1.95, 2.6);
  const frameMat = new THREE.MeshBasicMaterial({ map: filmTexture, transparent: true, opacity: 0.9 });
  const emptyMat = new THREE.MeshBasicMaterial({ color: 0x1a2350 });

  // Keep the middle of the screen clear so the page content stays readable.
  const aspect = innerWidth / innerHeight;
  const rx = aspect < 1 ? 2.3 : 5.2;
  const ry = aspect < 1 ? 3.6 : 2.9;

  const posters = [];
  for (let i = 0; i < POSTERS; i++) {
    const group = new THREE.Group();
    const src = sources.length ? sources[i % sources.length] : null;
    const mat = src
      ? new THREE.MeshBasicMaterial({ map: posterTexture(src), color: 0x8f98bd })
      : emptyMat;
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.z = -0.02;
    group.add(frame, new THREE.Mesh(posterGeo, mat));

    const angle = i * 2.39996; // golden angle: an even spiral with no obvious pattern
    const spread = 1 + Math.random() * 0.45;
    group.position.set(
      Math.cos(angle) * rx * spread,
      Math.sin(angle) * ry * spread,
      -i * SPACING - 4
    );
    // Turn each poster partly toward the corridor so it reads as a gallery, not a wall.
    group.rotation.y = -Math.cos(angle) * 0.55;
    group.rotation.x = Math.sin(angle) * 0.25;
    group.userData = { baseY: group.position.y, baseRotY: group.rotation.y, phase: Math.random() * 6.28 };
    group.scale.setScalar(phone ? 0.85 : 1);
    scene.add(group);
    posters.push(group);
  }

  /* ---------- Drifting dust in the projector light ---------- */
  const dotSprite = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const dust = (count, color, size) => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 2] = 8 - Math.random() * (LENGTH + 20);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: dotSprite,
      color,
      size,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    scene.add(points);
    return points;
  };
  const dustCyan = dust(phone ? 380 : 1100, 0x5fe9ff, 0.09);
  const dustMagenta = dust(phone ? 120 : 320, 0xff4fe0, 0.12);

  /* ---------- Light shafts (like a projector beam cutting through haze) ---------- */
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x6f7dff) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
      void main(){
        float edge = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
        float fall = pow(vUv.y, 1.6);
        float flicker = 0.85 + 0.15 * sin(uTime * 1.7 + vUv.y * 6.0);
        gl_FragColor = vec4(uColor, edge * fall * flicker * 0.16);
      }`,
  });
  const shafts = [];
  const shaftCount = phone ? 3 : 6;
  for (let i = 0; i < shaftCount; i++) {
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 26), shaftMat);
    shaft.position.set((i % 2 ? 1 : -1) * (2 + Math.random() * 4), 4, -i * (LENGTH / shaftCount) - 6);
    shaft.rotation.z = (i % 2 ? -1 : 1) * (0.35 + Math.random() * 0.2);
    shaft.userData.baseRot = shaft.rotation.z;
    scene.add(shaft);
    shafts.push(shaft);
  }

  /* ---------- Camera: flies through the corridor as the page scrolls ---------- */
  const pointer = { x: 0, y: 0 };
  if (finePointer) {
    addEventListener("pointermove", (e) => {
      pointer.x = e.clientX / innerWidth - 0.5;
      pointer.y = e.clientY / innerHeight - 0.5;
    }, { passive: true });
  }
  const scrollProgress = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(Math.max(scrollY / max, 0), 1) : 0;
  };

  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  };
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  resize();

  let camZ = 6;
  let camX = 0;
  let camY = 0;
  let lastScroll = scrollY;
  let velocity = 0;
  const clock = new THREE.Clock();
  const lookTarget = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const ease = 1 - Math.exp(-dt * 4); // frame-rate independent smoothing

    // Scroll speed adds a subtle "warp" (wider lens) and leans the posters.
    const ds = scrollY - lastScroll;
    lastScroll = scrollY;
    velocity += (Math.max(Math.min(ds / Math.max(dt, 0.001) / 3000, 1), -1) - velocity) * ease;

    const targetZ = 6 - scrollProgress() * (LENGTH - 4) + Math.sin(t * 0.25) * 0.4;
    camZ += (targetZ - camZ) * ease;
    camX += (pointer.x * 1.2 + Math.sin(t * 0.18) * 0.3 - camX) * ease;
    camY += (-pointer.y * 0.8 + Math.cos(t * 0.21) * 0.2 - camY) * ease;
    camera.position.set(camX, camY, camZ);
    lookTarget.set(camX * 0.25, camY * 0.25, camZ - 10);
    camera.lookAt(lookTarget);
    camera.fov = 55 + Math.abs(velocity) * 14;
    camera.updateProjectionMatrix();

    for (const p of posters) {
      const u = p.userData;
      p.position.y = u.baseY + Math.sin(t * 0.5 + u.phase) * 0.18;
      p.rotation.y = u.baseRotY + Math.sin(t * 0.3 + u.phase) * 0.08 + velocity * 0.35;
      p.rotation.z = Math.sin(t * 0.4 + u.phase) * 0.03;
    }
    dustCyan.rotation.z = t * 0.01;
    dustMagenta.rotation.z = -t * 0.014;
    dustCyan.position.y = Math.sin(t * 0.2) * 0.3;
    for (const s of shafts) s.rotation.z = s.userData.baseRot + Math.sin(t * 0.2 + s.position.z) * 0.04;
    shaftMat.uniforms.uTime.value = t;

    renderer.render(scene, camera);
  });

  document.documentElement.classList.add("has-3d");
  return true;
}

/* =====================================================================================
   Scroll choreography
   ===================================================================================== */
async function startMotion() {
  if (reduceMotion) return null;
  await loadScript("/vendor/gsap.min.js");
  await loadScript("/vendor/ScrollTrigger.min.js");
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);

  // Smooth inertial scroll on desktop, driven by GSAP's ticker so ScrollTrigger stays in sync.
  let lenis = null;
  if (finePointer) {
    try {
      await loadScript("/vendor/lenis.min.js");
      const { Lenis } = window;
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } catch {
      /* native scrolling is fine */
    }
  }

  const belowFold = (el) => el.getBoundingClientRect().top > innerHeight * 0.92;

  // Banner: as you scroll away, the text drifts up and the "screen" recedes into the dark.
  const banner = introOn() ? null : document.querySelector(".carousel, .billboard.detail");
  if (banner) {
    gsap.to(banner.querySelectorAll(".billboard-inner"), {
      yPercent: -18,
      opacity: 0,
      ease: "none",
      scrollTrigger: { trigger: banner, start: "top top", end: "bottom 15%", scrub: true },
    });
    gsap.to(banner, {
      scale: 0.92,
      borderRadius: 18,
      opacity: 0.35,
      ease: "none",
      scrollTrigger: { trigger: banner, start: "35% top", end: "bottom top", scrub: true },
    });
  }

  // Row titles wipe in from the left like an opening credit.
  gsap.utils.toArray(".row-head").filter(belowFold).forEach((head) => {
    gsap.from(head, {
      clipPath: "inset(0 100% 0 0)",
      x: -40,
      opacity: 0,
      duration: 1.1,
      ease: "expo.out",
      scrollTrigger: { trigger: head, start: "top 88%", once: true },
    });
  });

  // Posters in a row swing in out of depth, one after another.
  gsap.utils.toArray(".row").filter(belowFold).forEach((row) => {
    const cards = [...row.querySelectorAll(".card")].slice(0, phone ? 3 : 8);
    gsap.from(cards, {
      opacity: 0,
      x: 120,
      z: -260,
      rotationY: -38,
      transformPerspective: 900,
      transformOrigin: "left center",
      duration: 1.2,
      stagger: 0.07,
      ease: "power3.out",
      clearProps: "transform,opacity",
      scrollTrigger: { trigger: row, start: "top 85%", once: true },
    });
  });

  // Category grids: cards rise out of the dark in batches as they come into view.
  const gridCards = gsap.utils.toArray(".page > .grid > .card").filter(belowFold);
  if (gridCards.length) {
    gsap.set(gridCards, { opacity: 0, y: 70, rotationX: -28, transformPerspective: 800, transformOrigin: "center top" });
    ScrollTrigger.batch(gridCards, {
      start: "top 92%",
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1, y: 0, rotationX: 0, duration: 1, stagger: 0.06, ease: "power3.out", clearProps: "transform",
        }),
    });
  }

  // Images and fonts change the page height; keep trigger positions accurate.
  addEventListener("load", () => ScrollTrigger.refresh());
  return { gsap, ScrollTrigger, lenis };
}

/* ===================================================================================== */
/** Starts the 3D background, or app.js's 2D particles if WebGL isn't available. Runs once. */
let sceneStarted = false;
window.trueStoriesStartScene = () => {
  if (sceneStarted) return;
  sceneStarted = true;
  startScene()
    .catch((err) => {
      console.warn("3D scene unavailable:", err);
      return false;
    })
    .then((ok) => {
      if (!ok) window.trueStoriesParticles?.();
    });
};
// With the intro running, intro.js calls this only if the intro has to fall back.
if (!introOn()) window.trueStoriesStartScene();

// Shared with intro.js, so the libraries and Lenis exist only once.
window.trueStoriesMotion = startMotion().catch((err) => {
  console.warn("Scroll animations unavailable:", err);
  return null;
});
