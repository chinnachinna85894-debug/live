'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const { ExpressPeerServer } = require('peer');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const USE_HTTPS = process.env.HTTPS === 'true';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

const ROOT = __dirname;
const CERT_DIR = path.join(ROOT, 'certs');
const PEER_PATH = '/peerjs';

const app = express();
app.disable('x-powered-by');

/* ------------------------------------------------------------------
   Pages — served explicitly. Nothing else in this folder is exposed.
   ------------------------------------------------------------------ */

// Optional admin gate (set ADMIN_TOKEN env var to enable)
function requireAdminToken(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const t = req.query.token || req.headers['x-admin-token'];
  if (t !== ADMIN_TOKEN) return res.status(401).send('Unauthorized');
  next();
}

app.get('/', (_req, res) => res.redirect('/viewer'));

app.get('/admin', requireAdminToken, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'admin.html'));
});

app.get('/viewer', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'viewer.html'));
});

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/* ------------------------------------------------------------------
   HTTP / HTTPS
   ------------------------------------------------------------------ */
let server;

if (USE_HTTPS) {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('HTTPS certificate files missing in ./certs/');
    console.error('Expected:', keyPath, 'and', certPath);
    process.exit(1);
  }

  server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }, app);
} else {
  server = http.createServer(app);
}

/* ------------------------------------------------------------------
   PeerJS signaling server
   ------------------------------------------------------------------ */
const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,
  allow_discovery: false,
  alive_timeout: 60000,
  key: 'peerjs',
  debug: true,
});

app.use(PEER_PATH, peerServer);

peerServer.on('connection', (client) => {
  const id = client.getId();
  console.log(`[peer] connected: ${id}`);
  if (id === 'livestream-public-single-channel-v1') {
    console.log('[peer] ⚠  broadcast channel opened');
  }
});

peerServer.on('disconnect', (client) => {
  console.log(`[peer] disconnected: ${client.getId()}`);
});

/* ------------------------------------------------------------------
   Start
   ------------------------------------------------------------------ */
server.listen(PORT, HOST, () => {
  const proto = USE_HTTPS ? 'https' : 'http';
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;

  console.log('');
  console.log(`  Admin  → ${proto}://${shown}:${PORT}/admin` +
              (ADMIN_TOKEN ? '?token=<ADMIN_TOKEN>' : ''));
  console.log(`  Viewer → ${proto}://${shown}:${PORT}/viewer`);
  console.log(`  PeerJS → ${proto}://${shown}:${PORT}${PEER_PATH}`);
  console.log(`  Health → ${proto}://${shown}:${PORT}/healthz`);
  console.log(`  Bound  → ${HOST}:${PORT}`);
  console.log('');
});

/* ------------------------------------------------------------------
   Graceful shutdown
   ------------------------------------------------------------------ */
function shutdown(sig) {
  console.log(`[server] ${sig} — shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));