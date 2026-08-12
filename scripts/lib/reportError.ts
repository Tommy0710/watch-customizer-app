// Prints an error without printing the credentials attached to it.
//
// `console.error('❌', err)` on a Replicate SDK error dumps the whole ApiError, and that object
// carries the Request that produced it — including its Authorization header. A single failed call
// wrote a live REPLICATE_API_TOKEN into a log file in plain text. The token was rotated, but the
// logging is what has to change: any script that talks to an authenticated API can do this, and the
// day it happens is the day something else is going wrong and nobody is reading carefully.
//
// Only the message and the status are ever useful for diagnosis anyway; the headers never were.

const SECRET_PATTERNS: RegExp[] = [
    /r8_[A-Za-z0-9]{20,}/g,          // Replicate
    /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,  // AWS access key id
    /Bearer\s+[A-Za-z0-9._\-]{16,}/g,
    /mongodb(\+srv)?:\/\/[^\s"']+/g, // connection strings carry the password inline
];

export function redact(text: string): string {
    return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, '[redacted]'), text);
}

export function describeError(err: unknown): string {
    if (err instanceof Error) {
        const status = (err as { response?: { status?: number } }).response?.status
            ?? (err as { status?: number }).status;
        return redact(`${err.message}${status ? ` (HTTP ${status})` : ''}`);
    }
    return redact(String(err));
}
