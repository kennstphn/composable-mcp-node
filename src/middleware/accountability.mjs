import {fetch_cacheable_data} from "../functions/fetch_cachable_data.mjs";

export async function loadAccountability(bearerToken, DIRECTUS_BASE_URL) {

    let url = new URL('/users/me', DIRECTUS_BASE_URL);
    url.searchParams.set('fields', '*,oauth.*');

    let cacheConfig = {
        key:{bearerToken,url: url.toString()},
        // cache for 2 seconds, to avoid hitting Directus too often while a token is being verified by multiple concurrent
        // requests (e.g. during startup or if the token just expired and is being refreshed). This is a best-effort
        // optimization and does not guarantee that only one request will hit Directus, but it should help reduce the
        // load in those scenarios.
        duration_ms: 2000
    };

    return await fetch_cacheable_data(cacheConfig, async() => {

        const response = await fetch(String(url),{
            headers:{
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json',
            }
        });

        if(!response.ok){
            throw new Error(`Failed to fetch user info: ${response.status}`);
        }

        return response.json().then(r => r.data);

    });
}

export function accountability(baseUrl){

    return async (req, res, next) => {
        if(! req.token){
            // No token, skip accountability
            return next();
        }

        // Best-effort: enrich the request with Directus user details.
        // Failures (e.g. Directus unreachable or token not yet verified) set
        // $accountability to null and continue — the token is still validated
        // by whichever Directus API call the route makes first.
        loadAccountability(req.token, baseUrl).then(accountability => {
            req.$accountability = accountability;
            next();
        }).catch(() => {
            req.$accountability = null;
            next();
        });

    }
}