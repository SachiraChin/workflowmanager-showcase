/**
 * Application configuration with dynamic API URL detection.
 *
 * Uses environment variables:
 * - VITE_API_LOCAL_URL: API URL for localhost (default: http://localhost:9000)
 * - VITE_API_PROD_URL: API URL for production domain
 *
 * Selects the correct URL at runtime based on window.location.hostname.
 */

/**
 * Get the API URL based on current location.
 */
export function getApiUrl(): string {
  const { hostname, protocol } = window.location;

  // Local development
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return import.meta.env.VITE_API_LOCAL_URL || "http://localhost:9000";
  }

  // Production: use configured URL or fallback to api.{domain}
  return import.meta.env.VITE_API_PROD_URL || `${protocol}//api.${hostname}`;
}

/**
 * Cached API URL (computed once on load).
 */
export const API_URL = getApiUrl();

/**
 * Check if running in development mode.
 */
export const IS_DEV = import.meta.env.DEV;

/**
 * Check if running in production mode.
 */
export const IS_PROD = import.meta.env.PROD;

/**
 * Convert a media URL/path to a full URL.
 *
 * The server returns relative paths (e.g., /workflow/{id}/media/{content_id}.png)
 * for locally stored media. This function prepends API_URL to make them absolute.
 * External URLs (http/https) are returned unchanged.
 */
export function toMediaUrl(urlOrPath: string): string {
  // Already an absolute URL (external provider URL)
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    return urlOrPath;
  }

  // Relative path from server - prepend API_URL
  return `${API_URL}${urlOrPath}`;
}
