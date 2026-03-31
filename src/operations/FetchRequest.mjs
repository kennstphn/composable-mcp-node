import {interpolateValue} from "../functions/interpolateValue.mjs";

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
 * Mustache rendering is applied to:
 *   - the URL string
 *   - every header value string
 *   - body string values (recursively inside objects/arrays)
 *
 * The full Mustache template language is supported: `{{key}}`, `{{a.b}}`,
 * sections (`{{#items}}…{{/items}}`), inverted sections, partials, etc.
 * HTML escaping is disabled because this is an HTTP API context, not HTML
 * generation — use `{{key}}` everywhere (no need for triple-stache `{{{key}}}`).
 *
 * When a value is *exactly* a single placeholder (`"{{key}}"`) the raw
 * context value is returned as-is (preserving objects/arrays/numbers).
 * When a placeholder is embedded inside a larger string the replacement
 * is always coerced to a string by Mustache.
 */

export class FetchRequest {
  constructor(config) {
    this.config = config;
    if(typeof config === 'string'){
      try{
        this.config = JSON.parse(config);
      }catch(e){
        throw new Error("FetchRequest: config string is not valid JSON");
      }
    }
  }

  async run(context, bearerToken) {
    const { url, method = 'GET', headers = {}, body } = this.config;

    if (!url) {
      throw new Error("FetchRequest: 'url' property is required in config");
    }

    // Render context values into URL, headers, and body via Mustache
    const resolvedUrl = interpolateValue(url, context);

    // Render header values
    const resolvedHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      resolvedHeaders[key] = interpolateValue(value, context);
    }

    const fetchOptions = {
      method: method.toUpperCase(),
      headers: resolvedHeaders,
    };

    // if the url starts with the $env.DIRECTUS_BASE_URL and the headers are missing authorization, add the bearer token to the headers
    (() => {
        const directusBaseUrl = context.$env && context.$env.DIRECTUS_BASE_URL;
        if ( ! directusBaseUrl) return;
        if (resolvedUrl.startsWith(directusBaseUrl) && bearerToken) {
          const hasAuthHeader = Object.keys(fetchOptions.headers)
            .some(k => k.toLowerCase() === 'authorization');
          if (!hasAuthHeader) {
            fetchOptions.headers['Authorization'] = `Bearer ${bearerToken}`;
          }
        }
    })();

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
