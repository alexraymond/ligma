/**
 * Overlay script injected into the sandbox iframe's srcdoc.
 *
 * Two responsibilities:
 *  1. Element selection (mouseover outline + click → ELEMENT_SELECTED postMessage).
 *  2. Error reporting (window.onerror + unhandledrejection → IFRAME_ERROR postMessage).
 *
 * Defence in depth (C11): generated HTML may attach its own click handlers,
 * call `removeEventListener`, or freeze prototypes. We use `capture: true` so
 * we run before bubble-phase user handlers, AND we re-attach the listeners
 * every 200ms via `setInterval` in case user code stripped them. Re-attach is
 * idempotent because addEventListener with the same fn+capture is a no-op
 * when already attached.
 *
 * Bundled as a string at build time; do NOT import from anywhere except
 * the runtime's iframe HTML builder.
 */

export const OVERLAY_SCRIPT = `(function() {
  'use strict';
  var hovered = null;
  var pinned = null;
  var warned = Object.create(null);
  function warnOnce(key, err) {
    if (warned[key]) return;
    warned[key] = true;
    try { console.warn('[overlay] ' + key, err); } catch (_) { /* noop */ }
  }
  var currentMode = 'default';

  var watchedSelectors = [];
  var rectsFrameHandle = 0;
  var canvasSizeFrameHandle = 0;
  var lastCanvasW = 0;
  var lastCanvasH = 0;

  function resolveSelector(sel) {
    if (!sel || typeof sel !== 'string') return null;
    try {
      var c = sel.charAt(0);
      if (c === '#' || c === '[' || c === '.') return document.querySelector(sel);
      if (c === '/') {
        var res = document.evaluate(sel, document, null, 9, null);
        return res && res.singleNodeValue ? res.singleNodeValue : null;
      }
      return document.querySelector(sel);
    } catch (_) { return null; }
  }

  function measureAndPostRects() {
    rectsFrameHandle = 0;
    if (!watchedSelectors.length) return;
    var entries = [];
    for (var i = 0; i < watchedSelectors.length; i++) {
      var sel = watchedSelectors[i];
      var el = resolveSelector(sel);
      if (!el || !el.getBoundingClientRect) continue;
      var r = el.getBoundingClientRect();
      entries.push({
        selector: sel,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height }
      });
    }
    if (!entries.length) return;
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'ELEMENT_RECTS',
        entries: entries
      }, '*');
    } catch (err) { warnOnce('postMessage ELEMENT_RECTS failed', err); }
  }

  function scheduleRectsBroadcast() {
    if (rectsFrameHandle) return;
    try {
      rectsFrameHandle = window.requestAnimationFrame(measureAndPostRects);
    } catch (_) {
      measureAndPostRects();
    }
  }

  function measureAndPostCanvasSize() {
    canvasSizeFrameHandle = 0;
    var de = document.documentElement;
    var bd = document.body;
    var dew = de && typeof de.scrollWidth === 'number' ? de.scrollWidth : 0;
    var deh = de && typeof de.scrollHeight === 'number' ? de.scrollHeight : 0;
    var bdw = bd && typeof bd.scrollWidth === 'number' ? bd.scrollWidth : 0;
    var bdh = bd && typeof bd.scrollHeight === 'number' ? bd.scrollHeight : 0;
    var w = Math.max(dew, bdw);
    var h = Math.max(deh, bdh);
    // Skip when size is unknown / body not yet rendered.
    if (w === 0 && h === 0) return;
    if (w === lastCanvasW && h === lastCanvasH) return;
    lastCanvasW = w;
    lastCanvasH = h;
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'CANVAS_SIZE',
        width: w,
        height: h
      }, '*');
    } catch (err) { warnOnce('postMessage CANVAS_SIZE failed', err); }
  }

  function scheduleCanvasSize() {
    if (canvasSizeFrameHandle) return;
    try {
      canvasSizeFrameHandle = window.requestAnimationFrame(measureAndPostCanvasSize);
    } catch (_) {
      measureAndPostCanvasSize();
    }
  }

  function findArtboard(el) {
    while (el && el.nodeType === 1) {
      if (el.dataset && el.dataset.artboard !== undefined) return el;
      el = el.parentElement;
    }
    return null;
  }

  function applyArtboardOffsets() {
    // Direct-DOM mutation avoids any attribute-selector escaping nightmare
    // (labels can contain spaces, unicode mid-dots, quotes, etc.). We iterate
    // the real artboards, read their label, apply the matching offset inline,
    // and reset anything not in the map back to zero.
    var nodes;
    try { nodes = document.querySelectorAll('[data-artboard]'); }
    catch (_) { return; }
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var label = node.getAttribute('data-label') || '';
      var off = artboardOffsetsByLabel[label];
      try {
        if (off) {
          node.style.transform = 'translate3d(' + off.x + 'px,' + off.y + 'px,0)';
          node.style.willChange = 'transform';
          node.style.zIndex = String(off.z || 1);
        } else {
          node.style.transform = '';
          node.style.willChange = '';
          node.style.zIndex = '';
        }
      } catch (_) { /* inline style denied — skip this node */ }
    }
  }

  var HOVER_OUTLINE = '2px solid #c96442';
  var PINNED_OUTLINE = '2.5px solid #b5441a';
  var ARTBOARD_HOVER_OUTLINE = '3px solid #4a7fbf';
  var ARTBOARD_MOVE_OUTLINE = '3px dashed #4a7fbf';
  var hoveredArtboard = null;
  var moveState = null;
  var artboardOffsetsByLabel = Object.create(null);

  function clearHover() {
    // Don't clear if this element is pinned — pinned takes precedence.
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = ''; } catch (_) {}
    }
    hovered = null;
  }

  function clearPinned() {
    if (pinned) {
      try { pinned.style.outline = ''; } catch (_) {}
    }
    pinned = null;
  }


  function getXPath(el) {
    if (el.dataset && el.dataset.codesignId) return '[data-codesign-id="' + el.dataset.codesignId + '"]';
    if (el.id) return '#' + el.id;
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      var idx = 1;
      var sib = el.previousElementSibling;
      while (sib) { if (sib.tagName === el.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(el.tagName.toLowerCase() + '[' + idx + ']');
      el = el.parentElement;
    }
    return '/' + parts.join('/');
  }

  function clearHoveredArtboard() {
    if (hoveredArtboard) {
      try { hoveredArtboard.style.outline = ''; } catch (_) {}
      try { hoveredArtboard.style.cursor = ''; } catch (_) {}
    }
    hoveredArtboard = null;
  }
  function onMouseOver(e) {
    if (currentMode === 'artboard-select' || currentMode === 'artboard-move') {
      if (moveState) return;
      var ab = findArtboard(e.target);
      if (ab === hoveredArtboard) return;
      clearHoveredArtboard();
      if (ab) {
        hoveredArtboard = ab;
        try {
          ab.style.outline = currentMode === 'artboard-move'
            ? ARTBOARD_MOVE_OUTLINE
            : ARTBOARD_HOVER_OUTLINE;
        } catch (_) {}
        try {
          ab.style.cursor = currentMode === 'artboard-move' ? 'grab' : 'pointer';
        } catch (_) {}
      }
      return;
    }
    if (currentMode !== 'comment') return;
    // Don't override pinned outline on hover-in of a different element.
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = ''; } catch (_) {}
    }
    hovered = e.target;
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = HOVER_OUTLINE; } catch (_) {}
    }
  }
  function onMouseOut() {
    if (currentMode === 'artboard-select' || currentMode === 'artboard-move') {
      if (!moveState) clearHoveredArtboard();
      return;
    }
    if (currentMode !== 'comment') return;
    clearHover();
  }

  // --- Canvas pan (iframe -> parent scroll) -------------------------------
  // The outer CanvasViewport uses overflow:auto on a parent div, but a
  // wheel / drag happening inside the iframe never reaches it (iframes are
  // separate browsing contexts for event propagation). We forward wheel and
  // drag deltas up via postMessage so the parent can apply them to
  // scrollLeft/scrollTop. Pan must be Figma-native: trackpad 2-finger
  // scroll, Cmd+wheel zoom, Space+drag, middle-click drag — all "just
  // work" without a tool mode toggle.
  var panDragState = null;
  var spaceHeld = false;
  // Track whether a form field is focused inside the iframe — if so, Space
  // keydown is the user typing, not a pan gesture. We still forward wheel
  // though (a text field doesn't need trackpad scroll to do anything
  // special for design review).
  function isFormFieldFocused() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function onWheelPan(e) {
    // Always forward. Generated designs are artboards, not web pages — the
    // expected mental model is Figma: wheel pans, Cmd+wheel zooms. If the
    // parent receives a Cmd/Ctrl wheel it treats it as zoom (see
    // CanvasViewport's onWheel), otherwise scroll. Forwarding both deltas
    // keeps the iframe itself from rubber-banding (preventDefault below).
    e.preventDefault();
    e.stopPropagation();
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'CANVAS_PAN_WHEEL',
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        ctrlKey: e.ctrlKey === true,
        metaKey: e.metaKey === true,
      }, '*');
    } catch (err) { warnOnce('postMessage CANVAS_PAN_WHEEL failed', err); }
  }

  function onPanKeyDown(e) {
    if (e.code === 'Space' && !spaceHeld && !isFormFieldFocused()) {
      spaceHeld = true;
      try { document.body.style.cursor = 'grab'; } catch (_) {}
      // Prevent default scroll-on-space AND prevent the Space from inserting
      // a character if a non-form element happens to be focused.
      e.preventDefault();
    }
  }
  function onPanKeyUp(e) {
    if (e.code === 'Space' && spaceHeld) {
      spaceHeld = false;
      if (!panDragState) {
        try { document.body.style.cursor = ''; } catch (_) {}
      }
    }
  }

  function shouldStartPan(e) {
    // Middle-click pans regardless of mode.
    if (e.button === 1) return true;
    // Space+drag pans regardless of mode.
    if (spaceHeld) return true;
    // Explicit pan mode (toolbar button) makes any primary drag pan.
    if (currentMode === 'pan' && e.button === 0) return true;
    return false;
  }

  function onPanDown(e) {
    if (!shouldStartPan(e)) return;
    panDragState = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { document.body.style.cursor = 'grabbing'; } catch (_) {}
    e.preventDefault();
    e.stopPropagation();
  }
  function onPanMove(e) {
    if (!panDragState || e.pointerId !== panDragState.id) return;
    var dx = e.clientX - panDragState.x;
    var dy = e.clientY - panDragState.y;
    panDragState.x = e.clientX;
    panDragState.y = e.clientY;
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'CANVAS_PAN_DRAG',
        dx: dx,
        dy: dy,
      }, '*');
    } catch (err) { warnOnce('postMessage CANVAS_PAN_DRAG failed', err); }
    e.preventDefault();
  }
  function onPanUp(e) {
    if (!panDragState || e.pointerId !== panDragState.id) return;
    panDragState = null;
    // Keep the grab cursor while Space is still held, otherwise reset.
    try {
      document.body.style.cursor =
        spaceHeld || currentMode === 'pan' ? 'grab' : '';
    } catch (_) {}
    e.preventDefault();
  }

  function onPointerDownMove(e) {
    if (currentMode !== 'artboard-move') return;
    var ab = findArtboard(e.target);
    if (!ab) return;
    var label = ab.getAttribute('data-label') || '';
    if (!label) return;
    var prev = artboardOffsetsByLabel[label] || { x: 0, y: 0, z: 1 };
    moveState = {
      label: label,
      startX: e.clientX,
      startY: e.clientY,
      baseX: prev.x,
      baseY: prev.y,
    };
    e.preventDefault();
    e.stopPropagation();
    try { document.body.style.cursor = 'grabbing'; } catch (_) {}
    try { ab.style.cursor = 'grabbing'; } catch (_) {}
    // Raise the dragged artboard above siblings for the duration.
    artboardOffsetsByLabel[label] = { x: prev.x, y: prev.y, z: 100 };
    applyArtboardOffsets();
  }
  function onPointerMoveMove(e) {
    if (!moveState) return;
    var dx = e.clientX - moveState.startX;
    var dy = e.clientY - moveState.startY;
    artboardOffsetsByLabel[moveState.label] = {
      x: moveState.baseX + dx,
      y: moveState.baseY + dy,
      z: 100,
    };
    applyArtboardOffsets();
    e.preventDefault();
  }
  function onPointerUpMove(e) {
    if (!moveState) return;
    var label = moveState.label;
    var off = artboardOffsetsByLabel[label] || { x: 0, y: 0 };
    moveState = null;
    try { document.body.style.cursor = ''; } catch (_) {}
    // Settle z back to 1 so the next drag can raise again.
    artboardOffsetsByLabel[label] = { x: off.x, y: off.y, z: 1 };
    applyArtboardOffsets();
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'ARTBOARD_MOVED',
        label: label,
        x: off.x,
        y: off.y
      }, '*');
    } catch (err) { warnOnce('postMessage ARTBOARD_MOVED failed', err); }
    e.preventDefault();
  }
  function onClick(e) {
    if (currentMode === 'artboard-move') {
      // Suppress any click dispatched at the end of a drag — the move handler
      // already committed the position via pointerup.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (currentMode === 'artboard-select') {
      var ab = findArtboard(e.target);
      if (!ab) return;
      e.preventDefault();
      e.stopPropagation();
      var rect = ab.getBoundingClientRect();
      var label = ab.getAttribute('data-label') || '';
      var viewport = ab.getAttribute('data-viewport') || '';
      try {
        window.parent.postMessage({
          __codesign: true,
          type: 'ARTBOARD_SELECTED',
          label: label,
          viewport: viewport,
          outerHTML: (ab.outerHTML || ''),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        }, '*');
      } catch (err) { warnOnce('postMessage ARTBOARD_SELECTED failed', err); }
      return;
    }
    if (currentMode === 'comment') {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      // Pin the clicked element — its outline will persist until parent
      // sends CLEAR_PIN (bubble closed).
      if (pinned && pinned !== el) {
        try { pinned.style.outline = ''; } catch (_) {}
      }
      pinned = el;
      try { el.style.outline = PINNED_OUTLINE; } catch (_) {}
      var rect = el.getBoundingClientRect();
      var selector = getXPath(el);
      // Auto-watch the freshly-pinned element so scroll/resize immediately
      // keep its rect live, without waiting for a parent→iframe round-trip.
      if (watchedSelectors.indexOf(selector) === -1) watchedSelectors.push(selector);
      var parentHtml = '';
      try {
        if (el.parentElement && el.parentElement.outerHTML) {
          parentHtml = String(el.parentElement.outerHTML).slice(0, 600);
        }
      } catch (_) { /* parent inaccessible — leave blank */ }
      try {
        window.parent.postMessage({
          __codesign: true,
          type: 'ELEMENT_SELECTED',
          selector: selector,
          tag: el.tagName.toLowerCase(),
          outerHTML: (el.outerHTML || '').slice(0, 800),
          parentOuterHTML: parentHtml,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        }, '*');
      } catch (err) { console.warn('[overlay] postMessage ELEMENT_SELECTED failed:', err); }
      return;
    }
    // Default mode: block ALL navigating links — the sandbox iframe has no
    // routing and any real navigation (including hash jumps to non-existent
    // ids) would blank the preview. Agent should use React view-state for
    // multi-page designs; see agent.ts AGENTIC_TOOL_GUIDANCE.
    var anchor = e.target;
    while (anchor && anchor.tagName !== 'A') anchor = anchor.parentElement;
    if (anchor && (anchor.href || anchor.getAttribute('href'))) {
      var href = anchor.getAttribute('href') || '';
      // Allow hash-jump ONLY when it resolves to an existing element on page.
      if (href.charAt(0) === '#' && href.length > 1) {
        var id = href.slice(1);
        var target = null;
        try { target = document.getElementById(id); } catch (_) {}
        if (target) return; // let the browser scroll
      }
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onParentMessage(ev) {
    // Trust boundary: control messages must originate from the embedding
    // window. Untrusted in-iframe scripts can synthesise MessageEvent-shaped
    // calls into this handler (or, via window.postMessage(self,...), bounce
    // events off the iframe itself); both paths are rejected here so any
    // future control type added to the switch is structurally protected.
    if (!ev || ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.__codesign !== true) return;
    if (data.type === 'SET_MODE') {
      var next;
      if (data.mode === 'comment') next = 'comment';
      else if (data.mode === 'artboard-select') next = 'artboard-select';
      else if (data.mode === 'artboard-move') next = 'artboard-move';
      else if (data.mode === 'pan') next = 'pan';
      else next = 'default';
      if (next === currentMode) return;
      currentMode = next;
      if (currentMode !== 'comment') {
        clearHover();
        clearPinned();
      }
      if (currentMode !== 'artboard-select' && currentMode !== 'artboard-move') {
        clearHoveredArtboard();
      }
      // The iframe's own body cursor signals the mode to the user visually
      // because the iframe captures pointer events — the parent's cursor
      // style can't be seen once the pointer is inside.
      try {
        document.body.style.cursor = currentMode === 'pan' ? 'grab' : '';
      } catch (_) {}
      return;
    }
    if (data.type === 'APPLY_ARTBOARD_OFFSETS') {
      var payload = data.offsets;
      if (typeof payload !== 'object' || payload === null) return;
      artboardOffsetsByLabel = Object.create(null);
      for (var key in payload) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        var entry = payload[key];
        if (!entry || typeof entry.x !== 'number' || typeof entry.y !== 'number') continue;
        artboardOffsetsByLabel[key] = { x: entry.x, y: entry.y, z: 1 };
      }
      applyArtboardOffsets();
      return;
    }
    if (data.type === 'RESET_ARTBOARD_OFFSETS') {
      artboardOffsetsByLabel = Object.create(null);
      applyArtboardOffsets();
      return;
    }
    if (data.type === 'CLEAR_PIN') {
      clearPinned();
      return;
    }
    if (data.type === 'WATCH_SELECTORS') {
      var list = data.selectors;
      if (!Array.isArray(list)) return;
      var dedup = [];
      var seen = Object.create(null);
      for (var i = 0; i < list.length; i++) {
        var sel = list[i];
        if (typeof sel !== 'string' || seen[sel]) continue;
        seen[sel] = true;
        dedup.push(sel);
      }
      watchedSelectors = dedup;
      scheduleRectsBroadcast();
      return;
    }
  }
  function onError(ev) {
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'IFRAME_ERROR',
        kind: 'error',
        message: (ev && ev.message) ? String(ev.message) : 'Unknown iframe error',
        source: ev && ev.filename ? String(ev.filename) : undefined,
        lineno: ev && typeof ev.lineno === 'number' ? ev.lineno : undefined,
        colno: ev && typeof ev.colno === 'number' ? ev.colno : undefined,
        stack: ev && ev.error && ev.error.stack ? String(ev.error.stack) : undefined,
        timestamp: Date.now()
      }, '*');
    } catch (err) { console.warn('[overlay] postMessage IFRAME_ERROR (error) failed:', err); }
  }
  function onRejection(ev) {
    try {
      var reason = ev && ev.reason;
      var msg = (reason && reason.message) ? String(reason.message) : String(reason);
      window.parent.postMessage({
        __codesign: true,
        type: 'IFRAME_ERROR',
        kind: 'unhandledrejection',
        message: msg,
        stack: (reason && reason.stack) ? String(reason.stack) : undefined,
        timestamp: Date.now()
      }, '*');
    } catch (err) { console.warn('[overlay] postMessage IFRAME_ERROR (unhandledrejection) failed:', err); }
  }

  // Install + reinstall every 200ms. User code may call removeEventListener
  // or replace document.addEventListener; re-attaching is the cheapest defence.
  // addEventListener with the same fn+capture is a no-op when already present.
  var installs = [
    { evt: 'mouseover', fn: onMouseOver },
    { evt: 'mouseout', fn: onMouseOut },
    { evt: 'click', fn: onClick },
    { evt: 'pointerdown', fn: onPointerDownMove },
    { evt: 'pointermove', fn: onPointerMoveMove },
    { evt: 'pointerup', fn: onPointerUpMove },
    // Canvas-pan handlers — no-op when currentMode !== 'pan'. Registered in
    // capture phase (wheel also needs non-passive so preventDefault works).
    { evt: 'wheel', fn: onWheelPan, opts: { capture: true, passive: false } },
    { evt: 'pointerdown', fn: onPanDown },
    { evt: 'pointermove', fn: onPanMove },
    { evt: 'pointerup', fn: onPanUp },
    { evt: 'pointercancel', fn: onPanUp },
    { evt: 'submit', fn: function(e) { e.preventDefault(); } }
  ];
  function reattach() {
    for (var i = 0; i < installs.length; i++) {
      var spec = installs[i];
      // spec.opts overrides the default capture:true/passive:true when a
      // listener needs non-passive behaviour (wheel preventDefault requires
      // passive:false). Fall back to plain "true" for capture-phase install.
      var opts = spec.opts || true;
      try { document.removeEventListener(spec.evt, spec.fn, opts); } catch (err) { warnOnce('removeEventListener failed for ' + spec.evt, err); }
      try { document.addEventListener(spec.evt, spec.fn, opts); } catch (err) { warnOnce('addEventListener failed for ' + spec.evt, err); }
    }
    if (!window.__cs_err) {
      try { window.addEventListener('error', onError, true); window.__cs_err = true; } catch (err) { warnOnce('attach window error listener failed', err); }
    }
    if (!window.__cs_rej) {
      try { window.addEventListener('unhandledrejection', onRejection, true); window.__cs_rej = true; } catch (err) { warnOnce('attach unhandledrejection listener failed', err); }
    }
    if (!window.__cs_msg) {
      try { window.addEventListener('message', onParentMessage, false); window.__cs_msg = true; } catch (_) {}
    }
    if (!window.__cs_panKeys) {
      try {
        window.addEventListener('keydown', onPanKeyDown, true);
        window.addEventListener('keyup', onPanKeyUp, true);
        // Space-released while the window loses focus would otherwise leave
        // spaceHeld stuck at true forever. Reset on blur.
        window.addEventListener('blur', function () {
          if (spaceHeld) {
            spaceHeld = false;
            if (!panDragState) {
              try { document.body.style.cursor = ''; } catch (_) {}
            }
          }
        }, false);
        window.__cs_panKeys = true;
      } catch (err) { warnOnce('attach pan key listeners failed', err); }
    }
    if (!window.__cs_scroll) {
      try {
        // capture=true so scrolls on inner overflow containers also bubble in here
        window.addEventListener('scroll', scheduleRectsBroadcast, true);
        window.addEventListener('resize', function () {
          scheduleRectsBroadcast();
          scheduleCanvasSize();
        }, false);
        window.__cs_scroll = true;
      } catch (err) { warnOnce('attach scroll/resize listener failed', err); }
    }
    if (!window.__cs_canvas_observer && typeof MutationObserver === 'function') {
      try {
        var mo = new MutationObserver(function () { scheduleCanvasSize(); });
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        window.__cs_canvas_observer = mo;
      } catch (err) { warnOnce('attach canvas MutationObserver failed', err); }
    }
    // Schedule an initial broadcast so the parent can size the iframe to
    // content on first paint without waiting for any mutation.
    scheduleCanvasSize();
  }
  reattach();
  try {
    try { clearInterval(window.__cs_reattach_interval); } catch (_) {}
    window.__cs_reattach_interval = setInterval(reattach, 200);
    if (!window.__cs_reattach_unload) {
      window.__cs_reattach_unload = true;
      var stopReattach = function() {
        try { clearInterval(window.__cs_reattach_interval); } catch (_) {}
        window.__cs_reattach_interval = 0;
      };
      try { window.addEventListener('pagehide', stopReattach, false); } catch (_) {}
      try { window.addEventListener('beforeunload', stopReattach, false); } catch (_) {}
    }
  } catch (err) { try { console.warn('[overlay] setInterval reattach failed:', err); } catch (_) {} }

  // Neutralize programmatic navigation — generated code may call
  // window.location = '/foo', location.assign('/x'), or window.open(...)
  // in button onclick handlers. None of those routes exist in the sandbox and
  // they'd all blank the preview. We no-op them once, idempotently.
  // Also neutralize prompt/alert/confirm — Electron disables them in
  // iframes, so generated UI that calls them raises "prompt() is not
  // supported" and breaks the whole interaction. Returning "" / true / true
  // lets the design continue to render, and the agent can be told to avoid
  // these APIs in follow-up prompts.
  try {
    if (!window.__cs_navguard) {
      window.__cs_navguard = true;
      var nopNav = function() { /* navigation suppressed in preview sandbox */ };
      try { window.open = function() { return null; }; } catch (_) {}
      try { window.prompt = function() { return ''; }; } catch (_) {}
      try { window.alert = function() { /* suppressed */ }; } catch (_) {}
      try { window.confirm = function() { return true; }; } catch (_) {}
      try {
        var loc = window.location;
        try { loc.assign = nopNav; } catch (_) {}
        try { loc.replace = nopNav; } catch (_) {}
        try { loc.reload = nopNav; } catch (_) {}
      } catch (_) {}
    }
  } catch (err) { try { console.warn('[overlay] navguard install failed:', err); } catch (_) {} }
})();`;

export interface OverlayMessage {
  __codesign: true;
  type: 'ELEMENT_SELECTED';
  selector: string;
  tag: string;
  outerHTML: string;
  /** Optional v2 enrichment — parent element's outerHTML, truncated to 600
   *  chars. Older overlays may omit this; consumers must treat it as optional. */
  parentOuterHTML?: string;
  rect: { top: number; left: number; width: number; height: number };
}

export function isOverlayMessage(data: unknown): data is OverlayMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { __codesign?: boolean }).__codesign === true &&
    (data as { type?: string }).type === 'ELEMENT_SELECTED'
  );
}

export interface ElementRectsMessage {
  __codesign: true;
  type: 'ELEMENT_RECTS';
  entries: Array<{
    selector: string;
    rect: { top: number; left: number; width: number; height: number };
  }>;
}

/** Hard ceiling on entries per ELEMENT_RECTS message. The iframe runs LLM
 *  HTML; even though our overlay is trusted, untrusted in-iframe code can
 *  synthesise a matching envelope. Cap worst-case memory growth in the
 *  parent's liveRects store. Chosen generously — a design with 256 tracked
 *  pins is already beyond any realistic review session. */
export const MAX_ELEMENT_RECTS_ENTRIES = 256;

export function isElementRectsMessage(data: unknown): data is ElementRectsMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { __codesign?: boolean; type?: string; entries?: unknown };
  if (d.__codesign !== true || d.type !== 'ELEMENT_RECTS') return false;
  if (!Array.isArray(d.entries)) return false;
  if (d.entries.length > MAX_ELEMENT_RECTS_ENTRIES) return false;
  for (const e of d.entries) {
    if (typeof e !== 'object' || e === null) return false;
    const entry = e as { selector?: unknown; rect?: unknown };
    if (typeof entry.selector !== 'string') return false;
    const r = entry.rect as { top?: unknown; left?: unknown; width?: unknown; height?: unknown };
    if (
      typeof r !== 'object' ||
      r === null ||
      typeof r.top !== 'number' ||
      typeof r.left !== 'number' ||
      typeof r.width !== 'number' ||
      typeof r.height !== 'number'
    ) {
      return false;
    }
  }
  return true;
}

export interface CanvasSizeMessage {
  __codesign: true;
  type: 'CANVAS_SIZE';
  width: number;
  height: number;
}

export function isCanvasSizeMessage(data: unknown): data is CanvasSizeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { __codesign?: boolean; type?: string; width?: unknown; height?: unknown };
  return (
    d.__codesign === true &&
    d.type === 'CANVAS_SIZE' &&
    typeof d.width === 'number' &&
    typeof d.height === 'number' &&
    Number.isFinite(d.width) &&
    Number.isFinite(d.height) &&
    d.width >= 0 &&
    d.height >= 0
  );
}

export interface ArtboardSelectedMessage {
  __codesign: true;
  type: 'ARTBOARD_SELECTED';
  label: string;
  viewport: string;
  outerHTML: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface ArtboardMovedMessage {
  __codesign: true;
  type: 'ARTBOARD_MOVED';
  label: string;
  x: number;
  y: number;
}

export interface CanvasPanWheelMessage {
  __codesign: true;
  type: 'CANVAS_PAN_WHEEL';
  deltaX: number;
  deltaY: number;
  /** Ctrl held when the wheel fired — treated as zoom modifier on every OS. */
  ctrlKey?: boolean;
  /** Meta (Cmd) held — macOS zoom modifier. */
  metaKey?: boolean;
}

export function isCanvasPanWheelMessage(data: unknown): data is CanvasPanWheelMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as {
    __codesign?: boolean;
    type?: string;
    deltaX?: unknown;
    deltaY?: unknown;
    ctrlKey?: unknown;
    metaKey?: unknown;
  };
  return (
    d.__codesign === true &&
    d.type === 'CANVAS_PAN_WHEEL' &&
    typeof d.deltaX === 'number' &&
    typeof d.deltaY === 'number' &&
    Number.isFinite(d.deltaX) &&
    Number.isFinite(d.deltaY) &&
    (d.ctrlKey === undefined || typeof d.ctrlKey === 'boolean') &&
    (d.metaKey === undefined || typeof d.metaKey === 'boolean')
  );
}

export interface CanvasPanDragMessage {
  __codesign: true;
  type: 'CANVAS_PAN_DRAG';
  dx: number;
  dy: number;
}

export function isCanvasPanDragMessage(data: unknown): data is CanvasPanDragMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { __codesign?: boolean; type?: string; dx?: unknown; dy?: unknown };
  return (
    d.__codesign === true &&
    d.type === 'CANVAS_PAN_DRAG' &&
    typeof d.dx === 'number' &&
    typeof d.dy === 'number' &&
    Number.isFinite(d.dx) &&
    Number.isFinite(d.dy)
  );
}

export function isArtboardMovedMessage(data: unknown): data is ArtboardMovedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as {
    __codesign?: boolean;
    type?: string;
    label?: unknown;
    x?: unknown;
    y?: unknown;
  };
  return (
    d.__codesign === true &&
    d.type === 'ARTBOARD_MOVED' &&
    typeof d.label === 'string' &&
    typeof d.x === 'number' &&
    typeof d.y === 'number' &&
    Number.isFinite(d.x) &&
    Number.isFinite(d.y)
  );
}

export function isArtboardSelectedMessage(data: unknown): data is ArtboardSelectedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as {
    __codesign?: boolean;
    type?: string;
    label?: unknown;
    viewport?: unknown;
    outerHTML?: unknown;
    rect?: unknown;
  };
  if (d.__codesign !== true || d.type !== 'ARTBOARD_SELECTED') return false;
  if (typeof d.label !== 'string' || typeof d.viewport !== 'string') return false;
  if (typeof d.outerHTML !== 'string') return false;
  const r = d.rect as { top?: unknown; left?: unknown; width?: unknown; height?: unknown };
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.top === 'number' &&
    typeof r.left === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number'
  );
}
