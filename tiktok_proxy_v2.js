// ╔══════════════════════════════════════════════════════════════╗
// ║   TikTok Engagement Proxy Backend — v2.0                    ║
// ║   Multi-account bulk engine. Pure Node.js stdlib.           ║
// ║   Run: node tiktok_proxy_v2.js                              ║
// ║   Proxy listens: http://localhost:3000                       ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';
const http  = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;

// ── Cookie header builder ──────────────────────────────────────
function cookieStr(c) {
  return Object.entries(c).map(([k,v]) => `${k}=${v}`).join('; ');
}

// ── TikTok request headers ─────────────────────────────────────
function ttHdr(c, referer = 'https://www.tiktok.com/') {
  return {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'cookie': cookieStr(c),
    'origin': 'https://www.tiktok.com',
    'referer': referer,
    'sec-ch-ua': '"Google Chrome";v="124","Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'x-tt-params': '',
    'x-secsdk-csrf-token': c.csrf_session_id || c['csrf-session-id'] || '',
    'tt-anti-crack-token': c.tt_chain_token || '',
  };
}

// ── HTTPS helper ───────────────────────────────────────────────
function req(opts, body = '') {
  return new Promise((res, rej) => {
    const r = https.request(opts, resp => {
      let buf = '';
      resp.on('data', c => buf += c);
      resp.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(buf); } catch {}
        res({ st: resp.statusCode, b: parsed, raw: buf });
      });
    });
    r.on('error', rej);
    r.setTimeout(12000, () => { r.destroy(); rej(new Error('timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

// ── Extract IDs ────────────────────────────────────────────────
function vidId(url) { const m = (url||'').match(/\/video\/(\d+)/); return m?m[1]:null; }
function uname(url) { const m = (url||'').match(/@([\w.]+)/); return m?m[1]:null; }

// ── Common TikTok query params ─────────────────────────────────
function baseParams(c) {
  return new URLSearchParams({
    device_platform: 'web_pc',
    aid: '1988',
    channel: 'tiktok_web',
    update_version_code: '170400',
    pc_client_type: '1',
    version_code: '290100',
    version_name: '29.1.0',
    cookie_enabled: '1',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'en-US',
    browser_platform: 'Win32',
    browser_name: 'Mozilla',
    browser_version: '5.0',
    browser_online: '1',
    engine_name: 'Blink',
    engine_version: '124.0.0.0',
    os_name: 'Windows',
    os_version: '10',
    cpu_core_num: '16',
    device_memory: '8',
    platform: 'PC',
    downlink: '10',
    effective_type: '4g',
    round_trip_time: '50',
    webid: c.uid_tt || '',
    msToken: c.msToken || '',
  });
}

// ═══════════════ ACTION HANDLERS ══════════════════════════════

// ── VERIFY SESSION ─────────────────────────────────────────────
async function verifySession(c) {
  try {
    const p = baseParams(c);
    p.set('uniqueId', 'self');
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/recommend/itemList/`,
      method: 'GET',
      headers: ttHdr(c),
    });
    // any non-401/403 means cookie is alive
    if (r.st < 400) return { success: true, username: 'verified_' + (c.uid_tt||'').slice(0,6), uid: c.uid_tt||'' };
    // try self-info endpoint
    const r2 = await req({
      hostname: 'www.tiktok.com',
      path: `/api/user/self/?${baseParams(c)}`,
      method: 'GET',
      headers: ttHdr(c),
    });
    if (r2.b && (r2.b.user||r2.b.userInfo)) {
      const u = (r2.b.user||r2.b.userInfo||{});
      return { success: true, username: u.uniqueId||u.nickname||'user', uid: u.uid||c.uid_tt||'' };
    }
    if (r2.st < 400) return { success: true, username: 'user', uid: c.uid_tt||'' };
    return { success: false, message: `HTTP ${r.st}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── LIKE ──────────────────────────────────────────────────────
async function like(c, videoId) {
  try {
    const p = baseParams(c);
    p.set('aweme_id', videoId);
    p.set('type', '1');
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/commit/item/digg/?${p}`,
      method: 'POST',
      headers: ttHdr(c, `https://www.tiktok.com/@user/video/${videoId}`),
    }, '');
    if (r.b.status_code === 0) return { success: true, message: `Liked (digg_count: ${r.b.digg_count||'+'})` };
    if (r.b.status_code === 11) return { success: false, message: 'Already liked' };
    return { success: false, message: r.b.status_msg || `code ${r.b.status_code}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── VIEW ──────────────────────────────────────────────────────
async function view(c, videoId) {
  try {
    const p = baseParams(c);
    p.set('item_id', videoId);
    p.set('play_percent', '100');
    p.set('enter_from', 'main_page');
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/aweme/v1/web/log/`,
      method: 'POST',
      headers: ttHdr(c, `https://www.tiktok.com/@user/video/${videoId}`),
    }, p.toString());
    if (r.st < 400) return { success: true, message: 'View logged' };
    return { success: false, message: `HTTP ${r.st}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── FOLLOW ────────────────────────────────────────────────────
async function follow(c, targetUser) {
  try {
    // First resolve user_id from username
    let userId = targetUser;
    if (isNaN(targetUser)) {
      const lookupP = baseParams(c);
      lookupP.set('uniqueId', targetUser);
      const lr = await req({
        hostname: 'www.tiktok.com',
        path: `/api/user/detail/?${lookupP}`,
        method: 'GET',
        headers: ttHdr(c),
      });
      userId = (lr.b.userInfo||{}).user?.uid || targetUser;
    }
    const p = baseParams(c);
    p.set('user_id', userId);
    p.set('type', '1');
    p.set('from', '0');
    p.set('from_pre', '-1');
    p.set('channel_id', '0');
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/commit/follow/user/?${p}`,
      method: 'POST',
      headers: ttHdr(c, `https://www.tiktok.com/@${targetUser}`),
    }, '');
    if (r.b.status_code === 0) return { success: true, message: `Followed @${targetUser}` };
    if (r.b.status_code === 5) return { success: false, message: 'Already following' };
    return { success: false, message: r.b.status_msg || `code ${r.b.status_code}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── COMMENT ───────────────────────────────────────────────────
async function comment(c, videoId, text) {
  try {
    const p = baseParams(c);
    const body = new URLSearchParams({
      ...Object.fromEntries(p),
      aweme_id: videoId,
      text: text,
      text_extra: '[]',
      is_self_see: '0',
      with_distributed_lock: '1',
      channel_id: '1',
    });
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/comment/publish/`,
      method: 'POST',
      headers: ttHdr(c, `https://www.tiktok.com/@user/video/${videoId}`),
    }, body.toString());
    if (r.b.status_code === 0) return { success: true, message: `Commented: "${text.slice(0,20)}"` };
    return { success: false, message: r.b.status_msg || `code ${r.b.status_code}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── FAVORITE ──────────────────────────────────────────────────
async function favorite(c, videoId) {
  try {
    const p = baseParams(c);
    p.set('aweme_id', videoId);
    p.set('type', '1');
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/commit/item/collect/?${p}`,
      method: 'POST',
      headers: ttHdr(c, `https://www.tiktok.com/@user/video/${videoId}`),
    }, '');
    if (r.b.status_code === 0) return { success: true, message: 'Favorited' };
    return { success: false, message: r.b.status_msg || `code ${r.b.status_code}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── REPOST ────────────────────────────────────────────────────
async function repost(c, videoId) {
  try {
    const p = baseParams(c);
    p.set('item_id', videoId);
    p.set('repost_type', '1');
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/repost/item_repost/?${p}`,
      method: 'POST',
      headers: ttHdr(c, `https://www.tiktok.com/@user/video/${videoId}`),
    }, '');
    if (r.b.status_code === 0) return { success: true, message: 'Reposted' };
    return { success: false, message: r.b.status_msg || `code ${r.b.status_code}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── COMMENT LIKE ──────────────────────────────────────────────
async function commentLike(c, videoId) {
  try {
    // Fetch top comment first
    const lp = baseParams(c);
    lp.set('aweme_id', videoId);
    lp.set('count', '5');
    lp.set('cursor', '0');
    const lr = await req({
      hostname: 'www.tiktok.com',
      path: `/api/comment/list/?${lp}`,
      method: 'GET',
      headers: ttHdr(c),
    });
    const comments = (lr.b.comments||lr.b.comment_list||[]);
    if (!comments.length) return { success: false, message: 'No comments to like' };
    const cid = comments[0].cid || comments[0].comment_id || comments[0].id;
    const p = baseParams(c);
    p.set('aweme_id', videoId);
    p.set('comment_id', cid);
    p.set('action', '1');
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/comment/digg/?${p}`,
      method: 'POST',
      headers: ttHdr(c),
    }, '');
    if (r.b.status_code === 0) return { success: true, message: `Liked comment ${cid}` };
    return { success: false, message: r.b.status_msg || `code ${r.b.status_code}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ── REPORT ────────────────────────────────────────────────────
async function report(c, videoId) {
  try {
    const p = baseParams(c);
    const body = new URLSearchParams({
      ...Object.fromEntries(p),
      object_id: videoId,
      report_type: 'video',
      reason: '1',
    });
    const r = await req({
      hostname: 'www.tiktok.com',
      path: `/api/vc/feed/v1/report/`,
      method: 'POST',
      headers: ttHdr(c),
    }, body.toString());
    if (r.b.status_code === 0 || r.st < 400) return { success: true, message: 'Reported' };
    return { success: false, message: r.b.status_msg || `HTTP ${r.st}` };
  } catch(e) { return { success: false, message: e.message }; }
}

// ═══════════════ HTTP SERVER ══════════════════════════════════
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const send = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // ── GET /ping ──────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/ping') {
    return send({ ok: true, ts: Date.now(), version: '2.0' });
  }

  if (req.method !== 'POST') return send({ error: 'Method not allowed' }, 405);

  // Read body
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    let pl;
    try { pl = JSON.parse(body); } catch { return send({ error: 'Invalid JSON' }, 400); }

    const { cookies, action, videoUrl, targetUser, comment: commentText } = pl;
    if (!cookies) return send({ success: false, message: 'Missing cookies' });

    const vid = vidId(videoUrl || '');

    try {
      // ── POST /verify ─────────────────────────────────────
      if (req.url === '/verify') return send(await verifySession(cookies));

      // ── POST /action ─────────────────────────────────────
      if (req.url === '/action') {
        let result;
        switch (action) {
          case 'like':       result = await like(cookies, vid||''); break;
          case 'view':       result = await view(cookies, vid||''); break;
          case 'follow':     result = await follow(cookies, (targetUser||'').replace('@','')); break;
          case 'comment':    result = await comment(cookies, vid||'', commentText||'Great video! 🔥'); break;
          case 'favorite':   result = await favorite(cookies, vid||''); break;
          case 'repost':     result = await repost(cookies, vid||''); break;
          case 'commentlike':result = await commentLike(cookies, vid||''); break;
          case 'report':     result = await report(cookies, vid||''); break;
          default: result = { success: false, message: `Unknown action: ${action}` };
        }
        return send(result);
      }

      send({ error: 'Not found' }, 404);
    } catch(e) {
      console.error('[ERROR]', e.message);
      send({ success: false, message: e.message });
    }
  });
});

server.listen(PORT, () => {
  const d = new Date().toLocaleTimeString();
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  TikTok Proxy Backend v2.0  — ${d}  ║`);
  console.log(`║  Listening: http://localhost:${PORT}           ║`);
  console.log(`║  Routes: /ping  /verify  /action          ║`);
  console.log(`║  Actions: like follow view comment        ║`);
  console.log(`║           favorite repost commentlike     ║`);
  console.log(`║           report                          ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} already in use — kill the old process first.`);
  else console.error('Server error:', e.message);
});
