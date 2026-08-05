// Classifies a strap's real-world construction so /api/generate can describe it accurately to
// FLUX instead of using one generic prompt for every strap.
//
// Primary source: the product's real WooCommerce attributes (`Style of Stitch`, `Padded`,
// `Curved End`, `Folded Edge`, `Tip Shape`) — these are merchant-entered structured facts, not
// guesses, and cover ~86% of the catalog (confirmed via direct MongoDB aggregation). Category
// remains the source for classic/vintage `style` (no general-purpose "style" attribute exists;
// only `Style of Stitch`, which conflates style with stitch presence, e.g. "No stitches
// (Vintage style)"). Name/category regex is kept only as a fallback for the ~14% of products
// missing these attributes.

export type Attribute = { name: string; options: string[] };

export type StrapProfile = {
    style: 'classic' | 'vintage';
    padded: boolean;
    curvedEnd: boolean;
    foldedEdge: boolean;
    stitch: 'micro' | 'double' | 'box' | 'standard' | 'none';
    tipShape: 'square' | 'oval' | 'pilot' | 'regular';
    thickness: 'slim' | 'standard' | 'thick' | 'super-thick' | 'over-thick';
    // Habana-leather padded straps are built differently from other padded straps: confirmed by
    // zooming into real product photos, the raised padded ridge is a SHORT section concentrated
    // near the buckle and the curved tip end — the leather near the spring bars/lugs stays flat,
    // not puffy. (First attempt at this got the direction backwards and described the padding as
    // running the strap's full length, which the user caught by pointing at a real generated image
    // where the ridge wrongly extended all the way to the tip.) Deliberately not describing this to
    // FLUX by naming the material "Habana" — that word carries a strong brown/tobacco color
    // association that was separately observed overriding the actual reference photo's true color,
    // e.g. a near-black teal-patina strap rendered as plain brown. Describe the construction only,
    // never the material name.
    habanaBuckleSidePadding: boolean;
    // "Double Padded" vs "Single Padded" is only distinguished in the product NAME on this site,
    // not by any WooCommerce attribute (`Padded` is "Square" for both) — confirmed by comparing
    // real product photos: single-padded has one raised center ridge, double-padded has two
    // parallel raised ridges side by side.
    doublePadded: boolean;
    // Confirmed via MongoDB (4 real products in the "Sailcloth mix Alligator" category): these
    // straps use two different materials on the same strap, not one uniform material like every
    // other strap this classifier handles — a short alligator/croc leather cap right at each lug,
    // then canvas/fabric for the rest of the length including the buckle and hole sections.
    canvasAlligatorMix: boolean;
};

function findAttribute(attributes: Attribute[], attrName: string): string | undefined {
    const attr = attributes.find((a) => a.name?.toLowerCase() === attrName.toLowerCase());
    return attr?.options?.[0];
}

// The site's real thickness selector offers exactly 5 named tiers, each with a fixed mm range
// (first number = thick end, second = thin end near the buckle — same format as the raw
// `Thickness` attribute values). A 6th "Customize thickness" option lets customers enter an
// arbitrary mm value that won't match any tier exactly — for those we classify by nearest tier
// (smallest absolute difference against the tier's thick-end mm number), so every real value
// still maps to one of the 5 known descriptions instead of falling through to nothing.
const THICKNESS_TIERS: { tier: StrapProfile['thickness']; mm: number }[] = [
    { tier: 'slim', mm: 2.0 },
    { tier: 'standard', mm: 2.5 },
    { tier: 'thick', mm: 3.5 },
    { tier: 'super-thick', mm: 4.5 },
    { tier: 'over-thick', mm: 5.5 },
];

// Thickness values look like "2.5mm - 1.8mm" or, for products offering a choice of thicknesses,
// multiple options like ["4.3mm - 3.5mm", "5.3mm - 4.5mm", "6.3mm - 5.5mm"]. We only classify
// when there's exactly one option — with several choices we can't know which one the customer
// picked (this app has no thickness selector), so guessing would be wrong.
function classifyThickness(attributes: Attribute[]): StrapProfile['thickness'] {
    const attr = attributes.find((a) => a.name?.toLowerCase() === 'thickness');
    if (!attr || attr.options.length !== 1) return 'standard';
    const match = attr.options[0].match(/(\d+(\.\d+)?)\s*mm/);
    if (!match) return 'standard';
    const mm = parseFloat(match[1]);

    let nearest = THICKNESS_TIERS[0];
    for (const candidate of THICKNESS_TIERS) {
        if (Math.abs(candidate.mm - mm) < Math.abs(nearest.mm - mm)) nearest = candidate;
    }
    return nearest.tier;
}

export function classifyStrap(name: string, categoryNames: string[], attributes: Attribute[] = []): StrapProfile {
    const haystackName = name || '';
    const haystackCategories = (categoryNames || []).join(' | ');
    const isVintage = /vintage/i.test(haystackCategories) || /vintage/i.test(haystackName);

    // Padded
    const paddedAttr = findAttribute(attributes, 'Padded');
    const padded = paddedAttr
        ? paddedAttr.toLowerCase() !== 'flat'
        : /padded/i.test(haystackCategories) || /padded/i.test(haystackName);

    // Habana material + padded is a distinct construction (see StrapProfile['habanaBuckleSidePadding']
    // doc comment) — only meaningful combined with `padded`, computed after it above.
    const materialAttr = findAttribute(attributes, 'Material');
    const habanaBuckleSidePadding = padded && !!materialAttr && /habana/i.test(materialAttr);

    // Double vs single padded ridge — see StrapProfile['doublePadded'] doc comment.
    const doublePadded = padded && /double\s*padded/i.test(haystackName);

    // Mixed-material construction — see StrapProfile['canvasAlligatorMix'] doc comment. Matches
    // both "Canvas mix Alligator" and "Sailcloth Mix ... Alligator" name/category variants seen
    // in the real catalog.
    const canvasAlligatorMix = /(canvas|sailcloth)\s*mix\s*.*alligator/i.test(haystackCategories)
        || /(canvas|sailcloth)\s*mix\s*.*alligator/i.test(haystackName);

    // Curved end
    const curvedEndAttr = findAttribute(attributes, 'Curved End');
    const curvedEnd = curvedEndAttr
        ? curvedEndAttr.toLowerCase() === 'yes'
        : /curved end/i.test(haystackCategories) || /curved end/i.test(haystackName);

    // Folded edge (new — only available via attribute, no prior name/category fallback existed)
    const foldedEdgeAttr = findAttribute(attributes, 'Folded Edge');
    const foldedEdge = foldedEdgeAttr ? foldedEdgeAttr.toLowerCase() === 'yes' : false;

    // Tip shape (new — only available via attribute)
    const tipShapeAttr = findAttribute(attributes, 'Tip Shape');
    let tipShape: StrapProfile['tipShape'] = 'regular';
    if (tipShapeAttr) {
        if (/square/i.test(tipShapeAttr)) tipShape = 'square';
        else if (/oval/i.test(tipShapeAttr)) tipShape = 'oval';
        else if (/pilot/i.test(tipShapeAttr)) tipShape = 'pilot';
    }

    // Stitch
    const stitchAttr = findAttribute(attributes, 'Style of Stitch');
    let stitch: StrapProfile['stitch'];
    if (stitchAttr) {
        if (/no stitch/i.test(stitchAttr)) stitch = 'none';
        else if (/micro/i.test(stitchAttr)) stitch = 'micro';
        else if (/double/i.test(stitchAttr)) stitch = 'double';
        else if (/box/i.test(stitchAttr)) stitch = 'box';
        else stitch = 'standard'; // e.g. "Classic Stitches" or an unrecognized value
    } else if (/micro stitch/i.test(haystackName)) {
        stitch = 'micro';
    } else if (/double stitch(ing)?/i.test(haystackName)) {
        stitch = 'double';
    } else if (isVintage) {
        // Vintage-construction straps are traditionally raw-edge/burnished, not top-stitched —
        // assume no stitching unless the name explicitly calls out a stitch style.
        stitch = 'none';
    } else {
        stitch = 'standard';
    }

    return {
        style: isVintage ? 'vintage' : 'classic',
        padded,
        curvedEnd,
        foldedEdge,
        stitch,
        tipShape,
        thickness: classifyThickness(attributes),
        habanaBuckleSidePadding,
        doublePadded,
        canvasAlligatorMix,
    };
}

// Builds the extra prompt clause for a strap's profile. Returns an empty string for a plain
// classic / non-padded / non-curved / standard-stitch / non-folded / regular-tip strap, so the
// prompt sent to FLUX for the common case stays byte-identical to before this feature existed —
// only genuinely non-default, merchant-confirmed traits get an extra sentence.
export function buildStrapProfileClause(profile: StrapProfile): string {
    const sentences: string[] = [];

    if (profile.canvasAlligatorMix) {
        sentences.push(
            "This strap is a mixed-material construction, not a single uniform material: a short leather cap section with an alligator/croc scale pattern covers only the part nearest the spring bars and lugs at each end, and the remaining majority of the strap's length — including the tail toward the buckle and holes — is a woven canvas/fabric texture, not leather. Reproduce both materials exactly as shown in image 2, with a clean stitched transition seam where the alligator leather cap meets the canvas section near each lug — do not render the entire strap as one uniform material.",
        );
    }

    if (profile.style === 'vintage') {
        sentences.push(
            "This is a vintage-style strap: render its leather with a flat, smooth, understated surface — no raised or puffy padding, no glossy sheen, a worn-in matte vintage character.",
        );
    } else if (profile.habanaBuckleSidePadding) {
        const ridgeDescription = profile.doublePadded
            ? 'two parallel raised padded ridges of equal width and height, running smoothly side by side as one continuous double band — not uneven, not offset, not broken into separate disconnected bumps'
            : 'a single raised padded ridge with a wavy, rippled leather surface texture along it (not smooth or flat)';
        sentences.push(
            `This strap's padded construction differs from typical padded straps: it has ${ridgeDescription}, but only as a short raised section concentrated near the buckle and the curved tip end — the leather near the spring bars and lugs stays flat and unpadded, not puffy. Preserve this short, localized ridge placement; do not extend the padding along the strap's full length.`,
        );
    } else if (profile.padded) {
        const ridgeDescription = profile.doublePadded
            ? 'two parallel raised padded ridges running side by side down its length'
            : 'raised, slightly puffy edges along both sides';
        sentences.push(
            `This strap has a padded construction: preserve its ${ridgeDescription} rather than flattening them.`,
        );
    }

    if (profile.curvedEnd) {
        sentences.push(
            'The strap ends are gently curved and contoured where they meet the case lugs, not squared off — preserve this curved end shape.',
        );
    }

    if (profile.foldedEdge) {
        sentences.push(
            'The strap edge is a folded-and-stitched construction, not a raw cut edge — reproduce this folded edge finish.',
        );
    }

    if (profile.tipShape === 'square') {
        sentences.push('The strap tip is squared off, not pointed — reproduce this square tip shape.');
    } else if (profile.tipShape === 'oval') {
        sentences.push('The strap tip is rounded/oval, not pointed — reproduce this rounded tip shape.');
    } else if (profile.tipShape === 'pilot') {
        sentences.push('The strap has a pilot-style tip shape — reproduce this exact tip design.');
    }

    if (profile.thickness === 'slim') {
        sentences.push('This strap has a slim, thin leather profile — render its edge as sleek and low-profile, not bulky.');
    } else if (profile.thickness === 'thick') {
        sentences.push('This strap has a noticeably thick leather profile — render its edge with visible depth, not thin or flat.');
    } else if (profile.thickness === 'super-thick') {
        sentences.push('This strap has a very thick, substantial leather profile — render its edge with pronounced depth and a robust, heavy-duty feel.');
    } else if (profile.thickness === 'over-thick') {
        sentences.push('This strap has an extremely thick, heavy-duty leather profile — render its edge as noticeably bold and substantial, the thickest end of the range.');
    }

    if (profile.stitch === 'micro') {
        sentences.push('The stitching is fine micro-stitching, tightly spaced — reproduce this delicate stitch detail exactly.');
    } else if (profile.stitch === 'double') {
        sentences.push('The stitching is bold double-stitching with two visible parallel stitch lines — reproduce this exact stitch style.');
    } else if (profile.stitch === 'box') {
        sentences.push('The stitching follows a box-stitch pattern along the edges — reproduce this exact box-stitch style.');
    } else if (profile.stitch === 'none') {
        sentences.push(
            'This strap has no visible stitching at all — a clean, smooth raw or burnished edge, no stitch lines, no thread, no seams of any kind visible; do not add any stitching.',
        );
    }

    return sentences.length > 0 ? ' ' + sentences.join(' ') : '';
}
