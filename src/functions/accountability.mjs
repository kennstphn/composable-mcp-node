import {fetch_cacheable_data} from "./fetch_cachable_data.mjs";
import cookie from "cookie";

export function get_token(req) {
    let runner = () => {
        const header = req.headers.authorization;

        if (header) {
            const token = header.replace(/^\s*bearer\s+/i, '').trim();
            if (token) return token;
        }

        if (!req.headers.cookie) return null;

        const cookies = cookie.parse(req.headers.cookie);

        return cookies.directus_session_token ||
            cookies.directus_session ||
            null;
    }
    let val = runner();
    console.log('Extracted token:', val ? `${val.slice(0, 4)}...${val.slice(-4)}` : 'No token found');
    return val;
}



export async function get_accountability(req,DIRECTUS_BASE_URL, force = false){
    let token = get_token(req);
    if(force && !token){
        throw new Error('Missing Token');
    }

    let accountability = fetch_cacheable_data({
        key:{bearerToken: token, url: `${DIRECTUS_BASE_URL}/users/me`},
        duration_ms: 2000
    }, async() => {
        const response = await fetch(`${DIRECTUS_BASE_URL}/users/me?*,oauth.*`,{
            headers:{
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            }
        });

        if(!response.ok){
            throw new Error(`Failed to fetch user info: ${response.status}`);
        }

        return response.json().then(r => r.data);
    });

    if(force && !accountability){
        throw new Error('Failed to load accountability');
    }
    return accountability;
}