const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../auth');

const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer — memória (sharp processa antes de salvar)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato não suportado. Use JPG, PNG, WebP ou GIF.'));
  },
});

// ── Processar imagem com Sharp ───────────────────────────────────────────────
async function processImage(buffer, filename) {
  const baseName = path.parse(filename).name.replace(/[^a-z0-9_-]/gi, '_');
  const ts = Date.now();
  const outName = `${baseName}_${ts}.webp`;
  const thumbName = `${baseName}_${ts}_thumb.webp`;
  const outPath = path.join(UPLOADS_DIR, outName);
  const thumbPath = path.join(UPLOADS_DIR, thumbName);

  // Metadados originais
  const meta = await sharp(buffer).metadata();

  // Imagem principal — max 1400px, WebP 88%, sharpening + leve melhora de cor
  await sharp(buffer)
    .rotate()                               // corrige EXIF orientation
    .resize(1400, 1400, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .modulate({ saturation: 1.08, brightness: 1.02 })   // leve vivacidade
    .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.4 })          // nitidez sutil
    .webp({ quality: 88, effort: 5 })
    .toFile(outPath);

  // Thumbnail — 400px, WebP 80%
  await sharp(buffer)
    .rotate()
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toFile(thumbPath);

  const outStat = fs.statSync(outPath);
  const thumbStat = fs.statSync(thumbPath);

  return {
    filename: outName,
    thumb: thumbName,
    url: `/uploads/${outName}`,
    thumb_url: `/uploads/${thumbName}`,
    original_size: buffer.length,
    processed_size: outStat.size,
    thumb_size: thumbStat.size,
    compression: Math.round((1 - outStat.size / buffer.length) * 100),
    width: meta.width,
    height: meta.height,
    format: meta.format,
  };
}

// ── POST /admin/api/upload ────────────────────────────────────────────────────
router.post('/api/upload', requireAuth, upload.array('images', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
  }
  try {
    const results = await Promise.all(
      req.files.map(f => processImage(f.buffer, f.originalname))
    );
    res.json({ ok: true, images: results });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Erro ao processar imagem: ' + err.message });
  }
});

// ── GET /admin/api/images ─────────────────────────────────────────────────────
router.get('/api/images', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => f.endsWith('.webp') && !f.endsWith('_thumb.webp'))
      .map(f => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
        const thumbName = f.replace('.webp', '_thumb.webp');
        const thumbExists = fs.existsSync(path.join(UPLOADS_DIR, thumbName));
        return {
          filename: f,
          url: `/uploads/${f}`,
          thumb_url: thumbExists ? `/uploads/${thumbName}` : `/uploads/${f}`,
          size: stat.size,
          created_at: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.created_at - a.created_at);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/api/images/:filename ────────────────────────────────────────
router.delete('/api/images/:filename', requireAuth, (req, res) => {
  const { filename } = req.params;
  // Bloquear path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Filename inválido.' });
  }
  try {
    const filePath = path.join(UPLOADS_DIR, filename);
    const thumbPath = path.join(UPLOADS_DIR, filename.replace('.webp', '_thumb.webp'));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
