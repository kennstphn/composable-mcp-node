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
        return res.status(401).json({ state: 'needed' });
    }

    // Inject the token into the request object
    req.token = bearerToken;

    // Optional: If you decode/verify the token (JWT, etc.), attach the user too
    // req.user = decodeToken(bearerToken);

    next();
};

// Helper to skip auth on specific routes
export const skipAuthFor = (paths = []) => {
    const normalizedPaths = paths.map(p => p.replace(/\/$/, ''));

    return (req, res, next) => {
        const currentPath = req.path.replace(/\/$/, '');

        // Check for exact match only (you can enhance this to support patterns if needed)
        if (normalizedPaths.some(p => currentPath === p)) {
            return next(); // skip auth
        }

        return requireAuth(req, res, next);
    };
};