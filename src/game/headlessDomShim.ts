/**
 * Lightweight, deterministic Headless DOM & Software 2D Canvas Rasterizer Shim for Node.js QA tests.
 * No-ops completely in real browsers (`typeof window !== 'undefined' && typeof document !== 'undefined'`).
 * Enables Three.js r180 (`engine.ts`), procedural `CanvasTexture` generators, and HUD/Menu state machines
 * to execute identically inside `npx --yes tsx --test` with zero external npm dependencies.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseCssRgb(style: any): [number, number, number, number] {
  if (!style || typeof style !== 'string') return [128, 128, 128, 255];
  const s = style.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s === '#fff' || s === '#ffffff' || s === 'white') return [255, 255, 255, 255];
  if (s === '#000' || s === '#000000' || s === 'black') return [0, 0, 0, 255];
  if (s.startsWith('#')) {
    if (s.length === 4) {
      const r = parseInt(s[1] + s[1], 16);
      const g = parseInt(s[2] + s[2], 16);
      const b = parseInt(s[3] + s[3], 16);
      return [r || 0, g || 0, b || 0, 255];
    }
    if (s.length >= 7) {
      const r = parseInt(s.slice(1, 3), 16);
      const g = parseInt(s.slice(3, 5), 16);
      const b = parseInt(s.slice(5, 7), 16);
      const a = s.length >= 9 ? parseInt(s.slice(7, 9), 16) : 255;
      return [r || 0, g || 0, b || 0, Number.isFinite(a) ? a : 255];
    }
  }
  const rgbaMatch = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, Math.round(Number(rgbaMatch[1]))));
    const g = Math.max(0, Math.min(255, Math.round(Number(rgbaMatch[2]))));
    const b = Math.max(0, Math.min(255, Math.round(Number(rgbaMatch[3]))));
    const a = rgbaMatch[4] !== undefined ? Math.max(0, Math.min(255, Math.round(Number(rgbaMatch[4]) * 255))) : 255;
    return [r, g, b, a];
  }
  return [140, 140, 140, 255];
}

class HeadlessGradient {
  stops: Array<{ offset: number; rgba: [number, number, number, number] }> = [];
  addColorStop(offset: number, color: string) {
    this.stops.push({ offset, rgba: parseCssRgb(color) });
    this.stops.sort((a, b) => a.offset - b.offset);
  }
  sample(t: number): [number, number, number, number] {
    if (this.stops.length === 0) return [128, 128, 128, 255];
    if (t <= this.stops[0].offset) return this.stops[0].rgba;
    const last = this.stops[this.stops.length - 1];
    if (t >= last.offset) return last.rgba;
    for (let i = 0; i < this.stops.length - 1; i++) {
      const a = this.stops[i];
      const b = this.stops[i + 1];
      if (t >= a.offset && t <= b.offset) {
        const u = (t - a.offset) / Math.max(1e-6, b.offset - a.offset);
        return [
          Math.round(a.rgba[0] + (b.rgba[0] - a.rgba[0]) * u),
          Math.round(a.rgba[1] + (b.rgba[1] - a.rgba[1]) * u),
          Math.round(a.rgba[2] + (b.rgba[2] - a.rgba[2]) * u),
          Math.round(a.rgba[3] + (b.rgba[3] - a.rgba[3]) * u),
        ];
      }
    }
    return last.rgba;
  }
}

class HeadlessCanvas2DContext {
  canvas: HeadlessCanvasElement;
  fillStyle: any = '#000000';
  strokeStyle: any = '#000000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  font = '12px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  shadowColor = 'transparent';
  shadowBlur = 0;
  private pathMinX = 0;
  private pathMinY = 0;
  private pathMaxX = 0;
  private pathMaxY = 0;
  private hasPath = false;
  private tx = 0;
  private ty = 0;
  private stack: Array<{ fillStyle: any; strokeStyle: any; globalAlpha: number; tx: number; ty: number }> = [];

  constructor(canvas: HeadlessCanvasElement) {
    this.canvas = canvas;
  }

  private resolveColor(style: any, u = 0.5): [number, number, number, number] {
    if (style instanceof HeadlessGradient) return style.sample(u);
    return parseCssRgb(style);
  }

  private blendPixel(x: number, y: number, r: number, g: number, b: number, a255: number) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const buf = this.canvas._ensureBuffer();
    const idx = (y * w + x) * 4;
    const alpha = Math.max(0, Math.min(1, (a255 / 255) * this.globalAlpha));
    if (alpha <= 0) return;
    if (alpha >= 0.999) {
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
      return;
    }
    const inv = 1 - alpha;
    buf[idx] = Math.round(r * alpha + buf[idx] * inv);
    buf[idx + 1] = Math.round(g * alpha + buf[idx + 1] * inv);
    buf[idx + 2] = Math.round(b * alpha + buf[idx + 2] * inv);
    buf[idx + 3] = Math.min(255, Math.round(255 * alpha + buf[idx + 3] * inv));
  }

  save() {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha,
      tx: this.tx,
      ty: this.ty,
    });
  }
  restore() {
    const s = this.stack.pop();
    if (s) {
      this.fillStyle = s.fillStyle;
      this.strokeStyle = s.strokeStyle;
      this.globalAlpha = s.globalAlpha;
      this.tx = s.tx;
      this.ty = s.ty;
    }
  }
  scale() {}
  rotate() {}
  translate(dx: number, dy: number) {
    this.tx += dx;
    this.ty += dy;
  }
  transform() {}
  setTransform() {
    this.tx = 0;
    this.ty = 0;
  }
  resetTransform() {
    this.tx = 0;
    this.ty = 0;
  }
  setLineDash() {}
  clip() {}

  createLinearGradient() {
    return new HeadlessGradient();
  }
  createRadialGradient() {
    return new HeadlessGradient();
  }

  clearRect(x: number, y: number, w: number, h: number) {
    const buf = this.canvas._ensureBuffer();
    const x0 = Math.max(0, Math.floor(x + this.tx));
    const y0 = Math.max(0, Math.floor(y + this.ty));
    const x1 = Math.min(this.canvas.width, Math.ceil(x + this.tx + w));
    const y1 = Math.min(this.canvas.height, Math.ceil(y + this.ty + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.canvas.width + px) * 4;
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
        buf[i + 3] = 0;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number) {
    const x0 = Math.max(0, Math.floor(x + this.tx));
    const y0 = Math.max(0, Math.floor(y + this.ty));
    const x1 = Math.min(this.canvas.width, Math.ceil(x + this.tx + w));
    const y1 = Math.min(this.canvas.height, Math.ceil(y + this.ty + h));
    const spanY = Math.max(1, y1 - y0);
    for (let py = y0; py < y1; py++) {
      const [r, g, b, a] = this.resolveColor(this.fillStyle, (py - y0) / spanY);
      for (let px = x0; px < x1; px++) {
        this.blendPixel(px, py, r, g, b, a);
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number) {
    const [r, g, b, a] = this.resolveColor(this.strokeStyle, 0.5);
    const x0 = Math.round(x + this.tx);
    const y0 = Math.round(y + this.ty);
    const x1 = Math.round(x + this.tx + w);
    const y1 = Math.round(y + this.ty + h);
    for (let px = x0; px <= x1; px++) {
      this.blendPixel(px, y0, r, g, b, a);
      this.blendPixel(px, y1, r, g, b, a);
    }
    for (let py = y0; py <= y1; py++) {
      this.blendPixel(x0, py, r, g, b, a);
      this.blendPixel(x1, py, r, g, b, a);
    }
  }

  beginPath() {
    this.hasPath = false;
    this.pathMinX = Infinity;
    this.pathMinY = Infinity;
    this.pathMaxX = -Infinity;
    this.pathMaxY = -Infinity;
  }

  private expandPath(x: number, y: number) {
    const wx = x + this.tx;
    const wy = y + this.ty;
    this.hasPath = true;
    this.pathMinX = Math.min(this.pathMinX, wx);
    this.pathMinY = Math.min(this.pathMinY, wy);
    this.pathMaxX = Math.max(this.pathMaxX, wx);
    this.pathMaxY = Math.max(this.pathMaxY, wy);
  }

  moveTo(x: number, y: number) {
    this.expandPath(x, y);
  }
  lineTo(x: number, y: number) {
    this.expandPath(x, y);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
    this.expandPath(cpx, cpy);
    this.expandPath(x, y);
  }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
    this.expandPath(cp1x, cp1y);
    this.expandPath(cp2x, cp2y);
    this.expandPath(x, y);
  }
  arc(x: number, y: number, r: number) {
    this.expandPath(x - r, y - r);
    this.expandPath(x + r, y + r);
  }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.expandPath(x - rx, y - ry);
    this.expandPath(x + rx, y + ry);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.expandPath(x, y);
    this.expandPath(x + w, y + h);
  }
  roundRect(x: number, y: number, w: number, h: number) {
    this.rect(x, y, w, h);
  }
  closePath() {}

  fill() {
    if (!this.hasPath) return;
    const x0 = Math.max(0, Math.floor(this.pathMinX));
    const y0 = Math.max(0, Math.floor(this.pathMinY));
    const x1 = Math.min(this.canvas.width, Math.ceil(this.pathMaxX) + 1);
    const y1 = Math.min(this.canvas.height, Math.ceil(this.pathMaxY) + 1);
    const [r, g, b, a] = this.resolveColor(this.fillStyle, 0.5);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.blendPixel(px, py, r, g, b, a);
      }
    }
  }

  stroke() {
    if (!this.hasPath) return;
    const [r, g, b, a] = this.resolveColor(this.strokeStyle, 0.5);
    const steps = Math.max(
      2,
      Math.ceil(Math.hypot(this.pathMaxX - this.pathMinX, this.pathMaxY - this.pathMinY))
    );
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const px = Math.round(this.pathMinX + (this.pathMaxX - this.pathMinX) * u);
      const py = Math.round(this.pathMinY + (this.pathMaxY - this.pathMinY) * u);
      this.blendPixel(px, py, r, g, b, a);
    }
  }

  fillText(text: string, x: number, y: number) {
    const [r, g, b, a] = this.resolveColor(this.fillStyle, 0.5);
    const len = Math.min(24, (text || '').length * 5);
    for (let i = 0; i < len; i++) {
      this.blendPixel(Math.round(x + this.tx + i), Math.round(y + this.ty), r, g, b, a);
    }
  }
  strokeText(text: string, x: number, y: number) {
    this.fillText(text, x, y);
  }
  measureText(text: string) {
    return { width: (text || '').length * 7 };
  }
  drawImage() {}

  createImageData(w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  getImageData(sx: number, sy: number, sw: number, sh: number) {
    const buf = this.canvas._ensureBuffer();
    const out = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      const py = Math.max(0, Math.min(this.canvas.height - 1, sy + y));
      for (let x = 0; x < sw; x++) {
        const px = Math.max(0, Math.min(this.canvas.width - 1, sx + x));
        const src = (py * this.canvas.width + px) * 4;
        const dst = (y * sw + x) * 4;
        out[dst] = buf[src];
        out[dst + 1] = buf[src + 1];
        out[dst + 2] = buf[src + 2];
        out[dst + 3] = buf[src + 3];
      }
    }
    return { width: sw, height: sh, data: out };
  }
  putImageData(img: { width: number; height: number; data: Uint8ClampedArray }, dx: number, dy: number) {
    const buf = this.canvas._ensureBuffer();
    for (let y = 0; y < img.height; y++) {
      const py = dy + y;
      if (py < 0 || py >= this.canvas.height) continue;
      for (let x = 0; x < img.width; x++) {
        const px = dx + x;
        if (px < 0 || px >= this.canvas.width) continue;
        const src = (y * img.width + x) * 4;
        const dst = (py * this.canvas.width + px) * 4;
        buf[dst] = img.data[src];
        buf[dst + 1] = img.data[src + 1];
        buf[dst + 2] = img.data[src + 2];
        buf[dst + 3] = img.data[src + 3];
      }
    }
  }
}

class ClassListShim {
  private set = new Set<string>();
  constructor(private owner: HeadlessElement) {}
  private sync() {
    this.owner._className = [...this.set].join(' ');
  }
  _fromString(v: string) {
    this.set.clear();
    for (const part of String(v || '').split(/\s+/)) {
      if (part) this.set.add(part);
    }
  }
  add(...tokens: string[]) {
    for (const t of tokens) if (t) this.set.add(t);
    this.sync();
  }
  remove(...tokens: string[]) {
    for (const t of tokens) this.set.delete(t);
    this.sync();
  }
  toggle(token: string, force?: boolean) {
    const on = force !== undefined ? force : !this.set.has(token);
    if (on) this.set.add(token);
    else this.set.delete(token);
    this.sync();
    return on;
  }
  contains(token: string) {
    return this.set.has(token);
  }
}

function matchesSimpleSelector(el: HeadlessElement, sel: string): boolean {
  const s = sel.trim();
  if (!s) return false;
  if (s.includes(',')) {
    return s.split(',').some((part) => matchesSimpleSelector(el, part));
  }
  if (s.includes(' ')) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (!matchesSimpleSelector(el, parts[parts.length - 1])) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (cur && !matchesSimpleSelector(cur, parts[i])) {
        cur = cur.parentElement;
      }
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  let rem = s;
  const attrRe = /\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(s)) !== null) {
    const attrName = m[1];
    const attrVal = m[2];
    const actual = el.getAttribute(attrName);
    if (actual === null) return false;
    if (attrVal !== undefined && actual !== attrVal) return false;
  }
  rem = rem.replace(attrRe, '');

  const idMatch = rem.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch && el.id !== idMatch[1]) return false;
  rem = rem.replace(/#[a-zA-Z0-9_-]+/g, '');

  const classMatches = rem.match(/\.[a-zA-Z0-9_-]+/g);
  if (classMatches) {
    for (const c of classMatches) {
      if (!el.classList.contains(c.slice(1))) return false;
    }
  }
  rem = rem.replace(/\.[a-zA-Z0-9_-]+/g, '');

  if (rem && el.tagName.toLowerCase() !== rem.toLowerCase()) return false;
  return true;
}

function parseHtmlFragment(html: string, doc: any): HeadlessElement[] {
  const nodes: HeadlessElement[] = [];
  const root = new HeadlessElement('div', doc);
  const stack: HeadlessElement[] = [root];
  const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'circle', 'rect', 'line']);
  const tokenRe = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9:-]+)\s*>|<([a-zA-Z0-9:-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[1]) {
      const closeTag = m[1].toLowerCase();
      while (stack.length > 1) {
        const top = stack.pop()!;
        if (top.tagName.toLowerCase() === closeTag) break;
      }
    } else if (m[2]) {
      const tag = m[2];
      const attrStr = m[3] || '';
      const selfClose = !!m[4] || voidTags.has(tag.toLowerCase());
      const el = doc.createElement(tag);
      const attrPairRe = /([a-zA-Z0-9:_-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g;
      let am: RegExpExecArray | null;
      while ((am = attrPairRe.exec(attrStr)) !== null) {
        const k = am[1];
        const v = am[2] ?? am[3] ?? am[4] ?? '';
        el.setAttribute(k, v);
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClose) stack.push(el);
    } else if (m[5]) {
      const txt = m[5];
      if (stack.length > 0 && txt.trim()) {
        stack[stack.length - 1]._ownText += txt;
      }
    }
  }
  for (const ch of root.children) {
    ch.parentElement = null;
    nodes.push(ch);
  }
  return nodes;
}

export class HeadlessElement {
  tagName: string;
  id = '';
  _className = '';
  classList: ClassListShim;
  style: Record<string, any> = { setProperty() {} };
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: HeadlessElement[] = [];
  parentElement: HeadlessElement | null = null;
  hidden = false;
  value = '';
  disabled = false;
  _ownText = '';
  private listeners = new Map<string, Set<(ev: any) => void>>();
  ownerDocument: any;

  constructor(tagName: string, doc?: any) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = doc || null;
    this.classList = new ClassListShim(this);
    this.dataset = new Proxy(
      {},
      {
        set: (target: Record<string, string>, prop: string, val: any) => {
          const str = String(val);
          target[prop] = str;
          const kebab = 'data-' + prop.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
          this.attributes.set(kebab, str);
          return true;
        },
        get: (target: Record<string, string>, prop: string) => target[prop],
        deleteProperty: (target: Record<string, string>, prop: string) => {
          delete target[prop];
          const kebab = 'data-' + prop.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
          this.attributes.delete(kebab);
          return true;
        },
      }
    );
  }

  get className() {
    return this._className;
  }
  set className(v: string) {
    this._className = String(v || '');
    this.classList._fromString(this._className);
  }

  get textContent(): string {
    return this._ownText + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.children = [];
    this._ownText = String(v ?? '');
  }

  get innerHTML(): string {
    return this.textContent;
  }
  set innerHTML(html: string) {
    this.children = [];
    this._ownText = '';
    if (!html) return;
    const parsed = parseHtmlFragment(String(html), this.ownerDocument || (globalThis as any).document);
    for (const ch of parsed) this.appendChild(ch);
  }

  get offsetParent(): any {
    return this.hidden ? null : (this.parentElement || {});
  }

  setAttribute(name: string, val: string) {
    const v = String(val ?? '');
    this.attributes.set(name, v);
    if (name === 'id') this.id = v;
    else if (name === 'class') this.className = v;
    else if (name === 'hidden') this.hidden = true;
    else if (name === 'value') this.value = v;
    else if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      (this.dataset as any)[camel] = v;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this._className || null;
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'hidden') this.hidden = false;
  }

  appendChild<T extends HeadlessElement>(child: T): T {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: any[]) {
    for (const n of nodes) {
      if (n instanceof HeadlessElement) this.appendChild(n);
      else this._ownText += String(n ?? '');
    }
  }

  removeChild(child: HeadlessElement) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }

  contains(other: any): boolean {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  closest(sel: string): HeadlessElement | null {
    let cur: HeadlessElement | null = this;
    while (cur) {
      if (matchesSimpleSelector(cur, sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(sel: string): HeadlessElement | null {
    for (const ch of this.children) {
      if (matchesSimpleSelector(ch, sel)) return ch;
      const hit = ch.querySelector(sel);
      if (hit) return hit;
    }
    return null;
  }

  querySelectorAll(sel: string): HeadlessElement[] {
    const out: HeadlessElement[] = [];
    const visit = (node: HeadlessElement) => {
      for (const ch of node.children) {
        if (matchesSimpleSelector(ch, sel)) out.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return out;
  }

  addEventListener(type: string, fn: (ev: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (ev: any) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(ev: any): boolean {
    if (!ev.target) ev.target = this;
    ev.preventDefault = ev.preventDefault || (() => {});
    ev.stopPropagation =
      ev.stopPropagation ||
      (() => {
        ev._stopped = true;
      });
    const set = this.listeners.get(ev.type);
    if (set) {
      for (const fn of [...set]) fn.call(this, ev);
    }
    if (!ev._stopped && ev.bubbles !== false && this.parentElement) {
      this.parentElement.dispatchEvent(ev);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, target: this });
  }
  focus() {}
  blur() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1440, height: 900, right: 1440, bottom: 900 };
  }
}

export class HeadlessCanvasElement extends HeadlessElement {
  private _w = 256;
  private _h = 256;
  _rgba: Uint8ClampedArray | null = null;
  private _ctx2d: HeadlessCanvas2DContext | null = null;

  constructor(doc?: any) {
    super('canvas', doc);
  }
  get width() {
    return this._w;
  }
  set width(v: number) {
    this._w = Math.max(1, Math.floor(v || 1));
    this._rgba = null;
  }
  get height() {
    return this._h;
  }
  set height(v: number) {
    this._h = Math.max(1, Math.floor(v || 1));
    this._rgba = null;
  }
  _ensureBuffer(): Uint8ClampedArray {
    const len = this._w * this._h * 4;
    if (!this._rgba || this._rgba.length !== len) {
      this._rgba = new Uint8ClampedArray(len);
    }
    return this._rgba;
  }
  getContext(type: string): any {
    if (type === '2d') {
      if (!this._ctx2d) this._ctx2d = new HeadlessCanvas2DContext(this);
      return this._ctx2d;
    }
    return null;
  }
  toDataURL() {
    return 'data:image/png;base64,';
  }
}

export function installHeadlessDomShimIfNeeded(): void {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return;
  }

  const g = globalThis as any;
  const winListeners = new Map<string, Set<(ev: any) => void>>();
  const storageMap = new Map<string, string>();

  const doc: any = {
    documentElement: null as any,
    body: null as any,
    head: null as any,
    hidden: false,
    fullscreenElement: null,
    pointerLockElement: null,
    activeElement: null,
    createElement(tag: string) {
      if (String(tag).toLowerCase() === 'canvas') return new HeadlessCanvasElement(doc);
      return new HeadlessElement(tag, doc);
    },
    createElementNS(_ns: string, tag: string) {
      return doc.createElement(tag);
    },
    getElementById(id: string) {
      return doc.documentElement.querySelector(`#${id}`);
    },
    querySelector(sel: string) {
      return doc.documentElement.querySelector(sel);
    },
    querySelectorAll(sel: string) {
      return doc.documentElement.querySelectorAll(sel);
    },
    addEventListener(type: string, fn: (ev: any) => void) {
      doc.documentElement.addEventListener(type, fn);
    },
    removeEventListener(type: string, fn: (ev: any) => void) {
      doc.documentElement.removeEventListener(type, fn);
    },
    exitPointerLock() {},
    exitFullscreen() {
      return Promise.resolve();
    },
  };

  doc.documentElement = new HeadlessElement('html', doc);
  doc.head = doc.documentElement.appendChild(new HeadlessElement('head', doc));
  doc.body = doc.documentElement.appendChild(new HeadlessElement('body', doc));

  const appEl = doc.body.appendChild(new HeadlessElement('div', doc));
  appEl.id = 'app';
  const uiEl = appEl.appendChild(new HeadlessElement('div', doc));
  uiEl.id = 'ui';
  const bootEl = appEl.appendChild(new HeadlessElement('div', doc));
  bootEl.id = 'boot';

  const localStorageShim = {
    getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
    setItem: (k: string, v: string) => {
      storageMap.set(k, String(v));
    },
    removeItem: (k: string) => {
      storageMap.delete(k);
    },
    clear: () => storageMap.clear(),
  };

  const win: any = {
    document: doc,
    navigator: { userAgent: 'HeadlessQA/1.0', maxTouchPoints: 0, hardwareConcurrency: 4 },
    location: { search: '', hash: '', href: 'http://localhost:3000/' },
    localStorage: localStorageShim,
    sessionStorage: localStorageShim,
    devicePixelRatio: 1,
    innerWidth: 1440,
    innerHeight: 900,
    performance: g.performance || { now: () => Date.now() },
    requestAnimationFrame: (cb: any) => setTimeout(() => cb(performance.now()), 16),
    cancelAnimationFrame: (id: any) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener(type: string, fn: (ev: any) => void) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev: any) => void) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev: any) {
      ev.preventDefault = ev.preventDefault || (() => {});
      ev.stopPropagation = ev.stopPropagation || (() => {});
      const set = winListeners.get(ev.type);
      if (set) {
        for (const fn of [...set]) fn.call(win, ev);
      }
      return true;
    },
    HTMLCanvasElement: HeadlessCanvasElement,
    HTMLElement: HeadlessElement,
    HTMLButtonElement: HeadlessElement,
    HTMLInputElement: HeadlessElement,
  };

  g.window = win;
  g.document = doc;
  if (!g.navigator) {
    Object.defineProperty(g, 'navigator', { value: win.navigator, configurable: true });
  }
  g.location = win.location;
  g.localStorage = localStorageShim;
  g.sessionStorage = localStorageShim;
  g.HTMLCanvasElement = HeadlessCanvasElement;
  g.HTMLElement = HeadlessElement;
  g.HTMLButtonElement = HeadlessElement;
  g.HTMLInputElement = HeadlessElement;
  g.HTMLImageElement = class {};
  g.HTMLVideoElement = class {};
  g.VideoFrame = class {};
  g.addEventListener = win.addEventListener.bind(win);
  g.removeEventListener = win.removeEventListener.bind(win);
  g.dispatchEvent = win.dispatchEvent.bind(win);
  g.matchMedia = win.matchMedia;
  g.requestAnimationFrame = win.requestAnimationFrame;
  g.cancelAnimationFrame = win.cancelAnimationFrame;
}

installHeadlessDomShimIfNeeded();
