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
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "192.168.1.163" || hostname === "192.168.1.181" || hostname === "192.168.1.225") {
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
 * Get the Virtual API URL for preview/virtual execution.
 *
 * Virtual server runs separately from the main server for resource isolation.
 * - Development: VITE_VIRTUAL_API_LOCAL_URL or http://localhost:9001
 * - Production: VITE_VIRTUAL_API_PROD_URL or vapi.{domain}
 */
export function getVirtualApiUrl(): string {
  const { hostname, protocol } = window.location;

  // Local development
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "192.168.1.163" || hostname === "192.168.1.181" || hostname === "192.168.1.225") {
    return import.meta.env.VITE_VIRTUAL_API_LOCAL_URL || "http://localhost:9001";
  }

  // Production: use configured URL or fallback to vapi.{domain}
  return import.meta.env.VITE_VIRTUAL_API_PROD_URL || `${protocol}//vapi.${hostname}`;
}

/**
 * Cached Virtual API URL (computed once on load).
 */
export const VIRTUAL_API_URL = getVirtualApiUrl();

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
 * External URLs (http/https) and data URIs are returned unchanged.
 */
export function toMediaUrl(urlOrPath: string): string {
  // Already an absolute URL (external provider URL) or data URI
  if (
    urlOrPath.startsWith("http://") ||
    urlOrPath.startsWith("https://") ||
    urlOrPath.startsWith("data:")
  ) {
    return urlOrPath;
  }

  // Relative path from server - prepend API_URL
  return `${API_URL}${urlOrPath}`;
}

/**
 * Get the editor base URL from environment variable.
 *
 * Uses VITE_EDITOR_URL environment variable.
 * - In development: typically empty string or http://localhost:5174
 * - In production: typically /editor (relative) or full URL
 *
 * Returns empty string if not configured.
 */
export function getEditorUrl(): string {
  return import.meta.env.VITE_EDITOR_URL || "";
}

/**
 * Cached editor URL (computed once on load).
 */
export const EDITOR_URL = getEditorUrl();

/**
 * Build a URL to edit a workflow in the editor.
 *
 * @param templateId - Workflow template ID
 * @param versionId - Workflow version ID (optional)
 * @returns Full URL to the editor page for this workflow
 */
export function buildEditorWorkflowUrl(templateId: string, versionId?: string): string {
  const base = EDITOR_URL;
  if (versionId) {
    return `${base}/workflow/${templateId}/${versionId}`;
  }
  return `${base}/workflow/${templateId}`;
}
