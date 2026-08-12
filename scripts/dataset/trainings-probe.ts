// Narrows the create-training 500 to either "Replicate's trainings API is unwell" or
// "this account is blocked from training".
//
// The discriminator is WHERE the request dies. A deliberately invalid destination must be rejected
// by validation with a 4xx; if it comes back 500 as well, the request is failing before validation
// runs, which points at the service rather than at anything in the request. Reading trainings while
// creating them fails separates the two halves of the same API.
//
// Nothing here can start a billable training: the destination does not exist.

const TOKEN = process.env.REPLICATE_API_TOKEN;
const TRAINER = 'ostris/flux-dev-lora-trainer';

async function call(method: string, url: string, body?: unknown) {
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.text()).slice(0, 200) };
}

async function main() {
    const trainer = await (await fetch(`https://api.replicate.com/v1/models/${TRAINER}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    })).json() as { latest_version: { id: string } };
    const version = trainer.latest_version.id;

    const checks: [string, () => Promise<{ status: number; body: string }>][] = [
        ['GET  /v1/account', () => call('GET', 'https://api.replicate.com/v1/account')],
        ['GET  /v1/trainings (list)', () => call('GET', 'https://api.replicate.com/v1/trainings')],
        ['POST training, destination that does not exist', () =>
            call('POST', `https://api.replicate.com/v1/models/${TRAINER}/versions/${version}/trainings`, {
                destination: 'tommy0710/__does_not_exist__',
                input: { input_images: 'https://example.invalid/none.zip', steps: 1000 },
            })],
        ['POST training, no destination at all (must be 422)', () =>
            call('POST', `https://api.replicate.com/v1/models/${TRAINER}/versions/${version}/trainings`, {
                input: { input_images: 'https://example.invalid/none.zip', steps: 1000 },
            })],
        ['POST prediction (inference, known to work)', () =>
            call('POST', 'https://api.replicate.com/v1/predictions', {
                version: 'black-forest-labs/flux-schnell',
                input: { prompt: 'a plain grey square', num_outputs: 1 },
            })],
    ];

    for (const [label, run] of checks) {
        const { status, body } = await run();
        console.log(`${String(status).padEnd(4)} ${label}`);
        if (status >= 400) console.log(`     ${body}`);
    }
    process.exit(0);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
