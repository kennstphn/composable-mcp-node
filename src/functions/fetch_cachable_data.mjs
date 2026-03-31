let cache = new Map();
export async function fetch_cacheable_data({key,duration_ms},fetch_function) {
    key = typeof key === 'string' ? key : JSON.stringify(key);

    if(cache.has(key)){
        let { timestamp, data } = cache.get(key);
        if(Date.now() - timestamp < duration_ms){
            return data;
        }
    }
    let data = await fetch_function();
    cache.set(key, { timestamp: Date.now(), data });
    return data;
}
/** Clear all cached entries. Intended for use in tests only. */
export function clearFetchCache() {
    cache.clear();
}
