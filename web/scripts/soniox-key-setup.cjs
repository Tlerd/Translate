/* Local-only, user-operated key entry. Never contacts Soniox or prints credentials. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const envPath = path.resolve(__dirname, '..', '.env.local');
const nonce = randomBytes(24).toString('hex');
let saved = false;
let origin;
const page = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cấu hình Soniox trên máy</title>
<style nonce="${nonce}">body{font:16px system-ui;background:#101827;color:#edf2fa;padding:24px}main{max-width:580px;margin:8vh auto;background:#1b293d;padding:28px;border-radius:16px}label{display:block;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:8px;border:1px solid #617085;font:inherit}button{margin-top:16px;background:#7dd3fc;cursor:pointer}p{line-height:1.6}#status{white-space:pre-wrap}</style>
<main><h1>Cấu hình Soniox</h1><p>Dán API key bạn vừa tạo. Key chỉ được lưu trong <code>web/.env.local</code> trên máy này; trang không gọi Soniox và không chạy nhận giọng.</p>
<form id="form"><label for="key">Soniox API key</label><input id="key" name="key" type="password" autocomplete="off" spellcheck="false" required><button id="save" type="submit">Lưu key</button></form><p id="status" role="status"></p></main>
<script nonce="${nonce}">const form=document.getElementById('form');form.addEventListener('submit',async event=>{event.preventDefault();const input=document.getElementById('key'),button=document.getElementById('save'),status=document.getElementById('status');button.disabled=true;try{const response=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':'${nonce}'},body:JSON.stringify({key:input.value.trim()})});const result=await response.json();if(!response.ok)throw new Error(result.message);input.value='';status.textContent='Đã lưu SONIOX_API_KEY trên máy. Bạn có thể quay lại chat; không cần gửi key.';form.hidden=true;}catch(error){status.textContent=error.message;button.disabled=false;}});</script></html>`;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'`);
  if (req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end(); return; }
  if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return; }
  if (req.method === 'GET' && req.url === '/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ saved })); return; }
  if (req.method !== 'POST' || req.url !== '/save' || req.headers.origin !== origin || req.headers['x-setup-token'] !== nonce || saved) { res.writeHead(403); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error('Key vượt giới hạn nhập.'); chunks.push(chunk); }
    const { key } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof key !== 'string' || key.length < 16 || key.length > 2000 || !/^[A-Za-z0-9._+-/=]+$/.test(key)) throw new Error('Key chưa hợp lệ. Hãy dán lại nguyên key từ Soniox Console.');
    let previous = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    let replaced = false;
    previous = previous.replace(/^(?:export\s+)?SONIOX_API_KEY\s*=.*(?:\r?\n|$)/gm, () => {
      if (replaced) return '';
      replaced = true;
      return 'SONIOX_API_KEY=' + key + '\n';
    });
    if (!replaced) previous += (previous && !previous.endsWith('\n') ? '\n' : '') + 'SONIOX_API_KEY=' + key + '\n';
    fs.writeFileSync(envPath, previous, { mode: 0o600 });
    saved = true;
    res.end(JSON.stringify({ saved: true }));
    console.log('SONIOX_API_KEY saved locally (value hidden).');
  } catch {
    res.writeHead(400); res.end(JSON.stringify({ message: 'Không lưu được key. Kiểm tra key đã dán và quyền ghi web/.env.local.' }));
  }
});
server.listen(0, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('Soniox local key entry: ' + origin);
});
server.requestTimeout = 10_000;
setTimeout(() => { server.close(); server.closeAllConnections(); }, 30 * 60_000).unref();
