const express = require('express');
const router = express.Router();
const path = require('path');
const { getConfig, setConfigs, getOrders, getAnalytics } = require('../db');
const { checkPassword, generateToken, setPassword, requireAuth } = require('../auth');

// ─── Serve Admin UI ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../admin-ui/index.html'));
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password || !checkPassword(password)) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  res.json({ token: generateToken() });
});

// ─── Protected Routes ─────────────────────────────────────────────────────────
router.use('/api', requireAuth);

// GET full config
router.get('/api/config', (req, res) => {
  const cfg = getConfig();
  // Remove sensitive
  delete cfg.admin_password_hash;
  res.json(cfg);
});

// PUT config
router.put('/api/config', (req, res) => {
  const allowed = [
    'product_name','product_subtitle','product_description',
    'price','price_original','discount_percent',
    'hero_badge','cta_text','cta_sub',
    'feature_1_icon','feature_1_title','feature_1_desc',
    'feature_2_icon','feature_2_title','feature_2_desc',
    'feature_3_icon','feature_3_title','feature_3_desc',
    'feature_4_icon','feature_4_title','feature_4_desc',
    'guarantee_text','footer_text','whatsapp_number',
    'site_title','site_description',
    'og_title','og_description','og_image',
    'gtag_id','pixel_id',
    'mp_public_key',
  ];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  setConfigs(updates);
  res.json({ ok: true });
});

// Change password
router.put('/api/password', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Senha deve ter ao menos 8 caracteres' });
  setPassword(password);
  res.json({ ok: true });
});

// MP access token (sensitive — separate endpoint)
router.put('/api/mp-token', (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'access_token required' });
  const { setConfig } = require('../db');
  setConfig('mp_access_token', access_token);
  res.json({ ok: true });
});

// Orders
router.get('/api/orders', (req, res) => {
  const { limit = 50, offset = 0, status } = req.query;
  const orders = getOrders({ limit: parseInt(limit), offset: parseInt(offset), status });
  res.json(orders);
});

// Analytics
router.get('/api/analytics', (req, res) => {
  res.json(getAnalytics());
});

module.exports = router;
