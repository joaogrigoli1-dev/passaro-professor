const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { requireAuth } = require('../auth');

// ── Helpers ──────────────────────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── PageSpeed Insights (gratuito, sem chave) ─────────────────────────────────
async function runPageSpeed(siteUrl) {
  const encoded = encodeURIComponent(siteUrl);
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encoded}&strategy=mobile&category=performance&category=seo&category=accessibility&category=best-practices`;
  try {
    const res = await fetchUrl(apiUrl);
    const data = JSON.parse(res.body);
    const cats = data.lighthouseResult?.categories || {};
    const audits = data.lighthouseResult?.audits || {};
    return {
      scores: {
        performance: Math.round((cats.performance?.score || 0) * 100),
        seo: Math.round((cats.seo?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        best_practices: Math.round((cats['best-practices']?.score || 0) * 100),
      },
      metrics: {
        fcp: audits['first-contentful-paint']?.displayValue || '—',
        lcp: audits['largest-contentful-paint']?.displayValue || '—',
        tbt: audits['total-blocking-time']?.displayValue || '—',
        cls: audits['cumulative-layout-shift']?.displayValue || '—',
        speed_index: audits['speed-index']?.displayValue || '—',
        tti: audits['interactive']?.displayValue || '—',
      },
      opportunities: Object.values(audits)
        .filter(a => a.score !== null && a.score < 0.9 && a.details?.type === 'opportunity')
        .slice(0, 5)
        .map(a => ({ title: a.title, description: a.description, savings: a.details?.overallSavingsMs })),
      seo_audits: Object.values(audits)
        .filter(a => a.score !== null && a.score < 1 && ['document-title','meta-description','link-text','crawlable-anchors','robots-txt','hreflang','canonical'].includes(a.id))
        .map(a => ({ id: a.id, title: a.title, score: a.score, description: a.description })),
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ── SEO Scrape — lê HTML do site e extrai dados ──────────────────────────────
async function scrapeSEO(siteUrl) {
  try {
    const res = await fetchUrl(siteUrl);
    const html = res.body;

    const get = (pattern, flags = 'i') => {
      const m = html.match(new RegExp(pattern, flags));
      return m ? m[1]?.trim() : null;
    };
    const getAll = (pattern, flags = 'gi') => {
      const matches = [];
      let m;
      const re = new RegExp(pattern, flags);
      while ((m = re.exec(html)) !== null) matches.push(m[1]?.trim());
      return matches.filter(Boolean);
    };

    const title = get('<title[^>]*>([^<]+)<\\/title>');
    const metaDesc = get('<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']');
    const metaDescAlt = get('<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']');
    const h1s = getAll('<h1[^>]*>([^<]+)<\\/h1>');
    const h2s = getAll('<h2[^>]*>([^<]+)<\\/h2>');
    const imgs = html.match(/<img[^>]+>/gi) || [];
    const imgsNoAlt = imgs.filter(i => !i.includes('alt=') || i.match(/alt=["\s]*["\s]/));
    const canonical = get('<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)["\']');
    const ogTitle = get('<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']');
    const ogDesc = get('<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']');
    const ogImage = get('<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']');
    const schemaOrg = html.includes('application/ld+json');
    const robotsMeta = get('<meta[^>]+name=["\']robots["\'][^>]+content=["\']([^"\']+)["\']');
    const viewport = get('<meta[^>]+name=["\']viewport["\'][^>]+content=["\']([^"\']+)["\']');
    const lang = get('<html[^>]+lang=["\']([^"\']+)["\']');
    const wordCount = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(' ').filter(w => w.length > 3).length;

    return {
      title, title_len: title?.length || 0,
      meta_description: metaDesc || metaDescAlt, meta_description_len: (metaDesc || metaDescAlt)?.length || 0,
      h1s, h2s: h2s.slice(0, 6),
      images_total: imgs.length, images_no_alt: imgsNoAlt.length,
      canonical, og_title: ogTitle, og_description: ogDesc, og_image: ogImage,
      schema_org: schemaOrg, robots_meta: robotsMeta,
      viewport: !!viewport, lang,
      word_count: wordCount,
      html_size_kb: Math.round(html.length / 1024),
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Análise IA com Claude API ────────────────────────────────────────────────
async function analyzeWithAI(seoData, pageSpeedData, siteUrl) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return { error: 'CLAUDE_API_KEY não configurada' };

  const prompt = `Você é um especialista em SEO, marketing digital e performance web. Analise os dados abaixo do site ${siteUrl} e gere um relatório profissional em português brasileiro.

## Dados SEO do site
${JSON.stringify(seoData, null, 2)}

## Dados Google PageSpeed (mobile)
${JSON.stringify(pageSpeedData, null, 2)}

## Instruções para o relatório
Gere um relatório JSON com EXATAMENTE esta estrutura:
{
  "resumo": "Parágrafo de 2-3 linhas resumindo o estado geral do site",
  "nota_geral": número de 0 a 10,
  "pontos_fortes": ["lista de até 4 pontos positivos identificados"],
  "problemas_criticos": [
    {"titulo": "...", "impacto": "alto|medio|baixo", "solucao": "..."}
  ],
  "seo_tecnico": [
    {"item": "...", "status": "ok|atencao|critico", "detalhe": "..."}
  ],
  "marketing_digital": [
    {"acao": "...", "prioridade": "alta|media|baixa", "descricao": "..."}
  ],
  "ranking_buscadores": [
    {"sugestao": "...", "impacto_esperado": "..."}
  ],
  "proximos_passos": ["lista de 5 ações concretas em ordem de prioridade"]
}

Responda APENAS com o JSON, sem markdown, sem explicações fora do JSON.`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve({ error: 'Resposta IA inválida', raw: text.slice(0, 200) });
          }
        } catch (e) {
          resolve({ error: e.message, raw: data.slice(0, 200) });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout na API Claude')); });
    req.write(body);
    req.end();
  });
}

// ── GET /admin/api/analise ────────────────────────────────────────────────────
router.get('/api/analise', requireAuth, async (req, res) => {
  const siteUrl = process.env.BASE_URL || 'https://passaroprofessor.com.br';
  try {
    // Roda em paralelo: PageSpeed + SEO scrape
    const [pageSpeed, seoData] = await Promise.all([
      runPageSpeed(siteUrl),
      scrapeSEO(siteUrl),
    ]);

    // IA analisa os dados
    const aiReport = await analyzeWithAI(seoData, pageSpeed, siteUrl);

    res.json({
      site_url: siteUrl,
      generated_at: new Date().toISOString(),
      page_speed: pageSpeed,
      seo: seoData,
      ai_report: aiReport,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
