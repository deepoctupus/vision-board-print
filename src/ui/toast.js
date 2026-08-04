const HOST_ID = 'toasts';
const REDUCED = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function host() {
  let el = document.getElementById(HOST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HOST_ID;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Exibe uma notificação temporária.
 * @param {string} message texto exibido
 * @param {'info'|'success'|'error'} kind variante visual
 * @param {number} ms tempo até o fechamento automático
 * @returns {HTMLElement} o elemento criado
 */
export function toast(message, kind = 'info', ms = 3200) {
  const variant = kind === 'success' || kind === 'error' ? kind : 'info';
  const el = document.createElement('div');
  el.className = `toast toast--${variant}`;
  el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');

  const dot = document.createElement('span');
  dot.className = 'toast__dot';
  dot.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = String(message == null ? '' : message);

  el.append(dot, text);
  host().appendChild(el);

  const reduced = REDUCED();
  requestAnimationFrame(() => el.classList.add('is-in'));

  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    el.remove();
  };
  const dismiss = () => {
    if (done) return;
    el.classList.remove('is-in');
    el.classList.add('is-out');
    if (reduced) remove();
    else {
      el.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 400);
    }
  };

  el.addEventListener('click', dismiss);
  const timer = setTimeout(dismiss, Math.max(600, ms));
  el.addEventListener('click', () => clearTimeout(timer));
  return el;
}

export default toast;
