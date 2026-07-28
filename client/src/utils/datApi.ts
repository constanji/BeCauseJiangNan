/**
 * Dynamic DAT API base URL.
 *
 * The backend serves the runtime URL via /api/config startupConfig, so it can
 * be changed via the DAT_OPENAPI_BASE_URL env var without rebuilding the image.
 */

let _datApiBaseUrl: string | null = null;

/** Call once at app startup with the value from startupConfig. */
export function setDatApiBaseUrl(url: string | undefined | null): void {
  if (url) {
    _datApiBaseUrl = url;
  }
}

/** Returns the current DAT API base URL. */
export function getDatApiBaseUrl(): string {
  return _datApiBaseUrl || 'http://localhost:8080';
}
