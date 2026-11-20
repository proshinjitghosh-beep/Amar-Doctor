/* Shared plumbing for the four healthcare modules.
   Everything here is a thin helper over the existing app.js utilities
   ($, LS, toast) so the new pages read like the rest of the app.       */

const H = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /** Escape text before it goes into innerHTML. */
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /** Call the API. Never throws for a non-2xx - the caller decides. */
  async function api(method, path, body, options = {}) {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (options.signal) init.signal = options.signal;

    try {
      const response = await fetch(path, init);
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const error = new Error((data && data.error) || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      const wrapped = new Error('সার্ভারের সাথে সংযোগ করা যায়নি।');
      wrapped.status = 0;
      throw wrapped;
    }
  }

  /* ------------------------------------------------------- session ----- */

  let me = null;
  let meLoaded = false;

  async function loadMe() {
    if (meLoaded) return me;
    meLoaded = true;
    try {
      const data = await api('GET', '/api/auth/me');
      me = data.user;
    } catch {
      me = null;
    }
    return me;
  }

  const isSignedIn = () => Boolean(me);

  /* ------------------------------------------------------ formatting --- */

  const bnDate = (value) =>
    new Date(value).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short', year: 'numeric' });

  const bnTime = (value) =>
    new Date(value).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true });

  const bnDateTime = (value) => `${bnDate(value)}, ${bnTime(value)}`;

  /** "৩ মিনিট পরে", "২ দিন আগে" - relative time in Bangla. */
  function bnRelative(value) {
    const diff = new Date(value).getTime() - Date.now();
    const abs = Math.abs(diff);
    const minutes = Math.round(abs / 60000);
    if (minutes < 1) return 'এইমাত্র';
    const unit = minutes < 60 ? `${minutes} মিনিট` : minutes < 1440 ? `${Math.round(minutes / 60)} ঘণ্টা` : `${Math.round(minutes / 1440)} দিন`;
    return diff >= 0 ? `${unit} পরে` : `${unit} আগে`;
  }

  /** Local YYYY-MM-DD for an <input type="date">. */
  const dateInput = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  /* --------------------------------------------------------- states --- */

  const loading = (message = 'লোড হচ্ছে…') => `<div class="load"><span class="dots"><span></span><span></span><span></span></span> ${esc(message)}</div>`;

  const empty = (title, hint = '', icon = '◦') =>
    `<div class="empty"><div class="ic">${icon}</div><b>${esc(title)}</b>${hint ? `<div>${esc(hint)}</div>` : ''}</div>`;

  const errorNote = (message) => `<div class="note danger"><b>কাজটি সম্পন্ন হয়নি</b>${esc(message)}</div>`;

  /* ------------------------------------------------------ auth gate --- */

  /**
   * Render a sign-in panel when the visitor has no account.
   * The four healthcare modules need a real account because the records
   * belong to a person; the rest of the app does not.
   */
  function gate(container, { title, hint, onSignedIn }) {
    container.innerHTML = `
      <div class="sheet">
        <div class="sheet-h"><b>${esc(title)}</b></div>
        <div class="sheet-b">
          <p class="mu" style="margin-top:0">${esc(hint)}</p>
          <form id="hgate" class="kv" style="gap:9px">
            <input id="gn" type="text" placeholder="আপনার নাম" autocomplete="name" required>
            <input id="ge" type="email" placeholder="ইমেইল" autocomplete="email" required>
            <input id="gp" type="password" placeholder="পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)" autocomplete="new-password" required>
            <div class="row" style="margin-top:4px">
              <button class="btn" type="submit" style="flex:1">অ্যাকাউন্ট খুলুন</button>
              <button class="btn o" type="button" id="glogin">লগইন</button>
            </div>
            <div id="gerr"></div>
          </form>
        </div>
      </div>`;

    const submit = async (event, mode) => {
      event?.preventDefault();
      const errorBox = $('#gerr');
      errorBox.innerHTML = '';
      const payload = {
        fullName: $('#gn').value.trim(),
        email: $('#ge').value.trim(),
        password: $('#gp').value,
      };
      try {
        if (mode === 'login') await api('POST', '/api/auth/login', { email: payload.email, password: payload.password });
        else await api('POST', '/api/auth/register', payload);
        meLoaded = false;
        await loadMe();
        toast(mode === 'login' ? 'লগইন হয়েছে' : 'অ্যাকাউন্ট তৈরি হয়েছে');
        onSignedIn();
      } catch (error) {
        errorBox.innerHTML = errorNote(error.message);
      }
    };

    $('#hgate').addEventListener('submit', (event) => submit(event, 'register'));
    $('#glogin').addEventListener('click', (event) => submit(event, 'login'));
  }

  /** Wait for the session to load before rendering the page. */
  async function ready(render) {
    await loadMe();
    await render();
  }

  return { $, $$, esc, api, loadMe, isSignedIn, bnDate, bnTime, bnDateTime, bnRelative, dateInput, loading, empty, errorNote, gate, ready, get me() { return me; } };
})();
