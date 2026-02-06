const functions = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();

const COLLECTION = 'app_data';
const VAPID_PUBLIC = functions.config().webpush && functions.config().webpush.vapid_public ? functions.config().webpush.vapid_public : '';
const VAPID_PRIVATE = functions.config().webpush && functions.config().webpush.vapid_private ? functions.config().webpush.vapid_private : '';
const SUBJECT = functions.config().webpush && functions.config().webpush.subject ? functions.config().webpush.subject : 'mailto:admin@example.com';
const ADMIN_TOKEN = functions.config().webpush && functions.config().webpush.admin_token ? functions.config().webpush.admin_token : '';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function readKeyValueDoc(key) {
  const doc = await admin.firestore().collection(COLLECTION).doc(key).get();
  if (!doc.exists) return null;
  const data = doc.data();
  return data ? data.value : null;
}

async function readTodos(key) {
  const metaDoc = await admin.firestore().collection(COLLECTION).doc(key + '__meta').get();
  if (metaDoc.exists) {
    const meta = metaDoc.data() || {};
    const chunkCount = Number(meta.chunkCount) || 0;
    if (chunkCount > 0) {
      const all = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunkDoc = await admin.firestore().collection(COLLECTION).doc(`${key}__chunk_${i}`).get();
        if (chunkDoc.exists) {
          const v = chunkDoc.data() ? chunkDoc.data().value : null;
          if (Array.isArray(v)) all.push(...v);
        }
      }
      return all;
    }
  }
  const legacy = await readKeyValueDoc(key);
  return Array.isArray(legacy) ? legacy : [];
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseTimeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const parts = hhmm.split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function makeLogId(parts) {
  return parts.map((p) => String(p || '').replace(/[^a-zA-Z0-9_-]/g, '')).join('__');
}

async function hasLog(id) {
  const doc = await admin.firestore().collection('push_logs').doc(id).get();
  return doc.exists;
}

async function writeLog(id, payload) {
  await admin.firestore().collection('push_logs').doc(id).set({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function sendWebPush(subscription, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    throw new Error('Missing VAPID keys in functions config');
  }
  const sub = isPlainObject(subscription) ? subscription : null;
  if (!sub || !sub.endpoint) {
    throw new Error('Invalid subscription');
  }
  await webpush.sendNotification(sub, JSON.stringify(payload));
}

async function maybeClearSubscription(username) {
  await admin.firestore().collection(COLLECTION).doc(`${username}_pushSubscription`).set({
    value: null,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function notifyUser(username, title, body, url, logId, subscription) {
  if (await hasLog(logId)) return { sent: false, reason: 'already_sent' };
  try {
    await sendWebPush(subscription, {
      title,
      body,
      url,
      requireInteraction: true,
      vibrate: [200, 100, 200]
    });
    await writeLog(logId, { username, title, body, url });
    return { sent: true };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : '';
    if (msg.includes('410') || msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('invalid')) {
      await maybeClearSubscription(username);
    }
    await writeLog(logId, { username, title, body, url, error: msg });
    return { sent: false, reason: 'error', error: msg };
  }
}

exports.pushTest = functions.https.onRequest(async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      res.status(401).send('unauthorized');
      return;
    }
    const username = String(req.query.user || '');
    if (!username) {
      res.status(400).send('missing user');
      return;
    }
    const subscription = await readKeyValueDoc(`${username}_pushSubscription`);
    if (!subscription) {
      res.status(404).send('no subscription');
      return;
    }
    const title = String(req.query.title || 'ทดสอบแจ้งเตือน');
    const body = String(req.query.body || 'Push ใช้งานได้แล้ว');
    const url = String(req.query.url || './');
    const logId = makeLogId(['test', username, Date.now()]);
    const r = await notifyUser(username, title, body, url, logId, subscription);
    res.json({ ok: true, result: r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e && e.message ? String(e.message) : String(e) });
  }
});

exports.pushDueSoon = functions.pubsub.schedule('every 5 minutes').timeZone('Asia/Bangkok').onRun(async () => {
  const usersValue = await readKeyValueDoc('users');
  const users = Array.isArray(usersValue) ? usersValue : [];
  const now = new Date();
  const todayKey = toDateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const results = [];
  for (const u of users) {
    const username = u && u.username ? String(u.username) : '';
    if (!username || username === 'admin') continue;

    const subscription = await readKeyValueDoc(`${username}_pushSubscription`);
    if (!subscription) continue;

    const todos = await readTodos(`${username}_todos`);
    const dueToday = todos.filter((t) => t && !t.completed && t.dueDate === todayKey);
    for (const t of dueToday) {
      if (!t.notifyEnabled) continue;
      const timeStart = t.timeStart ? String(t.timeStart).slice(0, 5) : '';
      const startMin = parseTimeToMinutes(timeStart);
      if (startMin === null) continue;
      const minutesBefore = Math.max(0, Math.min(1440, Number(t.notifyMinutesBefore) || 0));
      const triggerMin = startMin - minutesBefore;
      if (triggerMin < 0) continue;
      const diff = triggerMin - nowMin;
      if (diff < 0 || diff > 5) continue;
      const title = 'ถึงเวลางานแล้ว';
      const body = `${timeStart} • ${t.text || 'งาน'}` + (minutesBefore ? ` (แจ้งก่อน ${minutesBefore} นาที)` : '');
      const logId = makeLogId(['dueSoon', username, String(t.id || ''), todayKey, timeStart, String(minutesBefore)]);
      const r = await notifyUser(username, title, body, './', logId, subscription);
      results.push({ username, id: t.id, sent: r.sent });
    }
  }
  return { ok: true, resultsCount: results.length };
});

exports.pushDailySummary = functions.pubsub.schedule('0 8 * * *').timeZone('Asia/Bangkok').onRun(async () => {
  const usersValue = await readKeyValueDoc('users');
  const users = Array.isArray(usersValue) ? usersValue : [];
  const now = new Date();
  const todayKey = toDateKey(now);

  const results = [];
  for (const u of users) {
    const username = u && u.username ? String(u.username) : '';
    if (!username || username === 'admin') continue;

    const subscription = await readKeyValueDoc(`${username}_pushSubscription`);
    if (!subscription) continue;

    const todos = await readTodos(`${username}_todos`);
    const dueToday = todos.filter((t) => t && !t.completed && t.dueDate === todayKey);
    if (dueToday.length === 0) continue;

    const logId = makeLogId(['daily', username, todayKey]);
    const title = 'สรุปงานวันนี้';
    const body = `คุณมีงานวันนี้ ${dueToday.length} งาน`;
    const r = await notifyUser(username, title, body, './', logId, subscription);
    results.push({ username, sent: r.sent });
  }
  return { ok: true, resultsCount: results.length };
});
