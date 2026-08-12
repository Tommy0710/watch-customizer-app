// Describes an error without printing the credentials attached to it.
//
// `console.error("❌ Processing error:", error)` in /api/generate's outer catch dumps the whole
// Replicate SDK ApiError object whenever the retry logic re-throws — and that object carries the
// Request that produced it, Authorization header included. A single failed dataset-building script
// call did exactly this and wrote a live REPLICATE_API_TOKEN into a log file in plain text; the
// token was rotated, but this route logs to the same terminal the token leaked from and has the
// same bug, live, every time a Combine request errors past the E005/5xx retry.
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
