/**
 * FetchRequest operation — makes an outbound HTTP call.
 *
 * Config schema:
 * {
 *   "url":     string (required),
 *   "method":  "GET" | "POST" | "PUT" | "PATCH" | "DELETE"  (default: "GET"),
 *   "headers": { [key: string]: string }                     (optional),
 *   "body":    object | string                               (optional, serialised as JSON when object)
 * }
 *
 * The operation resolves with the parsed JSON response body (or raw text when
 * the Content-Type is not application/json).
 */
export class FetchRequest {
  constructor(config) {
    this.config = config;
  }

  async run(context) {
    const { url, method = 'GET', headers = {}, body } = this.config;

    if (!url) {
      throw new Error("FetchRequest: 'url' property is required in config");
    }

    // Interpolate context values into the URL using {{slug}} placeholders
    const resolvedUrl = url.replace(/\{\{(\$?[\w.]+)\}\}/g, (_, key) => {
      const value = key.split('.').reduce((obj, k) => obj?.[k], context);
      return value !== undefined ? String(value) : '';
    });

    const fetchOptions = {
      method: method.toUpperCase(),
      headers: { ...headers },
    };

    if (body !== undefined && !['GET', 'HEAD'].includes(fetchOptions.method)) {
      if (typeof body === 'object') {
        fetchOptions.body = JSON.stringify(body);
        const hasContentType = Object.keys(fetchOptions.headers)
          .some(k => k.toLowerCase() === 'content-type');
        if (!hasContentType) {
          fetchOptions.headers['Content-Type'] = 'application/json';
        }
      } else {
        fetchOptions.body = String(body);
      }
    }

    const response = await fetch(resolvedUrl, fetchOptions);

    const contentType = response.headers.get('content-type') || '';
    let result;
    if (contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    if (!response.ok) {
      const err = new Error(`FetchRequest: HTTP ${response.status} from ${resolvedUrl}`);
      err.status = response.status;
      err.body = result;
      throw err;
    }

    return result;
  }
}
