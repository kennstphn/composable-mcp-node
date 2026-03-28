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
 *
 * Context interpolation (`{{key}}` / `{{$env.key}}`) is applied to:
 *   - the URL string
 *   - every header value string
 *   - body string values (recursively inside objects/arrays)
 *
 * When a value is *exactly* a single placeholder (`"{{key}}"`) the raw
 * context value is returned as-is (preserving objects/arrays/numbers).
 * When a placeholder is embedded inside a larger string the replacement
 * is always coerced to a string.
 */

/**
 * Interpolate `{{key}}` / `{{$env.key}}` expressions inside a template.
 *
 * @param {string} template - The string that may contain placeholders.
 * @param {object} context  - The flow context to resolve keys against.
 * @returns {*}             - Interpolated string, or the raw context value
 *                            when the template is a single exact placeholder.
 */
function interpolate(template, context) {
  if (typeof template !== 'string') return template;

  // Exact-match: the whole value is one placeholder → return raw context value
  const exact = /^\{\{(\$?[\w.]+)\}\}$/.exec(template);
  if (exact) {
    const value = exact[1].split('.').reduce((obj, k) => obj?.[k], context);
    return value !== undefined ? value : '';
  }

  // Embedded placeholder(s) → always produce a string
  return template.replace(/\{\{(\$?[\w.]+)\}\}/g, (_, key) => {
    const value = key.split('.').reduce((obj, k) => obj?.[k], context);
    return value !== undefined ? String(value) : '';
  });
}

/**
 * Recursively interpolate all string leaves in a value.
 */
function interpolateValue(value, context) {
  if (typeof value === 'string') return interpolate(value, context);
  if (Array.isArray(value)) return value.map(item => interpolateValue(item, context));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateValue(v, context);
    }
    return out;
  }
  return value;
}

export class FetchRequest {
  constructor(config) {
    this.config = config;
  }

  async run(context) {
    const { url, method = 'GET', headers = {}, body } = this.config;

    if (!url) {
      throw new Error("FetchRequest: 'url' property is required in config");
    }

    // Interpolate context values into URL, headers, and body
    const resolvedUrl = interpolate(url, context);

    // Interpolate header values
    const resolvedHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      resolvedHeaders[key] = interpolate(value, context);
    }

    const fetchOptions = {
      method: method.toUpperCase(),
      headers: resolvedHeaders,
    };

    if (body !== undefined && !['GET', 'HEAD'].includes(fetchOptions.method)) {
      const resolvedBody = interpolateValue(body, context);
      if (typeof resolvedBody === 'object' && resolvedBody !== null) {
        fetchOptions.body = JSON.stringify(resolvedBody);
        const hasContentType = Object.keys(fetchOptions.headers)
          .some(k => k.toLowerCase() === 'content-type');
        if (!hasContentType) {
          fetchOptions.headers['Content-Type'] = 'application/json';
        }
      } else {
        fetchOptions.body = String(resolvedBody);
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
