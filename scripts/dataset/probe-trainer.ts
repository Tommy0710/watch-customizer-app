// Health probe for replicate/fast-flux-kontext-trainer, which currently answers every
// create-training request with a bare 500.
//
// The probe deliberately aims at a destination model that does not exist. A healthy API rejects
// that outright (404/422) and can never start a billable training; a broken one still returns
// 500. Probing with a valid destination would be unsafe — the trainer declares NO required
// inputs, so a well-formed request is accepted and starts charging immediately.
//
// Exits 0 the moment the trainer looks healthy, so it can be used as a wait condition.

export {};

const TRAINER_VERSION = '26c877b4ec3988b7e8edc5840e61339c68f09913bb11e23c31566590fd92a66d';
const PROBE_URL =
    `https://api.replicate.com/v1/models/replicate/fast-flux-kontext-trainer/versions/${TRAINER_VERSION}/trainings`;

async function probe(): Promise<{ healthy: boolean; status: number; body: string }> {
    const res = await fetch(PROBE_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            destination: 'tommy0710/__healthcheck_does_not_exist__',
            input: { input_images: 'https://example.invalid/none.zip' },
        }),
    });
    const body = (await res.text()).slice(0, 160);
    // Anything that is not a server error means the endpoint is processing requests again.
    return { healthy: res.status < 500, status: res.status, body };
}

async function main() {
    const once = process.argv.includes('--once');
    const intervalMs = Number(
        process.argv.find((a) => a.startsWith('--interval='))?.slice('--interval='.length) ?? 600_000,
    );

    for (;;) {
        let result: { healthy: boolean; status: number; body: string };
        try {
            result = await probe();
        } catch (err) {
            console.log(`${new Date().toISOString()} probe failed: ${(err as Error).message.slice(0, 80)}`);
            if (once) process.exit(1);
            await new Promise((r) => setTimeout(r, intervalMs));
            continue;
        }

        if (result.healthy) {
            console.log(`TRAINER HEALTHY — status ${result.status}. Run: npm run ds scripts/dataset/train.ts -- --steps=700`);
            process.exit(0);
        }

        console.log(`${new Date().toISOString()} still down (${result.status})`);
        if (once) process.exit(1);
        await new Promise((r) => setTimeout(r, intervalMs));
    }
}

main();
