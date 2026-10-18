function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function pageMetadata(route, settings, publicSiteUrl) {
  const name = String(settings.turf_name || 'Turf Booking').trim();
  const season = route === '/season-booking';
  const title = season ? `${name} | Weekly Season Booking` : `${name} | Turf Slot Booking`;
  const description = season
    ? `Request the same weekly playing slot at ${name}.`
    : `Choose a date, check available slots and request a turf booking at ${name}.`;
  const canonical = new URL(season ? '/season-booking' : '/', publicSiteUrl).href;
  const media = settings.turf_share_image || settings.turf_photos?.[0] || null;
  const image = media ? new URL(media.url, publicSiteUrl).href : null;
  return { title, description, name, canonical, image, imageWidth: media?.width, imageHeight: media?.height };
}

function renderMetadata(documentHtml, metadata) {
  let html = documentHtml
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${escapeHtml(metadata.description)}">`)
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '');
  const tags = [
    `<link rel="canonical" href="${escapeHtml(metadata.canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeHtml(metadata.name)}">`,
    `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
    `<meta property="og:url" content="${escapeHtml(metadata.canonical)}">`,
    `<meta name="twitter:title" content="${escapeHtml(metadata.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(metadata.description)}">`
  ];
  tags.push(`<meta name="twitter:card" content="${metadata.image ? 'summary_large_image' : 'summary'}">`);
  if (metadata.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(metadata.image)}">`);
    tags.push(`<meta property="og:image:width" content="${Number(metadata.imageWidth) || 1200}">`);
    tags.push(`<meta property="og:image:height" content="${Number(metadata.imageHeight) || 630}">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(metadata.image)}">`);
  }
  return html.replace(/<\/head>/i, `  ${tags.join('\n  ')}\n</head>`);
}

module.exports = { escapeHtml, pageMetadata, renderMetadata };
