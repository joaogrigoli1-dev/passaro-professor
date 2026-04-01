const express = require('express');
const router = express.Router();
const path = require('path');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { getConfig, createOrder, updateOrder, trackView } = require('../db');
const crypto = require('crypto');

// ─── Public Config (for frontend) ────────────────────────────────────────────
router.get('/api/config', (req, res) => {
  const cfg = getConfig();
  // Only return safe/public keys
  const safe = {
    product_name:        cfg.product_name,
    product_subtitle:    cfg.product_subtitle,
    product_description: cfg.product_description,
    price:               cfg.price,
    price_original:      cfg.price_original,
    discount_percent:    cfg.discount_percent,
    hero_badge:          cfg.hero_badge,
    cta_text:            cfg.cta_text,
    cta_sub:             cfg.cta_sub,
    feature_1_icon:  cfg.feature_1_icon, feature_1_title: cfg.feature_1_title, feature_1_desc: cfg.feature_1_desc,
    feature_2_icon:  cfg.feature_2_icon, feature_2_title: cfg.feature_2_title, feature_2_desc: cfg.feature_2_desc,
    feature_3_icon:  cfg.feature_3_icon, feature_3_title: cfg.feature_3_title, feature_3_desc: cfg.feature_3_desc,
    feature_4_icon:  cfg.feature_4_icon, feature_4_title: cfg.feature_4_title, feature_4_desc: cfg.feature_4_desc,
    guarantee_text:  cfg.guarantee_text,
    mp_public_key:   cfg.mp_public_key || process.env.MP_PUBLIC_KEY || '',
    whatsapp_number: cfg.whatsapp_number,
    footer_text:     cfg.footer_text,
    gtag_id:         cfg.gtag_id,
    pixel_id:        cfg.pixel_id,
  };
  res.json(safe);
});

// ─── Track Page View ─────────────────────────────────────────────────────────
router.post('/api/track', (req, res) => {
  const { source, utm_campaign, utm_medium, utm_source } = req.body;
  trackView(source, utm_campaign, utm_medium, utm_source);
  res.json({ ok: true });
});

// ─── Create MP Preference ─────────────────────────────────────────────────────
router.post('/api/checkout/create', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });

    const cfg = getConfig();
    const accessToken = process.env.MP_ACCESS_TOKEN || cfg.mp_access_token;
    if (!accessToken) return res.status(500).json({ error: 'Pagamento não configurado ainda' });

    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);
    const baseUrl = process.env.BASE_URL || 'https://passaroprofessor.com.br';
    const price = parseFloat(cfg.price || '349.99');

    const result = await preference.create({
      body: {
        items: [{
          id:          'radio-a1088',
          title:       cfg.product_name || 'Rádio A-1088',
          description: cfg.product_subtitle || 'Pássaro Professor',
          quantity:    1,
          unit_price:  price,
          currency_id: 'BRL',
        }],
        payer: { name, email, phone: { number: phone } },
        back_urls: {
          success: `${baseUrl}/checkout/success`,
          failure: `${baseUrl}/checkout/failure`,
          pending: `${baseUrl}/checkout/pending`,
        },
        auto_return: 'approved',
        notification_url: `${baseUrl}/api/checkout/webhook`,
        statement_descriptor: 'PASSARO PROFESSOR',
        external_reference: `order_${Date.now()}`,
      }
    });

    // Save pending order
    createOrder({
      mp_preference_id: result.id,
      customer_name:    name,
      customer_email:   email,
      customer_phone:   phone || '',
      amount:           price,
      product_title:    cfg.product_name || 'Rádio A-1088',
      raw_data:         JSON.stringify(result),
    });

    res.json({
      preference_id: result.id,
      init_point:    result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (err) {
    console.error('[checkout/create]', err);
    res.status(500).json({ error: 'Erro ao criar preferência de pagamento' });
  }
});

// ─── MP Webhook ───────────────────────────────────────────────────────────────
router.post('/api/checkout/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const { type, data } = req.body.toString ? JSON.parse(req.body.toString()) : req.body;

    if (type === 'payment' && data?.id) {
      const cfg = getConfig();
      const accessToken = process.env.MP_ACCESS_TOKEN || cfg.mp_access_token;
      const client = new MercadoPagoConfig({ accessToken });
      const paymentApi = new Payment(client);
      const payment = await paymentApi.get({ id: data.id });

      updateOrder(String(data.id), payment.status, payment);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook]', err);
    res.sendStatus(200); // always 200 to MP
  }
});

// ─── Checkout Result Pages ────────────────────────────────────────────────────
router.get('/checkout/success', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/checkout-success.html'));
});
router.get('/checkout/failure', (req, res) => {
  res.redirect('/?checkout=failure');
});
router.get('/checkout/pending', (req, res) => {
  res.redirect('/?checkout=pending');
});

module.exports = router;
