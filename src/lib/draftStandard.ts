// The one definition of "this draft is good enough to use".
//
// It exists because the same five faults kept reaching a reviewer instead of being caught: a strap
// assembled upside down, a render whose two halves came back the same length, a head whose crown
// pulled the strap off the lug axis, a segment that could not be split at all, and a watch quietly
// shrunk to make an over-long strap fit. Each was diagnosed, fixed in the builder, and then had
// nothing stopping the next one like it.
//
// Five drafts were reviewed and accepted on 2026-08-11 — products 26593, 63837, 68963, 71311 and
// 71317 — and every threshold below is set from what they measure, with room either side. Anything
// this rejects is a render to redo, not a layout to bend: bending the layout is what damaged the
// leather in the first place.

// A real strap's buckle side is about 38% of its total length. The accepted five measure 37% to
// 40%; renders that normalised the two halves to equal length sit at 48% to 50%.
export const TARGET_BUCKLE_SHARE = 0.38;
export const MAX_BUCKLE_SHARE_DRIFT = 0.06;

// The watch head is meant to be one fixed size across every draft, so the model never has to guess
// how big a watch is. The floor is set from the accepted five rather than from the ideal: four of
// them draw at full size and 71311 at 97%, a difference no one picked out, while the renders being
// rejected sit at 85%. Anything under this had its watch shrunk to accommodate an over-long strap,
// which is the render's fault and not something to accept.
export const MIN_ACCEPTED_CASE_SCALE = 0.96;

export type DraftAssessment = {
    ok: boolean;
    reasons: string[]; // empty when ok; each names what to fix, not just what is wrong
};

export type DraftFacts = {
    buckleShare: number; // buckle segment's share of total strap length
    caseScale: number; // as reported by computeSegmentedLayout
    lugGapRead: boolean; // whether the head's lug gap could be measured
    // Why colour belongs in the same verdict as geometry: a reviewer looking at a sheet of drafts
    // rejects a brown-ified black strap and an upside-down one in the same pass, and the gate is
    // only trustworthy if it rejects everything they would.
    colour?: { ok: boolean; reason?: string };
};

export function assessDraft(facts: DraftFacts): DraftAssessment {
    const reasons: string[] = [];

    const drift = facts.buckleShare - TARGET_BUCKLE_SHARE;
    if (Math.abs(drift) > MAX_BUCKLE_SHARE_DRIFT) {
        reasons.push(
            drift > 0
                ? `buckle side is ${Math.round(facts.buckleShare * 100)}% of the strap, not ~38% — the render made the two halves too alike in length; re-render`
                : `buckle side is only ${Math.round(facts.buckleShare * 100)}% of the strap — the render cut it short; re-render`,
        );
    }

    if (facts.caseScale < MIN_ACCEPTED_CASE_SCALE) {
        reasons.push(
            `watch had to be shrunk to ${Math.round(facts.caseScale * 100)}% to fit the strap — re-render the strap rather than accept an undersized watch`,
        );
    }

    if (facts.colour && !facts.colour.ok) {
        reasons.push(`strap colour does not match the catalog photo — ${facts.colour.reason ?? 'drifted'}; re-render`);
    }

    if (!facts.lugGapRead) {
        reasons.push('could not read the gap between the lugs, so the strap width and its alignment to the case are both guesses');
    }

    return { ok: reasons.length === 0, reasons };
}
