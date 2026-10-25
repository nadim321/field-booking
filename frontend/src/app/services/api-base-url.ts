export function resolveApiBaseUrl(configuredUrl: string): string {
  const configured = configuredUrl.trim().replace(/\/+$/, '');
  if (!configured) throw new Error('apiBaseUrl must be configured in the Angular environment.');

  if (configured.startsWith('/') && !configured.startsWith('//')) {
    let parsed: URL;
    try {
      parsed = new URL(configured, 'https://same-origin.invalid');
    } catch {
      throw new Error('apiBaseUrl must be a root-relative path or an absolute HTTP(S) URL.');
    }
    if (parsed.origin !== 'https://same-origin.invalid' || parsed.search || parsed.hash) {
      throw new Error('apiBaseUrl must be a root-relative path or an absolute HTTP(S) URL without query or hash.');
    }
    return configured;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('apiBaseUrl must be a root-relative path or an absolute HTTP(S) URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('apiBaseUrl must be a root-relative path or an absolute HTTP(S) URL without credentials, query, or hash.');
  }

  return configured;
}
