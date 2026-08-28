export function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(`[Config Error] Missing required environment variable: ${name}. Please check your .env.local file.`);
    }
    return value.trim();
}

export function getOptionalEnv(name: string, fallback: string = ''): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        return fallback;
    }
    return value.trim();
}

export function validateCoreEnv(): { valid: boolean; missing: string[] } {
    const required = ['MONGODB_URI', 'REPLICATE_API_TOKEN'];
    const missing = required.filter(name => !process.env[name] || process.env[name]!.trim() === '');
    return {
        valid: missing.length === 0,
        missing,
    };
}
