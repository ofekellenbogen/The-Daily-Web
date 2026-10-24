const FALLBACK_IMAGE_URL = '/images/article-placeholder.svg';
const { ARTICLE_IMAGE_PATTERN } = require('../../utils/articleImage');

const CATEGORY_COLORS = {
  politics: ['#edf3f1', '#176b67'],
  economy: ['#f5efe3', '#8a5a1e'],
  world: ['#eaf1f7', '#356b91'],
  tech: ['#e8f1f3', '#087f8c'],
  sports: ['#f2eee5', '#a34f32'],
  culture: ['#f4eaea', '#9a4654'],
  health: ['#eaf2ec', '#3d7654']
};

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;'
  })[character]);
}

function wrapText(value, maxLength, maxLines) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, maxLength - 1)}…`;
  }
  return lines;
}

function renderLines(lines, x, lineHeight) {
  return lines.map((line, index) =>
    `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
  ).join('');
}

function getArticleMedia(version) {
  const imageUrl = typeof version.imageUrl === 'string' ? version.imageUrl.trim() : '';
  if (!imageUrl) {
    return {
      imageUrl: FALLBACK_IMAGE_URL,
      imageAlt: '',
      imageCredit: '',
      imageSourceUrl: '',
      imageLicense: '',
      imageLicenseUrl: ''
    };
  }

  const versionedImageUrl = ARTICLE_IMAGE_PATTERN.test(imageUrl)
    ? `${imageUrl}?v=${version.version || 1}`
    : imageUrl;
  const imageAlt = typeof version.imageAlt === 'string' ? version.imageAlt.trim() : '';
  return {
    imageUrl: versionedImageUrl,
    imageAlt: imageAlt || version.title,
    imageCredit: version.imageCredit || '',
    imageSourceUrl: version.imageSourceUrl || '',
    imageLicense: version.imageLicense || '',
    imageLicenseUrl: version.imageLicenseUrl || ''
  };
}

function renderArticleIllustration(article) {
  const [background, accent] = CATEGORY_COLORS[article.category] || ['#edf1f1', '#435e60'];
  const titleLines = wrapText(article.title, 38, 3);
  const summaryLines = wrapText(article.summary, 64, 2);
  const title = renderLines(titleLines, 574, 42);
  const summary = renderLines(summaryLines, 574, 25);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img">
  <rect width="640" height="360" fill="${background}"/>
  <circle cx="82" cy="70" r="120" fill="${accent}" opacity="0.10"/>
  <circle cx="573" cy="324" r="144" fill="${accent}" opacity="0.08"/>
  <path d="M0 298 176 248l119 38 163-72 182 58v88H0Z" fill="${accent}" opacity="0.10"/>
  <rect x="32" y="28" width="576" height="304" rx="12" fill="#fff" opacity="0.94"/>
  <rect x="32" y="28" width="7" height="304" rx="3" fill="${accent}"/>
  <text x="574" y="74" text-anchor="end" direction="rtl" fill="${accent}" font-family="Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(article.categoryLabel)}</text>
  <text x="574" y="127" text-anchor="end" direction="rtl" fill="#183234" font-family="Arial, sans-serif" font-size="27" font-weight="700">${title}</text>
  <text x="574" y="258" text-anchor="end" direction="rtl" fill="#536769" font-family="Arial, sans-serif" font-size="16">${summary}</text>
  <path d="M66 298h36m12 0h12m12 0h36" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.55"/>
</svg>`;
}

module.exports = { FALLBACK_IMAGE_URL, getArticleMedia, renderArticleIllustration };