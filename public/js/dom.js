// 小さなDOMヘルパー
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ja-JP') : '-');
export const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '-');
export const sec = (x) => (Number.isFinite(x) ? `${(Math.round(x * 100) / 100).toString()}秒` : '-');

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  box.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

export function iconUrl(name) {
  return name ? `https://enka.network/ui/${name}.png` : null;
}

export function img(name, cls, alt = '') {
  const src = iconUrl(name);
  if (!src) return h('span', { class: `${cls} img-placeholder` });
  return h('img', { class: cls, src, alt, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.classList.add('img-failed') });
}
