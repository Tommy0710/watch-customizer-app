// Every Replicate call in scripts/ goes through one of these. The pilot's whole budget is $4.63
// and there is no budget for a second training run, so an accidental loop must abort rather than
// spend. Charges are recorded BEFORE the paid call, never after — a call that already happened
// cannot be un-billed.

export class SpendExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SpendExceededError';
    }
}

export type SpendGuard = {
    charge(unitCost: number, description: string): void;
    spent(): number;
    remaining(): number;
    summary(): string;
};

export function createSpendGuard(opts: { maxSpend: number; label: string }): SpendGuard {
    if (!(opts.maxSpend > 0)) {
        throw new Error(`maxSpend must be a positive number, got ${opts.maxSpend}`);
    }

    let total = 0;

    return {
        charge(unitCost: number, description: string) {
            const next = total + unitCost;
            // Tolerate float dust so a cap of exactly 1 accepts 0.1 x 10.
            if (next > opts.maxSpend + 1e-9) {
                throw new SpendExceededError(
                    `[${opts.label}] refusing "${description}": $${unitCost.toFixed(2)} would take spend to ` +
                    `$${next.toFixed(2)}, over the $${opts.maxSpend.toFixed(2)} cap (already spent $${total.toFixed(2)}).`,
                );
            }
            total = next;
        },
        spent: () => total,
        remaining: () => Math.max(0, opts.maxSpend - total),
        summary: () => `[${opts.label}] spent $${total.toFixed(2)} of $${opts.maxSpend.toFixed(2)}`,
    };
}
