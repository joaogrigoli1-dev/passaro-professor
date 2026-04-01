const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'passaro.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS site_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mp_payment_id   TEXT,
    mp_preference_id TEXT,
    status          TEXT DEFAULT 'pending',
    customer_name   TEXT,
    customer_email  TEXT,
    customer_phone  TEXT,
    amount          REAL,
    product_title   TEXT,
    raw_data        TEXT,
    created_at      DATETIME DEFAULT (datetime('now')),
    updated_at      DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS page_views (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT,
    source       TEXT DEFAULT 'direct',
    utm_campaign TEXT,
    utm_medium   TEXT,
    utm_source   TEXT,
    created_at   DATETIME DEFAULT (datetime('now'))
  );
`);

// Default config seed
const defaults = {
  product_name:        'Pássaro Professor',
  product_subtitle:    'Edição Especial Pássaro Professor',
  product_description: 'Rádio exclusivo com design único da linha Pássaro Professor. Tecnologia de áudio premium, recepção AM/FM de alta fidelidade e visualização 360° interativa. Edição limitada colecionável.',
  price:               '349.99',
  price_original:      '897.41',
  discount_percent:    '61',
  hero_badge:          '🔥 Oferta por tempo limitado',
  cta_text:            'Comprar por R$349,99',
  cta_sub:             'Frete grátis · Pagamento seguro',
  feature_1_icon:      '📻',
  feature_1_title:     'Áudio de Alta Fidelidade',
  feature_1_desc:      'Drivers premium com resposta de frequência ampla para som cristalino em qualquer ambiente',
  feature_2_icon:      '📡',
  feature_2_title:     'Recepção AM/FM',
  feature_2_desc:      'Sintonização digital precisa com memória para suas estações favoritas',
  feature_3_icon:      '🔋',
  feature_3_title:     'Bateria 24h',
  feature_3_desc:      'Autonomia estendida para uso contínuo sem interrupções ao longo do dia',
  feature_4_icon:      '✨',
  feature_4_title:     'Design Exclusivo',
  feature_4_desc:      'Identidade visual Pássaro Professor com acabamento premium e cores vibrantes',
  guarantee_text:      '7 dias de garantia de satisfação ou seu dinheiro de volta',
  site_title:          'Pássaro Professor | Edição Especial 61% OFF',
  site_description:    'Rádio exclusivo Pássaro Professor com design colecionável, áudio de alta fidelidade e visualização 360° interativa. De R$897,41 por apenas R$349,99. Frete grátis.',
  og_title:            '61% OFF | Pássaro Professor',
  og_description:      'Edição especial com design exclusivo, áudio premium e visualização 360°. De R$897,41 por R$349,99.',
  og_image:            '',
  gtag_id:             '',
  pixel_id:            '',
  mp_public_key:       process.env.MP_PUBLIC_KEY || '',
  whatsapp_number:     '',
  footer_text:         '© 2025 Pássaro Professor · Todos os direitos reservados',
};

const insertConfig = db.prepare(
  `INSERT OR IGNORE INTO site_config (key, value) VALUES (?, ?)`
);

const seedTx = db.transaction(() => {
  for (const [k, v] of Object.entries(defaults)) {
    insertConfig.run(k, v);
  }

  // Admin password hash seed (only if not set)
  const existing = db.prepare(`SELECT value FROM site_config WHERE key='admin_password_hash'`).get();
  if (!existing) {
    const raw = process.env.ADMIN_PASSWORD || 'Passaro@2025';
    const hash = bcrypt.hashSync(raw, 10);
    db.prepare(`INSERT INTO site_config (key,value) VALUES ('admin_password_hash',?)`).run(hash);
  }
});
seedTx();

// Helpers
function getConfig() {
  const rows = db.prepare(`SELECT key, value FROM site_config`).all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function setConfig(key, value) {
  db.prepare(`INSERT INTO site_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`).run(key, String(value));
}

function setConfigs(obj) {
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) setConfig(k, v);
  });
  tx();
}

function getOrders({ limit = 50, offset = 0, status } = {}) {
  if (status) {
    return db.prepare(`SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(status, limit, offset);
  }
  return db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
}

function createOrder(data) {
  const stmt = db.prepare(`
    INSERT INTO orders (mp_preference_id, customer_name, customer_email, customer_phone, amount, product_title, raw_data)
    VALUES (@mp_preference_id, @customer_name, @customer_email, @customer_phone, @amount, @product_title, @raw_data)
  `);
  return stmt.run(data);
}

function updateOrder(mpPaymentId, status, rawData) {
  db.prepare(`UPDATE orders SET mp_payment_id=?, status=?, raw_data=?, updated_at=datetime('now') WHERE mp_preference_id=? OR mp_payment_id=?`)
    .run(mpPaymentId, status, JSON.stringify(rawData), mpPaymentId, mpPaymentId);
}

function trackView(source, utmCampaign, utmMedium, utmSource) {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`INSERT INTO page_views (date, source, utm_campaign, utm_medium, utm_source) VALUES (?,?,?,?,?)`)
    .run(today, source || 'direct', utmCampaign || null, utmMedium || null, utmSource || null);
}

function getAnalytics() {
  const totalViews = db.prepare(`SELECT COUNT(*) as count FROM page_views`).get();
  const today = new Date().toISOString().split('T')[0];
  const todayViews = db.prepare(`SELECT COUNT(*) as count FROM page_views WHERE date=?`).get(today);
  const last7 = db.prepare(`SELECT date, COUNT(*) as count FROM page_views WHERE date >= date('now','-6 days') GROUP BY date ORDER BY date`).all();
  const sources = db.prepare(`SELECT source, COUNT(*) as count FROM page_views GROUP BY source ORDER BY count DESC LIMIT 10`).all();
  const totalOrders = db.prepare(`SELECT COUNT(*) as count FROM orders`).get();
  const paidOrders = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status='approved'`).get();
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM orders WHERE status='approved'`).get();
  return { totalViews: totalViews.count, todayViews: todayViews.count, last7, sources, totalOrders: totalOrders.count, paidOrders: paidOrders.count, revenue: revenue.total };
}

module.exports = { db, getConfig, setConfig, setConfigs, getOrders, createOrder, updateOrder, trackView, getAnalytics };
