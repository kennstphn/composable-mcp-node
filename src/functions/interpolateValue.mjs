import Mustache from 'mustache';

// Disable HTML escaping — this is an HTTP API context, not HTML generation.
Mustache.escape = (text) => text;

/**
 * Render a Mustache `template` string against `context`.
 *
 * Special case: when the entire template is a single `{{key}}` placeholder
 * the raw context value is returned as-is so that objects, arrays, and
 * numbers are preserved rather than being coerced to `[object Object]` etc.
 *
 * @param {string} template - The string that may contain Mustache tags.
 * @param {object} context  - The flow context to resolve keys against.
 * @returns {*}             - Rendered string, or the raw context value when
 *                            the template is a single exact placeholder.
 */
function interpolate(template, context) {
    if (typeof template !== 'string') return template;

    // Exact-match: the whole value is one placeholder → return raw context value.
    // This preserves objects/arrays/numbers as-is, which Mustache would stringify.
    const exact = /^\{\{\s*(\$?[\w.]+)\s*\}\}$/.exec(template);
    if (exact) {
        const value = exact[1].split('.').reduce((obj, k) => obj?.[k], context);
        return value !== undefined ? value : '';
    }

    // Embedded placeholder(s) → delegate to Mustache for full rendering support.
    return Mustache.render(template, context);
}

/**
 * Recursively render all string leaves in a value.
 */
export function interpolateValue(value, context) {
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