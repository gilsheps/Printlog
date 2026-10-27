// Google Drive archive: OAuth (loopback + PKCE) and file upload/download with the Drive v3 API.
// Scope 'drive.file' = the app only sees files it created itself.
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const TB = process.env.PRINTLOG_GOOGLE_TEST_BASE; // tests only: point everything at a mock server
const AUTH = TB ? TB + '/auth' : 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = TB ? TB + '/token' : 'https://oauth2.googleapis.com/token';
const API = TB ? TB + '/drive/v3' : 'https://www.googleapis.com/drive/v3';
const UPLOAD = TB ? TB + '/upload/drive/v3' : 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'PrintLog Archive';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const NO_SCOPE_MSG = 'Google לא נתנו ל-PrintLog הרשאה לקבצים ב-Drive. בחלון ההתחברות של Google צריך לסמן את התיבה של Google Drive ("לראות, לערוך, ליצור ולמחוק רק את הקבצים הספציפיים…"). התחבר שוב בהגדרות וסמן אותה.';

function loadClient(dir) {
  // from the build (GitHub secret) or a local oauth.json next to the app
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'oauth.json'), 'utf8')); if (j.client_id) return j; } catch { }
  if (process.env.PRINTLOG_GOOGLE_CLIENT_ID) return { client_id: process.env.PRINTLOG_GOOGLE_CLIENT_ID, client_secret: process.env.PRINTLOG_GOOGLE_CLIENT_SECRET || '' };
  return null;
}

class GDrive {
  constructor({ appDir, getAuth, setAuth, openExternal, log }) {
    Object.assign(this, { getAuth, setAuth, openExternal, log: log || console.log });
    this.client = loadClient(appDir);
    this.access = null; // { token, exp }
  }
  available() { return !!this.client; }
  connected() { const a = this.getAuth(); return !!(a && a.refresh); }

  /* ---------- sign-in ---------- */
  async connect() {
    if (!this.client) throw new Error('missing-client');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    const { code, redirect } = await new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html dir="rtl" lang="he"><body style="font-family:system-ui;text-align:center;padding:60px">${ok ? '<h2>PrintLog מחובר ל-Google Drive ✓</h2><p>אפשר לסגור את החלון ולחזור לאפליקציה.</p>' : '<h2>ההתחברות בוטלה</h2>'}</body></html>`);
        clearTimeout(timer);
        srv.close();
        if (ok) resolve({ code: u.searchParams.get('code'), redirect: `http://127.0.0.1:${srv.address() ? srv.address().port : port}` });
        else reject(new Error(u.searchParams.get('error') || 'cancelled'));
      });
      let port = 0;
      const timer = setTimeout(() => { srv.close(); reject(new Error('timeout')); }, 5 * 60 * 1000);
      srv.listen(0, '127.0.0.1', () => {
        port = srv.address().port;
        const q = new URLSearchParams({
          client_id: this.client.client_id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPE,
          code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
        });
        this.openExternal(`${AUTH}?${q}`);
      });
    });
    const tok = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
    if (!tok.refresh_token) throw new Error('Google לא החזירו אישור קבוע. נסה שוב.');
    // Google lets the user untick individual permissions on the consent screen
    if (tok.scope && !tok.scope.split(' ').includes(DRIVE_SCOPE)) {
      fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tok.refresh_token), { method: 'POST' }).catch(() => {});
      throw new Error(NO_SCOPE_MSG);
    }
    let email = '';
    try { email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()).email || ''; } catch { }
    this.access = { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 };
    this.setAuth({ refresh: tok.refresh_token, email, folderId: '' });
    return { email };
  }
  disconnect() {
    const a = this.getAuth();
    if (a && a.refresh) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(a.refresh), { method: 'POST' }).catch(() => {});
    this.access = null;
    this.setAuth(null);
  }
  async tokenRequest(params) {
    const body = new URLSearchParams({ client_id: this.client.client_id, ...(this.client.client_secret ? { client_secret: this.client.client_secret } : {}), ...params });
    const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant') { this.setAuth(null); throw new Error('החיבור ל-Google Drive פג. צריך להתחבר מחדש בהגדרות.'); }
      throw new Error(`Google: ${j.error_description || j.error || r.status}`);
    }
    return j;
  }
  async token() {
    if (this.access && Date.now() < this.access.exp) return this.access.token;
    const a = this.getAuth();
    if (!a || !a.refresh) throw new Error('לא מחובר ל-Google Drive');
    const j = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh });
    this.access = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
    return this.access.token;
  }
  async api(method, url, { json, headers = {}, body, raw } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = await this.token();
      const r = await fetch(url, { method, headers: { Authorization: `Bearer ${t}`, ...(json ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}), ...headers }, body: json ? JSON.stringify(json) : body, signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (r.status === 401 && attempt === 0) { this.access = null; continue; }
      if (r.status === 403) {
        const txt = await r.text();
        if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(txt)) { this.access = null; this.setAuth(null); throw new Error(NO_SCOPE_MSG); }
        throw new Error(`Google Drive: 403 ${txt.slice(0, 200)}`);
      }
      if ((r.status === 429 || r.status >= 500) && attempt < 2) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
      if (!r.ok) throw new Error(`Google Drive: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return raw ? r : r.status === 204 ? null : r.json();
    }
  }

  /* ---------- files ---------- */
  async folder() {
    const a = this.getAuth();
    if (a.folderId) {
      try { const f = await this.api('GET', `${API}/files/${a.folderId}?fields=id,trashed`); if (!f.trashed) return a.folderId; } catch { }
    }
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await this.api('GET', `${API}/files?q=${q}&fields=files(id)&spaces=drive`);
    const id = found.files && found.files[0] ? found.files[0].id : (await this.api('POST', `${API}/files?fields=id`, { json: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' } })).id;
    this.setAuth({ ...a, folderId: id });
    return id;
  }
  // upload a local file, verify it arrived intact, return its Drive id
  async upload(localPath, rel) {
    const folderId = await this.folder();
    const stat = fs.statSync(localPath);
    const md5 = await new Promise((res, rej) => { const h = crypto.createHash('md5'); fs.createReadStream(localPath).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
    const init = await this.api('POST', `${UPLOAD}/files?uploadType=resumable&fields=id`, {
      json: { name: path.basename(localPath), parents: [folderId], appProperties: { printlogPath: rel.slice(0, 120) }, modifiedTime: stat.mtime.toISOString() },
      headers: { 'X-Upload-Content-Length': String(stat.size), 'X-Upload-Content-Type': 'application/octet-stream' }, raw: true,
    });
    const session = init.headers.get('location');
    const r = await fetch(session, { method: 'PUT', headers: { 'Content-Length': String(stat.size), 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(localPath), signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!r.ok) throw new Error(`ההעלאה נכשלה (${r.status})`);
    const { id } = await r.json();
    const meta = await this.api('GET', `${API}/files/${id}?fields=id,size,md5Checksum`);
    if (+meta.size !== stat.size || (meta.md5Checksum && meta.md5Checksum !== md5)) {
      await this.api('DELETE', `${API}/files/${id}`).catch(() => {});
      throw new Error('הקובץ שהועלה לא זהה למקור, לא נמחק כלום');
    }
    return { id, size: stat.size, mtime: Math.round(stat.mtimeMs) };
  }
  async download(id, dest) {
    const r = await this.api('GET', `${API}/files/${id}?alt=media`, { raw: true });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest + '.part', buf);
    fs.renameSync(dest + '.part', dest);
    return buf;
  }
  async remove(id) { await this.api('DELETE', `${API}/files/${id}`); }
}

module.exports = { GDrive };
