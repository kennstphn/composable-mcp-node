import {fetch_cacheable_data} from "./fetch_cachable_data.mjs";

/**
 * Fetch tools from Directus for a specific tool_collation using the caller's bearer token.
 *
 * @param {string}      baseUrl         - Base URL of the Directus instance
 * @param {string}      bearerToken     - Caller's bearer token for Directus authentication
 * @param {string}      toolCollation   - Value of the tool_collation field to filter by
 * @param {string|null} [toolName=null] - Optional tool name to narrow the result to a single tool
 */
export async function fetchToolsForCollation(baseUrl, bearerToken, toolCollation, toolName = null) {

    let cache_config = {
        key: {toolCollation, toolName},
        duration_ms: 1000 * 60, // cache for 1 minute
    };

    return await fetch_cacheable_data(cache_config, async () => {
        const url = new URL('/items/tools', baseUrl);
        url.searchParams.set('fields', '*,operations.*');
        url.searchParams.set('filter[tool_collation][_eq]', toolCollation);
        if (toolName) {
            url.searchParams.set('filter[name][_eq]', toolName);
        }

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (response.status === 401 || response.status === 403) {
            const err = new Error('Directus authorization failed');
            err.status = response.status;
            throw err;
        }

        if (!response.ok) {
            throw new Error(`Directus returned ${response.status}`);
        }

        const { data } = await response.json();
        if(data){
            // we also need to parse the inputSchema for each tool's operations, if present
            for (const tool of data) {
                if(tool.inputSchema && typeof tool.inputSchema === 'string'){
                    try {
                        tool.inputSchema = JSON.parse(tool.inputSchema);
                    } catch (e) {
                        console.warn(`Failed to parse inputSchema for tool "${tool.slug || tool.name}":`, e);
                        tool.inputSchema = { type: 'object', properties: {} };
                    }
                }
            }
        }
        return data || [];
    });
}