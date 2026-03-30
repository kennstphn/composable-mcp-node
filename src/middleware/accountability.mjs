import {fetch_cacheable_data} from "../functions/fetch_cachable_data.mjs";

async function loadAccountability(bearerToken, DIRECTUS_BASE_URL) {

    let url = new URL('/users/me', DIRECTUS_BASE_URL);
    url.searchParams.set('fields', '*,oauth.*');

    let cacheConfig = {
        key:{bearerToken,url: url.toString()},
        duration_ms: 60 * 1000
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

    return (req, res, next) => {
        if(! req.token){
            // No token, skip accountability
            return next();
        }

        loadAccountability(req.token, baseUrl).then(accountability => {
            req.$accountability = accountability;
            next();
        }).catch(err => {
            return res.status(401).json({ state: 'invalid_token', error: err.message });
        })

    }
}