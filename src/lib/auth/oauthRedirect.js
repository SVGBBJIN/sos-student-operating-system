/**
 * Build a stable redirect URL for OAuth callbacks.
 * Normalizes duplicate slashes in path and strips auth hash fragments.
 */
export function buildOAuthRedirectUrl(rawHref) {
  try {
    const url = new URL(rawHref || window.location.href);
    const cleanPath = ('/' + (url.pathname || '').replace(/^\/+/, ''))
      .replace(/\/+/g, '/');
    return `${url.origin}${cleanPath}`;
  } catch (_) {
    return window.location.origin;
  }
}
