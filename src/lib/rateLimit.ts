type RateLimitRecord = {
    count: number;
    resetAt: number;
};

const rateLimitMap = new Map<string, RateLimitRecord>();

/**
 * In-memory sliding window rate limiter for expensive endpoints like /api/generate.
 * Defaults to 10 requests per minute per IP.
 */
export function checkRateLimit(
    identifier: string,
    limit: number = 10,
    windowMs: number = 60000
): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const record = rateLimitMap.get(identifier);

    // Clean up expired entries periodically if map grows large
    if (rateLimitMap.size > 10000) {
        for (const [key, value] of rateLimitMap.entries()) {
            if (now > value.resetAt) {
                rateLimitMap.delete(key);
            }
        }
    }

    if (!record || now > record.resetAt) {
        rateLimitMap.set(identifier, {
            count: 1,
            resetAt: now + windowMs,
        });
        return {
            allowed: true,
            remaining: limit - 1,
            resetInMs: windowMs,
        };
    }

    if (record.count >= limit) {
        return {
            allowed: false,
            remaining: 0,
            resetInMs: Math.max(0, record.resetAt - now),
        };
    }

    record.count += 1;
    return {
        allowed: true,
        remaining: limit - record.count,
        resetInMs: Math.max(0, record.resetAt - now),
    };
}
