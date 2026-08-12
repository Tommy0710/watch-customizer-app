import Replicate from 'replicate';
import { describeError } from '../lib/reportError';

// A 500 from create-training does not prove nothing was created: the record can be written and the
// response still fail. watch-lora gained a version between 10:26 and 11:05 today, which is exactly
// the window those probes ran in, so this checks what the account actually has.

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

async function main() {
    const page = await replicate.trainings.list();
    const rows = (page.results ?? []).slice(0, 12);
    console.log(`${rows.length} most recent trainings on this account:\n`);
    for (const t of rows) {
        const out = (t.output as { version?: string } | null)?.version ?? '';
        console.log(
            `${t.created_at}  ${String(t.status).padEnd(10)} ${t.id}  ${(t as { model?: string }).model ?? ''}`,
        );
        if (out) console.log(`    → ${out}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error('❌', describeError(e)); process.exit(1); });
