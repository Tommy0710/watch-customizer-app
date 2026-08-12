import Replicate from 'replicate';
import { describeError } from '../lib/reportError';

const MODEL = 'black-forest-labs/flux-2-pro';
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

async function main() {
    let created: { id: string } | null = null;
    try {
        created = await replicate.predictions.create({
            model: MODEL,
            input: { prompt: 'a plain grey square', aspect_ratio: '1:1', resolution: '1 MP' },
        });
        console.log(`✅ credit accepted for ${MODEL}`);
    } catch (err) {
        const message = describeError(err);
        console.log(message.includes('402') || message.toLowerCase().includes('credit')
            ? `❌ out of credit for ${MODEL}`
            : `⚠️  unexpected: ${message}`);
        process.exit(1);
    } finally {
        if (created) { try { await replicate.predictions.cancel(created.id); } catch { /* already finished */ } }
    }
    process.exit(0);
}
main().catch((err) => { console.error('❌', describeError(err)); process.exit(1); });
