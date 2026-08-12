import Replicate from 'replicate';
import { describeError } from '../lib/reportError';

// Is the account able to run the model this project actually spends on?
//
// The first version of this check ran flux-schnell, which costs about $0.003, and reported that
// spending worked. The very next flux-2-pro call came back 402. A probe has to ask about the model
// in question: Replicate checks the balance against the price of the model being started, so a
// cheap model succeeding says nothing about an expensive one.
//
// It costs nothing worth counting. The prediction is created without Prefer: wait and cancelled
// straight away, and the credit check happens at creation — so a healthy account gets billed for a
// prediction that is stopped within a second, and an empty one is rejected before anything starts.

const MODEL = 'black-forest-labs/flux-2-pro';
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

async function main() {
    try {
        await replicate.request('/account', { method: 'GET' });
        console.log('✅ token is valid');
    } catch (err) {
        console.log(`❌ token rejected — ${describeError(err)}`);
        console.log('   put the newly created token in REPLICATE_API_TOKEN in .env.local');
        process.exit(1);
    }

    let created: { id: string } | null = null;
    try {
        created = await replicate.predictions.create({
            model: MODEL,
            input: { prompt: 'a plain grey square', aspect_ratio: '1:1', resolution: '1 MP' },
        });
        console.log(`✅ credit accepted for ${MODEL} — the render run can go ahead`);
    } catch (err) {
        const message = describeError(err);
        if (message.includes('402') || message.toLowerCase().includes('credit')) {
            console.log(`❌ still not enough credit for ${MODEL} (it costs about $0.08 a call)`);
            console.log('   a top-up can take a few minutes to register, and a balance big enough');
            console.log('   for flux-schnell at $0.003 is not big enough for this one');
        } else {
            console.log(`⚠️  unexpected: ${message}`);
        }
        process.exit(1);
    } finally {
        if (created) {
            try { await replicate.predictions.cancel(created.id); } catch { /* already finished */ }
        }
    }
    process.exit(0);
}

main().catch((err) => { console.error('❌', describeError(err)); process.exit(1); });
