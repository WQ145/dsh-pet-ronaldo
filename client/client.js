window.__ModuleLoader__.load({ id: "dsh-ronaldo-pet", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  let react = require("react");

  const name = "dsh-ronaldo-pet";
  const inject = ["slots"];

  const CW = 192;
  const CH = 208;
  const SCALE = 0.75;
  const W = CW * SCALE;
  const H = CH * SCALE;

  // 8 列 × 11 行精灵图契约：每行一种状态（第 9-10 行为 16 方向视线）
  const STATES = {
    idle: { row: 0, frames: 6, fps: 6 },
    runRight: { row: 1, frames: 8, fps: 12 },
    runLeft: { row: 2, frames: 8, fps: 12 },
    waving: { row: 3, frames: 4, fps: 8 },
    jumping: { row: 4, frames: 5, fps: 10 },
    failed: { row: 5, frames: 8, fps: 12 },
    waiting: { row: 6, frames: 6, fps: 5 },
    running: { row: 7, frames: 6, fps: 12 },
    review: { row: 8, frames: 6, fps: 6 },
    look: { rows: [9, 10] },
  };
  const HOST_ANIM = {
    idle: "idle",
    working: "running",
    review: "review",
    waiting: "waiting",
    failed: "failed",
    celebrating: "jumping",
  };
  const PHRASES = ["SIUUUUU! 🎉", "进球啦！⚽", "完美的终结！", "Vamos!", "这就是 7 号！"];
  const DIVE_PHRASES = ["Penalty kick! ⚽", "给我点球！Penalty!", "点球！裁判！"];

  function apply(ctx) {
    const styleEl = document.createElement("style");
    styleEl.textContent = [
      ".ronaldo-bubble{position:absolute;left:50%;bottom:100%;margin-bottom:10px;transform:translateX(-50%);",
      "background:rgba(255,255,255,0.96);color:#333;border:1px solid rgba(0,0,0,0.08);border-radius:12px;",
      "padding:6px 12px;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;",
      "white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.14);pointer-events:none;z-index:2;}",
      ".ronaldo-bubble::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);",
      "border:7px solid transparent;border-top-color:rgba(255,255,255,0.96);}",
    ].join("");
    document.head.appendChild(styleEl);
    ctx.effect(() => () => { styleEl.remove(); });

    function RonaldoPet() {
      const [st, setSt] = react.useState({ mode: "idle", seq: -1 });
      const [frame, setFrame] = react.useState(0);
      const [pos, setPos] = react.useState(null);
      const [dragging, setDragging] = react.useState(false);
      const [dragDir, setDragDir] = react.useState("runRight");
      const [hover, setHover] = react.useState(false);
      const [lookDir, setLookDir] = react.useState(0);
      const [bubble, setBubble] = react.useState("SIUUUUU! 🎉");
      const [diving, setDiving] = react.useState(false);

      let dragData = null;
      let bubbleTimer = null;
      let diveTimer = null;
      let clickTimes = [];
      let viewportEl = null;

      const viewportSize = () => {
        if (viewportEl) {
          const r = viewportEl.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
        }
        return { w: 1400, h: 900 };
      };

      react.useEffect(() => {
        let alive = true;
        const sync = async () => {
          try {
            const res = await fetch("/ronaldo-pet/state");
            if (!alive || !res.ok) return;
            const s = await res.json();
            setSt((prev) => {
              const seq = typeof s.seq === "number" ? s.seq : 0;
              if (prev.seq === seq) return prev;
              return { mode: String(s.mode || "idle"), seq };
            });
          } catch (err) { /* transient */ }
        };
        sync();
        const timer = window.setInterval(sync, 400);
        return () => { alive = false; window.clearInterval(timer); };
      }, []);

      const showBubble = (text) => {
        setBubble(text);
        if (bubbleTimer) window.clearTimeout(bubbleTimer);
        bubbleTimer = window.setTimeout(() => { bubbleTimer = null; }, 2600);
      };

      const doDive = () => {
        setDiving(true);
        showBubble(DIVE_PHRASES[Math.floor(Math.random() * DIVE_PHRASES.length)]);
        if (diveTimer) window.clearTimeout(diveTimer);
        diveTimer = window.setTimeout(() => { diveTimer = null; setDiving(false); }, 2500);
      };

      react.useEffect(() => () => {
        if (bubbleTimer) window.clearTimeout(bubbleTimer);
        if (diveTimer) window.clearTimeout(diveTimer);
      }, []);

      let anim;
      if (dragging) anim = dragDir;
      else if (diving) anim = "failed";
      else if (hover) anim = "look";
      else anim = HOST_ANIM[st.mode] || "idle";

      react.useEffect(() => {
        if (anim === "look") { setFrame(0); return; }
        const spec = STATES[anim] || STATES.idle;
        if (!spec.frames) { setFrame(0); return; }
        setFrame(0);
        let disposed = false;
        let stopTimer = null;
        const step = (i) => {
          if (disposed) return;
          setFrame(i);
          const delay = Math.round(1000 / (spec.fps || 8));
          stopTimer = window.setTimeout(() => step((i + 1) % spec.frames), delay);
        };
        step(0);
        return () => { disposed = true; if (stopTimer) window.clearTimeout(stopTimer); };
      }, [anim]);

      const onPointerDown = (e) => {
        if (typeof e.button === "number" && e.button !== 0) return;
        const el = e.currentTarget;
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        const rect = el.getBoundingClientRect();
        dragData = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false };
        setDragging(true);
      };
      const onPointerMove = (e) => {
        if (dragData) {
          const dx = e.clientX - dragData.x;
          const dy = e.clientY - dragData.y;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragData.moved = true;
          if (dx > 4) setDragDir("runRight");
          else if (dx < -4) setDragDir("runLeft");
          const vp = viewportSize();
          const left = Math.min(Math.max(dragData.left + dx, -W * 0.7), vp.w - W * 0.3);
          const top = Math.min(Math.max(dragData.top + dy, -H * 0.5), vp.h - H * 0.5);
          setPos({ left, top });
          return;
        }
        if (hover) {
          const rect = e.currentTarget.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
            if (deg < 0) deg += 360;
            setLookDir(Math.round(deg / 22.5) % 16);
          }
        }
      };
      const onPointerEnd = () => {
        const d = dragData;
        dragData = null;
        setDragging(false);
        if (d && !d.moved) {
          const now = Date.now();
          clickTimes = clickTimes.filter((t) => now - t < 1500);
          clickTimes.push(now);
          if (clickTimes.length >= 3) {
            clickTimes = [];
            doDive();
          } else {
            showBubble(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
          }
        }
      };

      let col;
      let row;
      if (anim === "look") {
        const lk = STATES.look;
        if (lookDir < 8) { row = lk.rows[0]; col = lookDir; } else { row = lk.rows[1]; col = lookDir - 8; }
      } else {
        const spec = STATES[anim] || STATES.idle;
        row = spec.row;
        col = frame % (spec.frames || 1);
      }
      const bgX = -(col * W);
      const bgY = -(row * H);

      const wrapStyle = {
        position: "fixed",
        width: W,
        height: H,
        zIndex: 1000,
        pointerEvents: "auto",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      };
      if (pos) { wrapStyle.left = pos.left; wrapStyle.top = pos.top; }
      else { wrapStyle.right = 20; wrapStyle.bottom = 20; }

      const spriteStyle = {
        position: "absolute",
        left: 0,
        top: 0,
        width: W,
        height: H,
        backgroundImage: 'url("/ronaldo-pet/spritesheet.webp")',
        backgroundSize: String(W * 8) + "px " + String(H * 11) + "px",
        backgroundPosition: String(bgX) + "px " + String(bgY) + "px",
        backgroundRepeat: "no-repeat",
        imageRendering: "auto",
        cursor: dragging ? "grabbing" : "grab",
      };

      return react.createElement("div", {
        onPointerDown,
        onPointerMove,
        onPointerUp: onPointerEnd,
        onPointerCancel: onPointerEnd,
        onPointerEnter: () => setHover(true),
        onPointerLeave: () => setHover(false),
        style: wrapStyle,
        title: "C罗桌宠 · 拖动移动 · 悬停看光标 · 连点假摔",
      },
        react.createElement("div", { key: "sprite", style: spriteStyle }),
        react.createElement("div", { key: "bubble", className: "ronaldo-bubble" }, bubble),
        react.createElement("div", {
          key: "viewport",
          ref: (el) => { viewportEl = el; },
          style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", visibility: "hidden" },
        })
      );
    }

    ctx.slots.inject("shell.overlay", () => ctx.slots.register(
      { name: "shell.overlay", id: "ronaldo-pet", order: 100, label: "C罗桌宠" },
      RonaldoPet,
    ));
  }

  exports.apply = apply;
  exports.inject = inject;
  exports.name = name;
  return module.exports;
}});
