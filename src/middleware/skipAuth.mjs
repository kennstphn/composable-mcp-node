// middleware/auth.js

export function extractBearerToken(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.slice(7);
}

export const requireAuth = (req, res, next) => {
    const bearerToken = extractBearerToken(req);

    if (!bearerToken) {
        return res.status(401).json({ error: 'Authorization required', state: 'needed' });
    }

    // Inject the token into the request object
    req.token = bearerToken;

    next();
};

// Helper to skip auth on specific routes or for specific JSON-RPC methods.
// For skip-listed paths and the MCP initialize handshake the bearer token is
// still extracted and injected as req.token when it is present (optional auth).
export const skipAuthFor = (paths = []) => {
    const normalizedPaths = paths.map(p => p.replace(/\/$/, ''));

    return (req, res, next) => {
        const currentPath = req.path.replace(/\/$/, '');

        if (normalizedPaths.some(p => currentPath === p)) {
            // Optional auth: extract token if provided, but do not require it.
            req.token = extractBearerToken(req) || undefined;
            return next();
        }

        // The MCP protocol initialize handshake is sent before credentials are established;
        // allow it through so clients can negotiate the protocol version without a token.
        if (req.method === 'POST' && req.body?.method === 'initialize') {
            req.token = extractBearerToken(req) || undefined;
            return next();
        }

        return requireAuth(req, res, next);
    };
};