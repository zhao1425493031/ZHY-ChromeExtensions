(() => {
  if (window.__PAGE_ANNOTATE__) return;
  window.__PAGE_ANNOTATE__ = true;

  const COLORS = ["#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#0f172a"];
  const WIDTHS = [
    { id: "thin", value: 2, labelKey: "widthThin" },
    { id: "mid", value: 3, labelKey: "widthMid" },
    { id: "thick", value: 6, labelKey: "widthThick" }
  ];
  const DELAYS = [0, 2, 3];
  const LONG_MAX_PX = 12000;
  // Chrome caps captureVisibleTab (~2/sec). Stay under quota with margin.
  const CAPTURE_MIN_INTERVAL_MS = 600;
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
  let lastCaptureAt = 0;

  const STATE = {
    active: false,
    tool: "pen",
    color: COLORS[0],
    lineWidth: 3,
    widthId: "mid",
    captureDelay: 0,
    markerNext: 1,
    shapes: [],
    redoStack: [],
    drawing: false,
    start: null,
    current: null,
    selectedId: null,
    drag: null,
    busy: false,
    root: null,
    canvas: null,
    wrap: null,
    ctx: null,
    dock: null,
    toolbar: null,
    noteEl: null,
    toastEl: null,
    delayBtn: null,
    textInput: null,
    fileInput: null,
    imageCache: new Map()
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PA_START") {
      start();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "PA_TOGGLE") {
      if (STATE.active) stop();
      else start();
      sendResponse({ ok: true, active: STATE.active });
      return;
    }
    if (message?.type === "PA_STOP") {
      stop();
      sendResponse({ ok: true });
    }
  });

  function start() {
    if (STATE.active) return;
    STATE.active = true;
    buildUi();
    resizeCanvas();
    redraw();
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("paste", onPaste, true);
    // Capture scroll from window AND nested scrollers (height may change).
    document.addEventListener("scroll", onScrollOrLayout, true);
    showToast(t("toastStart"));
  }

  function stop() {
    if (!STATE.active) return;
    STATE.active = false;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("paste", onPaste, true);
    document.removeEventListener("scroll", onScrollOrLayout, true);
    removeTextInput();
    STATE.root?.remove();
    Object.assign(STATE, {
      root: null,
      canvas: null,
      wrap: null,
      ctx: null,
      dock: null,
      toolbar: null,
      noteEl: null,
      toastEl: null,
      delayBtn: null,
      fileInput: null,
      drawing: false,
      current: null,
      drag: null,
      selectedId: null,
      busy: false
    });
  }

  function buildUi() {
    const root = document.createElement("div");
    root.id = "pa-root";

    const wrap = document.createElement("div");
    wrap.className = "pa-canvas-wrap";
    const canvas = document.createElement("canvas");
    canvas.className = "pa-layer";
    wrap.appendChild(canvas);

    const dock = document.createElement("div");
    dock.className = "pa-dock";

    const note = document.createElement("textarea");
    note.className = "pa-note";
    note.rows = 2;
    note.placeholder = t("notePlaceholder");
    note.addEventListener("keydown", (e) => e.stopPropagation());
    note.addEventListener("pointerdown", (e) => e.stopPropagation());

    const toolbar = document.createElement("div");
    toolbar.className = "pa-toolbar";
    toolbar.innerHTML = `
      <div class="pa-group" data-tools>
        <button class="pa-btn pa-active" data-tool="pen" title="${esc(t("titlePen"))}">${esc(t("toolPen"))}</button>
        <div class="pa-menu-wrap">
          <button class="pa-btn" type="button" data-menu="shape" title="${esc(t("titleShapeMenu"))}">${esc(t("toolShape"))} ▾</button>
          <div class="pa-flyout" data-flyout="shape" hidden>
            <button class="pa-btn" type="button" data-tool="rect" title="${esc(t("titleRect"))}">${esc(t("toolRect"))}</button>
            <button class="pa-btn" type="button" data-tool="circle" title="${esc(t("titleCircle"))}">${esc(t("toolCircle"))}</button>
            <button class="pa-btn" type="button" data-tool="ellipse" title="${esc(t("titleEllipse"))}">${esc(t("toolEllipse"))}</button>
          </div>
        </div>
        <button class="pa-btn" data-tool="highlight" title="${esc(t("titleHighlight"))}">${esc(t("toolHighlight"))}</button>
        <div class="pa-menu-wrap">
          <button class="pa-btn" type="button" data-menu="line" title="${esc(t("titleLineMenu"))}">${esc(t("toolLines"))} ▾</button>
          <div class="pa-flyout" data-flyout="line" hidden>
            <button class="pa-btn" type="button" data-tool="line" title="${esc(t("titleLine"))}">${esc(t("toolLine"))}</button>
            <button class="pa-btn" type="button" data-tool="arrow" title="${esc(t("titleArrow"))}">${esc(t("toolArrow"))}</button>
            <button class="pa-btn" type="button" data-tool="doubleArrow" title="${esc(t("titleDoubleArrow"))}">${esc(t("toolDoubleArrow"))}</button>
          </div>
        </div>
        <button class="pa-btn" data-tool="text" title="${esc(t("titleText"))}">${esc(t("toolText"))}</button>
        <button class="pa-btn" data-tool="marker" title="${esc(t("titleMarker"))}">${esc(t("toolMarker"))}</button>
        <button class="pa-btn" data-tool="mosaic" title="${esc(t("titleMosaic"))}">${esc(t("toolMosaic"))}</button>
        <button class="pa-btn" data-tool="region" title="${esc(t("titleRegion"))}">${esc(t("toolRegion"))}</button>
        <button class="pa-btn" data-tool="image" title="${esc(t("titleImage"))}">${esc(t("toolImage"))}</button>
        <button class="pa-btn" data-tool="select" title="${esc(t("titleSelect"))}">${esc(t("toolSelect"))}</button>
      </div>
      <div class="pa-sep"></div>
      <div class="pa-group" data-colors></div>
      <div class="pa-sep"></div>
      <div class="pa-group" data-widths title="${esc(t("titleWidth"))}"></div>
      <div class="pa-sep"></div>
      <div class="pa-group">
        <button class="pa-btn pa-ghost" data-action="undo" title="${esc(t("titleUndo"))}">${esc(t("btnUndo"))}</button>
        <button class="pa-btn pa-ghost" data-action="redo" title="${esc(t("titleRedo"))}">${esc(t("btnRedo"))}</button>
        <button class="pa-btn pa-ghost" data-action="clear" title="${esc(t("titleClear"))}">${esc(t("btnClearShort"))}</button>
      </div>
      <div class="pa-sep"></div>
      <div class="pa-group">
        <button class="pa-btn pa-ghost" data-action="delay" title="${esc(t("titleDelay"))}">${esc(delayLabel())}</button>
        <button class="pa-btn pa-primary" data-action="copy" title="${esc(t("titleCopy"))}">${esc(t("btnCopy"))}</button>
        <button class="pa-btn" data-action="download" title="${esc(t("titleDownload"))}">${esc(t("btnDownload"))}</button>
        <button class="pa-btn pa-long" data-action="long" title="${esc(t("titleLong"))}">${esc(t("btnLong"))}</button>
        <button class="pa-btn pa-ghost" data-action="exit" title="${esc(t("titleExit"))}">${esc(t("btnExit"))}</button>
      </div>
    `;

    const colors = toolbar.querySelector("[data-colors]");
    COLORS.forEach((color, index) => {
      const btn = document.createElement("button");
      btn.className = `pa-swatch${index === 0 ? " pa-active" : ""}`;
      btn.style.background = color;
      btn.dataset.color = color;
      btn.title = color;
      colors.appendChild(btn);
    });

    const widths = toolbar.querySelector("[data-widths]");
    WIDTHS.forEach((w) => {
      const btn = document.createElement("button");
      btn.className = `pa-btn${w.id === STATE.widthId ? " pa-active" : ""}`;
      btn.dataset.width = w.id;
      btn.title = t("titleWidth");
      btn.textContent = t(w.labelKey);
      widths.appendChild(btn);
    });

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "pa-file";
    fileInput.addEventListener("change", onFilePicked);

    const toast = document.createElement("div");
    toast.className = "pa-toast";

    dock.append(note, toolbar);
    root.append(wrap, dock, toast, fileInput);
    document.documentElement.appendChild(root);

    STATE.root = root;
    STATE.wrap = wrap;
    STATE.canvas = canvas;
    STATE.ctx = canvas.getContext("2d");
    STATE.dock = dock;
    STATE.toolbar = toolbar;
    STATE.noteEl = note;
    STATE.toastEl = toast;
    STATE.delayBtn = toolbar.querySelector('[data-action="delay"]');
    STATE.fileInput = fileInput;

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);
    wrap.addEventListener("dblclick", onDblClick);
    toolbar.addEventListener("click", onToolbarClick);
    toolbar.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  function delayLabel() {
    return t("btnDelay", [String(STATE.captureDelay)]);
  }

  const SHAPE_TOOLS = new Set(["rect", "circle", "ellipse"]);
  const LINE_TOOLS = new Set(["line", "arrow", "doubleArrow"]);

  function onToolbarClick(e) {
    if (STATE.busy) return;

    const menuBtn = e.target.closest("[data-menu]");
    if (menuBtn) {
      const name = menuBtn.dataset.menu;
      const flyout = STATE.toolbar.querySelector(`[data-flyout="${name}"]`);
      const open = flyout && !flyout.hasAttribute("hidden");
      closeAllFlyouts();
      if (flyout && !open) flyout.removeAttribute("hidden");
      return;
    }

    const toolBtn = e.target.closest("[data-tool]");
    if (toolBtn) {
      const tool = toolBtn.dataset.tool;
      setTool(tool);
      closeAllFlyouts();
      removeTextInput();
      if (tool === "region") showToast(t("toastRegionHint"));
      if (tool === "mosaic") showToast(t("toastMosaicHint"));
      if (tool === "select") showToast(t("toastSelectHint"));
      if (tool === "marker") showToast(t("toastMarkerHint"));
      if (LINE_TOOLS.has(tool)) showToast(t("toastLineHint"));
      if (SHAPE_TOOLS.has(tool)) showToast(t("toastShapeHint"));
      if (tool === "image") STATE.fileInput?.click();
      return;
    }

    closeAllFlyouts();

    const colorBtn = e.target.closest("[data-color]");
    if (colorBtn) {
      STATE.color = colorBtn.dataset.color;
      STATE.toolbar.querySelectorAll("[data-color]").forEach((el) => {
        el.classList.toggle("pa-active", el === colorBtn);
      });
      return;
    }

    const widthBtn = e.target.closest("[data-width]");
    if (widthBtn) {
      const conf = WIDTHS.find((w) => w.id === widthBtn.dataset.width);
      if (!conf) return;
      STATE.widthId = conf.id;
      STATE.lineWidth = conf.value;
      STATE.toolbar.querySelectorAll("[data-width]").forEach((el) => {
        el.classList.toggle("pa-active", el === widthBtn);
      });
      return;
    }

    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    if (action === "undo") undo();
    if (action === "redo") redo();
    if (action === "clear") clearAll();
    if (action === "delay") cycleDelay();
    if (action === "copy") captureFull({ download: false, copy: true });
    if (action === "download") captureFull({ download: true, copy: false });
    if (action === "long") captureLongPage();
    if (action === "exit") stop();
  }

  function closeAllFlyouts() {
    STATE.toolbar?.querySelectorAll("[data-flyout]").forEach((el) => {
      el.setAttribute("hidden", "");
    });
  }

  function cycleDelay() {
    const idx = DELAYS.indexOf(STATE.captureDelay);
    STATE.captureDelay = DELAYS[(idx + 1) % DELAYS.length];
    if (STATE.delayBtn) STATE.delayBtn.textContent = delayLabel();
    showToast(t("toastDelay", [String(STATE.captureDelay || 0)]));
  }

  function onResize() {
    resizeCanvas();
    redraw(STATE.current);
  }

  function onScrollOrLayout() {
    // Nested scrollers can grow the page; keep overlay covering the document.
    const beforeW = STATE.overlayW;
    const beforeH = STATE.overlayH;
    layoutOverlaySize();
    if (beforeW !== STATE.overlayW || beforeH !== STATE.overlayH) {
      resizeCanvas();
      redraw(STATE.current);
    }
  }

  function layoutOverlaySize() {
    const w = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
      window.innerWidth
    );
    const h = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      window.innerHeight
    );
    STATE.overlayW = w;
    STATE.overlayH = h;
    if (STATE.root) {
      STATE.root.style.width = `${w}px`;
      STATE.root.style.height = `${h}px`;
    }
  }

  function resizeCanvas() {
    const canvas = STATE.canvas;
    if (!canvas) return;
    layoutOverlaySize();
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    const w = STATE.overlayW || window.innerWidth;
    const h = STATE.overlayH || window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    STATE.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Page coordinates so marks stick to content while the page scrolls.
  function pointFromEvent(e) {
    return { x: e.pageX, y: e.pageY };
  }

  function toViewportRect(shape) {
    return {
      x: shape.x - window.scrollX,
      y: shape.y - window.scrollY,
      w: shape.w,
      h: shape.h
    };
  }

  function onPointerDown(e) {
    if (STATE.busy || e.button !== 0) return;
    const p = pointFromEvent(e);

    if (STATE.tool === "select") {
      beginSelectDrag(p, e);
      return;
    }
    if (STATE.tool === "marker") {
      placeMarker(p);
      return;
    }
    if (STATE.tool === "image") {
      STATE.fileInput?.click();
      return;
    }
    if (STATE.tool === "text") {
      openTextInput(p);
      return;
    }

    removeTextInput();
    STATE.selectedId = null;
    STATE.drawing = true;
    STATE.start = p;
    STATE.current = createShape(STATE.tool, p);
    STATE.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function placeMarker(p) {
    const id = `mk_${Date.now()}_${STATE.markerNext}`;
    STATE.shapes.push({
      type: "marker",
      id,
      n: STATE.markerNext,
      x: p.x,
      y: p.y,
      r: 14,
      color: STATE.color
    });
    STATE.markerNext += 1;
    STATE.selectedId = id;
    STATE.redoStack = [];
    redraw();
  }

  function beginSelectDrag(p, e) {
    const hit = hitTestMovable(p);
    if (!hit) {
      STATE.selectedId = null;
      redraw();
      return;
    }
    STATE.selectedId = hit.shape.id;
    STATE.drag = {
      mode: hit.handle ? "resize" : "move",
      shapeId: hit.shape.id,
      start: p,
      orig: snapshotShape(hit.shape)
    };
    STATE.drawing = true;
    STATE.canvas.setPointerCapture(e.pointerId);
    redraw();
    e.preventDefault();
  }

  function snapshotShape(shape) {
    if (shape.type === "marker") return { x: shape.x, y: shape.y, r: shape.r };
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }

  function onPointerMove(e) {
    const p = pointFromEvent(e);
    if (STATE.tool === "select" && !STATE.drawing) {
      const hit = hitTestMovable(p);
      if (hit?.handle) setWrapCursor("nwse");
      else if (hit) setWrapCursor("move");
      else setWrapCursor("default");
    }
    if (!STATE.drawing) return;
    if (STATE.drag) {
      applyDrag(p);
      redraw();
      return;
    }
    if (!STATE.current) return;
    updateShape(STATE.current, STATE.start, p);
    redraw(STATE.current);
  }

  async function onPointerUp(e) {
    if (!STATE.drawing) return;
    STATE.drawing = false;
    const p = pointFromEvent(e);

    if (STATE.drag) {
      STATE.drag = null;
      STATE.redoStack = [];
      redraw();
      return;
    }

    if (!STATE.current) return;
    updateShape(STATE.current, STATE.start, p);
    const shape = STATE.current;
    STATE.current = null;

    if (shape?.type === "region") {
      redraw();
      if (!isMeaningful(shape)) return showToast(t("toastRegionTooSmall"));
      await captureRegion(shape, { download: false, copy: true });
      return;
    }
    if (shape?.type === "mosaic") {
      redraw();
      if (!isMeaningful(shape)) return showToast(t("toastRegionTooSmall"));
      await applyMosaic(shape);
      return;
    }
    if (isMeaningful(shape)) {
      STATE.shapes.push(shape);
      STATE.redoStack = [];
    }
    redraw();
  }

  function applyDrag(p) {
    const shape = STATE.shapes.find((s) => s.id === STATE.drag.shapeId);
    if (!shape) return;
    const dx = p.x - STATE.drag.start.x;
    const dy = p.y - STATE.drag.start.y;
    const o = STATE.drag.orig;
    if (shape.type === "marker") {
      shape.x = o.x + dx;
      shape.y = o.y + dy;
      return;
    }
    if (STATE.drag.mode === "move") {
      shape.x = o.x + dx;
      shape.y = o.y + dy;
      return;
    }
    shape.w = Math.max(40, o.w + dx);
    shape.h = Math.max(40, o.h + dy);
  }

  function onDblClick(e) {
    if (
      ["region", "mosaic", "image", "select", "marker", "line", "arrow", "doubleArrow", "circle", "ellipse", "rect"].includes(
        STATE.tool
      )
    ) {
      return;
    }
    setTool("text");
    openTextInput(pointFromEvent(e));
  }

  function createShape(tool, start) {
    if (tool === "pen") {
      return { type: "pen", color: STATE.color, width: STATE.lineWidth, points: [{ ...start }] };
    }
    if (tool === "rect" || tool === "circle" || tool === "ellipse") {
      return {
        type: tool,
        color: STATE.color,
        width: STATE.lineWidth,
        x: start.x,
        y: start.y,
        w: 0,
        h: 0
      };
    }
    if (tool === "highlight") {
      return { type: "highlight", color: STATE.color, x: start.x, y: start.y, w: 0, h: 0 };
    }
    if (tool === "region" || tool === "mosaic") {
      return {
        type: tool,
        color: tool === "mosaic" ? "#a855f7" : "#38bdf8",
        width: 2,
        x: start.x,
        y: start.y,
        w: 0,
        h: 0
      };
    }
    if (tool === "arrow" || tool === "line" || tool === "doubleArrow") {
      return {
        type: tool,
        color: STATE.color,
        width: STATE.lineWidth,
        x1: start.x,
        y1: start.y,
        x2: start.x,
        y2: start.y
      };
    }
    return null;
  }

  function updateShape(shape, start, end) {
    if (shape.type === "pen") {
      shape.points.push({ ...end });
      return;
    }
    // Circle must stay a square anchored at the start corner.
    // Using free bbox + min(w,h) makes the center "walk" while dragging.
    if (shape.type === "circle") {
      const side = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      shape.x = end.x < start.x ? start.x - side : start.x;
      shape.y = end.y < start.y ? start.y - side : start.y;
      shape.w = side;
      shape.h = side;
      return;
    }
    if (["rect", "ellipse", "region", "mosaic", "highlight"].includes(shape.type)) {
      shape.x = Math.min(start.x, end.x);
      shape.y = Math.min(start.y, end.y);
      shape.w = Math.abs(end.x - start.x);
      shape.h = Math.abs(end.y - start.y);
      return;
    }
    if (shape.type === "arrow" || shape.type === "line" || shape.type === "doubleArrow") {
      shape.x2 = end.x;
      shape.y2 = end.y;
    }
  }

  function isMeaningful(shape) {
    if (!shape) return false;
    if (shape.type === "pen") return shape.points.length > 2;
    if (["rect", "circle", "ellipse", "region", "mosaic", "highlight"].includes(shape.type)) {
      return shape.w > 8 && shape.h > 8;
    }
    if (shape.type === "arrow" || shape.type === "line" || shape.type === "doubleArrow") {
      return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > 6;
    }
    if (shape.type === "text") return Boolean(shape.text?.trim());
    if (shape.type === "marker") return true;
    if (shape.type === "image" || shape.type === "mosaicImage") return Boolean(shape.dataUrl);
    return false;
  }

  function redraw(preview) {
    const ctx = STATE.ctx;
    if (!ctx) return;
    const w = STATE.overlayW || window.innerWidth;
    const h = STATE.overlayH || window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    for (const shape of STATE.shapes) drawShape(ctx, shape);
    if (preview) drawShape(ctx, preview);
    drawSelection(ctx);
  }

  function drawSelection(ctx) {
    if (!STATE.selectedId) return;
    const shape = STATE.shapes.find((s) => s.id === STATE.selectedId);
    if (!shape) return;
    ctx.save();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    if (shape.type === "marker") {
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.r + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape.type === "image" || shape.type === "mosaicImage") {
      ctx.strokeRect(shape.x - 1, shape.y - 1, shape.w + 2, shape.h + 2);
      ctx.setLineDash([]);
      ctx.fillStyle = "#38bdf8";
      const hs = 8;
      ctx.fillRect(shape.x + shape.w - hs / 2, shape.y + shape.h - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  function drawShape(ctx, shape) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = shape.color || STATE.color;
    ctx.fillStyle = shape.color || STATE.color;
    ctx.lineWidth = shape.width || STATE.lineWidth;

    if (shape.type === "pen") {
      const pts = shape.points;
      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else if (shape.type === "rect") {
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
    } else if (shape.type === "circle") {
      const r = Math.min(shape.w, shape.h) / 2;
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        shape.x + shape.w / 2,
        shape.y + shape.h / 2,
        Math.max(0, shape.w / 2),
        Math.max(0, shape.h / 2),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    } else if (shape.type === "highlight") {
      ctx.globalAlpha = 0.35;
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
    } else if (shape.type === "region" || shape.type === "mosaic") {
      ctx.fillStyle = shape.type === "mosaic" ? "rgba(168, 85, 247, 0.18)" : "rgba(14, 116, 144, 0.18)";
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
    } else if (shape.type === "arrow") {
      drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2, shape.width || 3, false);
    } else if (shape.type === "doubleArrow") {
      drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2, shape.width || 3, true);
    } else if (shape.type === "line") {
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
    } else if (shape.type === "text") {
      ctx.font = `600 ${shape.size || 18}px "Segoe UI", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif`;
      ctx.textBaseline = "top";
      String(shape.text).split("\n").forEach((line, i) => {
        ctx.fillText(line, shape.x, shape.y + i * ((shape.size || 18) * 1.35));
      });
    } else if (shape.type === "marker") {
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.max(12, shape.r)}px "Segoe UI", "PingFang SC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(shape.n), shape.x, shape.y + 0.5);
    } else if (shape.type === "image" || shape.type === "mosaicImage") {
      const img = STATE.imageCache.get(shape.id);
      if (img) ctx.drawImage(img, shape.x, shape.y, shape.w, shape.h);
    }
    ctx.restore();
  }

  function drawArrow(ctx, x1, y1, x2, y2, width, bothEnds) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = Math.max(10, width * 4);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    drawArrowHead(ctx, x2, y2, ux, uy, head);
    if (bothEnds) drawArrowHead(ctx, x1, y1, -ux, -uy, head);
  }

  function drawArrowHead(ctx, x, y, ux, uy, head) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - ux * head - uy * head * 0.45, y - uy * head + ux * head * 0.45);
    ctx.lineTo(x - ux * head + uy * head * 0.45, y - uy * head - ux * head * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  function hitTestMovable(p) {
    for (let i = STATE.shapes.length - 1; i >= 0; i--) {
      const shape = STATE.shapes[i];
      if (shape.type === "marker") {
        if (Math.hypot(p.x - shape.x, p.y - shape.y) <= shape.r + 4) {
          return { shape, handle: false };
        }
        continue;
      }
      if (shape.type !== "image" && shape.type !== "mosaicImage") continue;
      const handle = { x: shape.x + shape.w, y: shape.y + shape.h };
      if (Math.hypot(p.x - handle.x, p.y - handle.y) <= 12) return { shape, handle: true };
      if (p.x >= shape.x && p.x <= shape.x + shape.w && p.y >= shape.y && p.y <= shape.y + shape.h) {
        return { shape, handle: false };
      }
    }
    return null;
  }

  function openTextInput(point) {
    removeTextInput();
    const input = document.createElement("textarea");
    input.className = "pa-text-input";
    input.rows = 2;
    input.placeholder = t("textPlaceholder");
    input.style.left = `${Math.max(0, point.x)}px`;
    input.style.top = `${Math.max(0, point.y)}px`;
    input.style.color = STATE.color;
    const commit = () => {
      const text = input.value.trim();
      if (text) {
        STATE.shapes.push({ type: "text", color: STATE.color, x: point.x, y: point.y, text, size: 18 });
        STATE.redoStack = [];
        redraw();
      }
      removeTextInput();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        removeTextInput();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (STATE.textInput === input) commit();
      }, 120);
    });
    STATE.root.appendChild(input);
    STATE.textInput = input;
    input.focus();
  }

  function removeTextInput() {
    STATE.textInput?.remove();
    STATE.textInput = null;
  }

  function undo() {
    const shape = STATE.shapes.pop();
    if (shape) STATE.redoStack.push(shape);
    if (STATE.selectedId && !STATE.shapes.some((s) => s.id === STATE.selectedId)) STATE.selectedId = null;
    redraw();
  }

  function redo() {
    const shape = STATE.redoStack.pop();
    if (!shape) return;
    STATE.shapes.push(shape);
    redraw();
  }

  function clearAll() {
    STATE.shapes = [];
    STATE.redoStack = [];
    STATE.selectedId = null;
    STATE.markerNext = 1;
    redraw();
  }

  function deleteSelected() {
    if (!STATE.selectedId) return;
    const idx = STATE.shapes.findIndex((s) => s.id === STATE.selectedId);
    if (idx < 0) return;
    const [removed] = STATE.shapes.splice(idx, 1);
    STATE.redoStack.push(removed);
    STATE.selectedId = null;
    redraw();
    showToast(t("toastDeleted"));
  }

  async function onPaste(e) {
    if (!STATE.active || STATE.busy) return;
    if (STATE.textInput || document.activeElement === STATE.noteEl) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      e.preventDefault();
      e.stopPropagation();
      const file = item.getAsFile();
      if (!file) return;
      const dataUrl = await readFileAsDataUrl(file);
      await addImageShape(dataUrl, {
        x: window.scrollX + window.innerWidth * 0.2,
        y: window.scrollY + window.innerHeight * 0.2
      });
      setTool("select");
      showToast(t("toastImageAdded"));
      return;
    }
  }

  async function onFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    await addImageShape(dataUrl, {
      x: window.scrollX + window.innerWidth * 0.2,
      y: window.scrollY + window.innerHeight * 0.2
    });
    setTool("select");
    showToast(t("toastImageAdded"));
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addImageShape(dataUrl, origin, type = "image") {
    const img = await loadImage(dataUrl);
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    STATE.imageCache.set(id, img);
    const maxW = Math.min(420, window.innerWidth * 0.45);
    const scale = type === "mosaicImage" ? 1 : Math.min(1, maxW / img.naturalWidth);
    const w = Math.max(40, type === "mosaicImage" ? origin.w : img.naturalWidth * scale);
    const h = Math.max(40, type === "mosaicImage" ? origin.h : img.naturalHeight * scale);
    const shape = { type, id, dataUrl, x: origin.x, y: origin.y, w, h };
    STATE.shapes.push(shape);
    STATE.selectedId = id;
    STATE.redoStack = [];
    redraw();
    return shape;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function applyMosaic(rectShape) {
    const dock = STATE.dock;
    if (dock) dock.classList.add("pa-hidden");
    redraw();
    await nextFrame();
    await nextFrame();
    try {
      const shot = await captureVisibleRaw();
      const cropped = await cropDataUrl(shot, toViewportRect(rectShape));
      const pixelated = await pixelateDataUrl(cropped, 12);
      await addImageShape(pixelated, { x: rectShape.x, y: rectShape.y, w: rectShape.w, h: rectShape.h }, "mosaicImage");
      showToast(t("toastMosaicDone"));
    } catch (err) {
      showToast(err?.message || t("toastCaptureFail"));
    } finally {
      dock?.classList.remove("pa-hidden");
    }
  }

  async function waitCaptureDelay() {
    const sec = STATE.captureDelay;
    if (!sec) return;
    hideAnnotateForCapture();
    for (let i = sec; i > 0; i--) {
      showToast(t("toastDelay", [String(i)]));
      await sleep(1000);
    }
  }

  async function captureFull({ download, copy }) {
    await runCapture({ download, copy, rect: null });
  }

  async function captureRegion(rectShape, opts) {
    await runCapture({
      ...opts,
      rect: toViewportRect(rectShape)
    });
  }

  async function runCapture({ download, copy, rect }) {
    if (STATE.busy) return;
    STATE.busy = true;
    removeTextInput();
    const prevSelected = STATE.selectedId;
    STATE.selectedId = null;
    try {
      await waitCaptureDelay();
      const dock = STATE.dock;
      const toast = STATE.toastEl;
      if (dock) dock.classList.add("pa-hidden");
      if (toast) toast.classList.remove("pa-show");
      redraw();
      await nextFrame();
      await nextFrame();

      const shot = await captureVisibleRaw();
      let dataUrl = shot;
      if (rect) dataUrl = await cropDataUrl(shot, rect);

      const saved = await chrome.runtime.sendMessage({
        type: "PA_COMMIT",
        dataUrl,
        note: STATE.noteEl?.value?.trim() || "",
        download: Boolean(download)
      });
      if (!saved?.ok) throw new Error(saved?.error || t("toastCaptureFail"));

      if (copy) {
        await copyImage(dataUrl);
        showToast(t("toastCopied"));
      } else if (download) {
        showToast(t("toastDownload"));
      }
    } catch (err) {
      showToast(err?.message || t("toastCaptureFail"));
    } finally {
      showAnnotateAfterCapture();
      STATE.selectedId = prevSelected;
      STATE.busy = false;
      if (STATE.root) STATE.root.style.opacity = "1";
      redraw();
    }
  }

  function findScrollRoot() {
    const doc = document.scrollingElement || document.documentElement;
    let best = {
      el: doc,
      delta: Math.max(0, doc.scrollHeight - doc.clientHeight),
      viewportH: window.innerHeight
    };

    const nodes = document.body ? document.body.querySelectorAll("*") : [];
    for (const el of nodes) {
      if (el.closest && el.closest("#pa-root")) continue;
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") continue;
      const delta = el.scrollHeight - el.clientHeight;
      if (delta < 80) continue;
      // Prefer the roomiest scroll area (ChatGPT-like apps scroll an inner panel).
      const areaBoost = Math.min(el.clientWidth, window.innerWidth) / window.innerWidth;
      const score = delta * (0.6 + 0.4 * areaBoost);
      const bestScore = best.delta * (best.el === doc ? 0.85 : 1);
      if (score > bestScore) {
        best = { el: el, delta, viewportH: Math.max(1, el.clientHeight) };
      }
    }
    return best;
  }

  function hideAnnotateForCapture() {
    if (STATE.wrap) STATE.wrap.style.visibility = "hidden";
    if (STATE.dock) STATE.dock.classList.add("pa-hidden");
    hideToastForCapture();
  }

  function showAnnotateAfterCapture() {
    if (STATE.wrap) STATE.wrap.style.visibility = "";
    if (STATE.dock) STATE.dock.classList.remove("pa-hidden");
    if (STATE.toastEl) STATE.toastEl.style.visibility = "";
  }

  function hideToastForCapture() {
    const el = STATE.toastEl;
    if (!el) return;
    el.classList.remove("pa-show");
    el.style.visibility = "hidden";
  }

  async function captureVisibleRaw() {
    hideToastForCapture();
    await nextFrame();
    await nextFrame();

    const now = Date.now();
    const wait = CAPTURE_MIN_INTERVAL_MS - (now - lastCaptureAt);
    if (wait > 0) await sleep(wait);

    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        if (STATE.toastEl) STATE.toastEl.style.visibility = "";
        showToast(t("toastLongRetry", [String(attempt)]));
        await sleep(CAPTURE_MIN_INTERVAL_MS * (attempt + 1));
        hideToastForCapture();
        await nextFrame();
        await nextFrame();
      }
      lastCaptureAt = Date.now();
      const raw = await chrome.runtime.sendMessage({ type: "PA_CAPTURE_RAW" });
      if (raw?.ok && raw.dataUrl) return raw.dataUrl;

      lastError = raw?.error || t("toastLongFail");
      const quota =
        /MAX_CAPTURE_VISIBLE_TAB|quota|rate/i.test(lastError) ||
        /exceeds the MAX_CAPTURE/i.test(lastError);
      if (!quota) break;
    }
    throw new Error(
      /MAX_CAPTURE_VISIBLE_TAB|quota|rate|exceeds the MAX_CAPTURE/i.test(lastError)
        ? t("toastLongQuota")
        : lastError || t("toastLongFail")
    );
  }

  async function captureLongPage() {
    if (STATE.busy) return;
    STATE.busy = true;
    removeTextInput();
    STATE.selectedId = null;
    redraw();

    const { el: scroller, viewportH: scrollViewH } = findScrollRoot();
    const originalTop = scroller.scrollTop;
    const viewportW = window.innerWidth;
    // Window capture height (CSS px) — stitching uses window viewport, not panel height.
    const windowViewH = window.innerHeight;
    const fullH = Math.max(scroller.scrollHeight, scroller.clientHeight);
    const maxScroll = Math.max(0, Math.min(fullH, LONG_MAX_PX) - scrollViewH);
    // Step inside the scrollable panel; keep modest overlap for sticky headers.
    const step = Math.max(80, Math.floor(scrollViewH * 0.78));

    try {
      hideAnnotateForCapture();
      if (STATE.toastEl) STATE.toastEl.style.visibility = "";
      showToast(t("toastLongStart"));
      await sleep(700);
      await waitCaptureDelay();
      hideAnnotateForCapture();

      if (maxScroll < 40) {
        const dataUrl = await captureVisibleRaw();
        await finishLongCapture(dataUrl, { shortPage: true });
        return;
      }

      scroller.scrollTop = 0;
      await sleep(450);

      const slices = [];
      let guard = 0;
      let lastY = -1;
      while (guard++ < 50) {
        const y = scroller.scrollTop;
        if (STATE.toastEl) STATE.toastEl.style.visibility = "";
        showToast(
          t("toastLongProgress", [
            String(Math.min(99, Math.round((y / Math.max(maxScroll, 1)) * 100)))
          ])
        );
        await sleep(280);
        const dataUrl = await captureVisibleRaw();
        slices.push({ dataUrl, y, windowViewH });

        if (y >= maxScroll - 2) break;
        const next = Math.min(maxScroll, y + step);
        if (next <= y || next === lastY) break;
        lastY = y;
        scroller.scrollTop = next;
        await sleep(220);
        if (Math.abs(scroller.scrollTop - y) < 2) break;
      }

      if (!slices.length) throw new Error(t("toastLongFail"));

      scroller.scrollTop = originalTop;
      await sleep(200);
      if (STATE.toastEl) STATE.toastEl.style.visibility = "";
      showToast(t("toastLongStitch"));
      const stitched = await stitchSlices(slices, viewportW, windowViewH);
      await finishLongCapture(stitched, { shortPage: false, slices: slices.length });
    } catch (err) {
      scroller.scrollTop = originalTop;
      if (STATE.toastEl) STATE.toastEl.style.visibility = "";
      showToast(err?.message || t("toastLongFail"));
    } finally {
      showAnnotateAfterCapture();
      STATE.busy = false;
      if (STATE.root) STATE.root.style.opacity = "1";
      redraw();
    }
  }

  async function finishLongCapture(dataUrl, { shortPage }) {
    const saved = await chrome.runtime.sendMessage({
      type: "PA_COMMIT",
      dataUrl,
      note: STATE.noteEl?.value?.trim() || "",
      download: true
    });
    if (!saved?.ok) throw new Error(saved?.error || t("toastLongFail"));
    await copyImage(dataUrl);
    showAnnotateAfterCapture();

    // Do NOT paste a tiny preview onto the annotate canvas — that looks blurry.
    // Open the full-resolution image in a new tab instead.
    try {
      await chrome.runtime.sendMessage({ type: "PA_OPEN_IMAGE", dataUrl });
    } catch {
      // ignore popup/tab failures; download + clipboard already done
    }

    showToast(shortPage ? t("toastLongShort") : t("toastLongDone"));
  }

  async function stitchSlices(slices, viewportW, windowViewH) {
    if (!slices.length) throw new Error(t("toastLongFail"));
    const imgs = [];
    for (const s of slices) imgs.push(await loadImage(s.dataUrl));

    const dpr = imgs[0].naturalWidth / viewportW || 1;
    const bands = [{ img: imgs[0], srcY: 0, srcH: imgs[0].naturalHeight }];

    for (let i = 1; i < slices.length; i++) {
      const img = imgs[i];
      const deltaCss = Math.max(1, slices[i].y - slices[i - 1].y);
      // Map scroll delta onto the captured window image.
      const captureCssH = img.naturalHeight / dpr;
      const srcY = Math.max(0, Math.round((captureCssH - deltaCss) * dpr));
      const srcH = Math.min(img.naturalHeight - srcY, Math.round(deltaCss * dpr));
      if (srcH > 0) bands.push({ img, srcY, srcH });
    }

    const totalH = bands.reduce((sum, b) => sum + b.srcH, 0);
    const canvas = document.createElement("canvas");
    canvas.width = imgs[0].naturalWidth;
    canvas.height = Math.max(1, totalH);
    const ctx = canvas.getContext("2d");
    // Keep pixels crisp; we only copy integer bands 1:1.
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let destY = 0;
    for (const band of bands) {
      ctx.drawImage(
        band.img,
        0,
        band.srcY,
        band.img.naturalWidth,
        band.srcH,
        0,
        destY,
        band.img.naturalWidth,
        band.srcH
      );
      destY += band.srcH;
    }

    return canvas.toDataURL("image/png");
  }

  async function cropDataUrl(dataUrl, rect) {
    const img = await loadImage(dataUrl);
    const dpr = img.naturalWidth / window.innerWidth || 1;
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(rect.w * dpr)));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(rect.h * dpr)));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL("image/png");
  }

  async function pixelateDataUrl(dataUrl, block = 12) {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    const sctx = src.getContext("2d");
    sctx.drawImage(img, 0, 0);
    const data = sctx.getImageData(0, 0, w, h);
    const out = sctx.createImageData(w, h);
    for (let y = 0; y < h; y += block) {
      for (let x = 0; x < w; x += block) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let count = 0;
        const y2 = Math.min(h, y + block);
        const x2 = Math.min(w, x + block);
        for (let yy = y; yy < y2; yy++) {
          for (let xx = x; xx < x2; xx++) {
            const i = (yy * w + xx) * 4;
            r += data.data[i];
            g += data.data[i + 1];
            b += data.data[i + 2];
            a += data.data[i + 3];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        a = Math.round(a / count);
        for (let yy = y; yy < y2; yy++) {
          for (let xx = x; xx < x2; xx++) {
            const i = (yy * w + xx) * 4;
            out.data[i] = r;
            out.data[i + 1] = g;
            out.data[i + 2] = b;
            out.data[i + 3] = a;
          }
        }
      }
    }
    sctx.putImageData(out, 0, 0);
    return src.toDataURL("image/png");
  }

  async function copyImage(dataUrl) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    } catch {
      await navigator.clipboard.writeText(dataUrl);
    }
  }

  function onKeyDown(e) {
    if (!STATE.active || STATE.busy) return;
    if (STATE.textInput) return;
    if (document.activeElement === STATE.noteEl) {
      if (e.key === "Escape") {
        e.preventDefault();
        STATE.noteEl.blur();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stop();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (STATE.selectedId) {
        e.preventDefault();
        deleteSelected();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if (
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
    ) {
      e.preventDefault();
      redo();
      return;
    }

    const toolMap = {
      1: "pen",
      2: "rect",
      3: "highlight",
      4: "arrow",
      5: "text",
      6: "marker",
      7: "mosaic",
      8: "region",
      9: "image",
      0: "select"
    };
    if (toolMap[e.key]) {
      const tool = toolMap[e.key];
      setTool(tool);
      if (tool === "region") showToast(t("toastRegionHint"));
      if (tool === "mosaic") showToast(t("toastMosaicHint"));
      if (tool === "select") showToast(t("toastSelectHint"));
      if (tool === "marker") showToast(t("toastMarkerHint"));
      if (LINE_TOOLS.has(tool)) showToast(t("toastLineHint"));
      if (SHAPE_TOOLS.has(tool)) showToast(t("toastShapeHint"));
      if (tool === "image") STATE.fileInput?.click();
    }
  }

  function setTool(tool) {
    STATE.tool = tool;
    if (tool !== "select") STATE.selectedId = null;
    STATE.toolbar?.querySelectorAll("[data-tool]").forEach((el) => {
      el.classList.toggle("pa-active", el.dataset.tool === tool);
    });
    // Highlight parent group buttons when a submenu tool is active.
    STATE.toolbar?.querySelectorAll("[data-menu]").forEach((el) => {
      const group = el.dataset.menu;
      const active =
        (group === "shape" && SHAPE_TOOLS.has(tool)) ||
        (group === "line" && LINE_TOOLS.has(tool));
      el.classList.toggle("pa-active", active);
    });
    updateCursor();
    redraw();
  }

  function updateCursor() {
    if (!STATE.wrap) return;
    STATE.wrap.classList.remove("pa-cursor-move", "pa-cursor-nwse", "pa-cursor-default");
    if (STATE.tool === "select" || STATE.tool === "marker") {
      STATE.wrap.classList.add("pa-cursor-default");
    }
  }

  function setWrapCursor(kind) {
    if (!STATE.wrap) return;
    STATE.wrap.classList.remove("pa-cursor-move", "pa-cursor-nwse", "pa-cursor-default");
    if (kind === "move") STATE.wrap.classList.add("pa-cursor-move");
    if (kind === "nwse") STATE.wrap.classList.add("pa-cursor-nwse");
    if (kind === "default") STATE.wrap.classList.add("pa-cursor-default");
  }

  function nextFrame() {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  let toastTimer = 0;
  function showToast(text) {
    const el = STATE.toastEl;
    if (!el) return;
    el.textContent = text;
    el.classList.add("pa-show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove("pa-show"), 2600);
  }

  function esc(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
