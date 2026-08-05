export const maxDuration = 60; // Avoids a Vercel timeout error

import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import sharp from 'sharp';
import { getObjectBuffer } from '@/lib/aws';
import { classifyStrap, buildStrapProfileClause } from '@/lib/strapProfile';

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

// faceImage comes from 1 of 2 sources: a customer-uploaded/cropped photo (base64 data URI),
// or a pick from the S3 library (marked with the "s3://<key>" prefix).
async function loadFaceBuffer(faceImage: string): Promise<Buffer> {
    if (faceImage.startsWith('s3://')) {
        const { buffer } = await getObjectBuffer(faceImage.slice('s3://'.length));
        return buffer;
    }
    const base64Data = faceImage.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64Data, 'base64');
}

export async function POST(request: Request) {
    try {
        const { strapImage, faceImage, strapName = '', strapCategories = [], strapAttributes = [] } = await request.json();

        if (!strapImage || !faceImage) {
            return NextResponse.json({ error: 'Missing image data' }, { status: 400 });
        }

        // Log the exact request inputs so a bad output can be correlated back to what was actually
        // sent, without dumping full base64 payloads into the logs.
        console.log("📥 /api/generate request:", {
            strapImage: strapImage.startsWith('http') ? strapImage : `${strapImage.slice(0, 40)}...(base64)`,
            faceImage: faceImage.startsWith('s3://') ? faceImage : `${faceImage.slice(0, 40)}...(base64)`,
            strapName,
            strapCategories,
            strapAttributes,
        });

        // Classify the strap's real construction (classic/vintage, padded, curved end, folded
        // edge, tip shape, stitch style) — prefers the product's real WooCommerce attributes
        // (merchant-entered facts, ~86% catalog coverage) over guessing from name/category text.
        const strapProfile = classifyStrap(strapName, strapCategories, strapAttributes);
        const strapProfileClause = buildStrapProfileClause(strapProfile);

        // 1. Read the watch face image (base64 or from the S3 library)
        const faceBuffer = await loadFaceBuffer(faceImage);

        // 2. Read the watch strap image
        let strapBuffer: Buffer;
        if (strapImage.startsWith('http')) {
            const res = await fetch(strapImage);
            if (!res.ok) throw new Error("Could not download the watch strap image from its URL");
            strapBuffer = Buffer.from(await res.arrayBuffer());
        } else {
            const strapBase64Data = strapImage.replace(/^data:image\/\w+;base64,/, "");
            strapBuffer = Buffer.from(strapBase64Data, 'base64');
        }

        // 3. Normalize the strap image to a single fixed cap (shrink only, never enlarge) before generating:
        // strap photos in the library vary wildly in resolution (800px → 4000px+); sending the original as-is
        // forces the model to downsample on its own — the more detail in the source, the easier it is for it
        // to misread/redraw the pattern. Normalizing to one consistent level keeps every strap photo "read"
        // the same way on every run.
        // Was lowered from 1600 to 1200 to cut total pixel volume sent (3 images) → faster generation,
        // but that cost real pattern detail on busy/fine textures — raised back to the
        // previously-confirmed-good 1600 after the user reported detail loss on detailed strap photos.
        const STRAP_MAX_DIMENSION = 1600;
        const strapResize = {
            width: STRAP_MAX_DIMENSION,
            height: STRAP_MAX_DIMENSION,
            fit: 'inside' as const,
            withoutEnlargement: true
        };

        const strapMeta = await sharp(strapBuffer).metadata();
        const strapResizedWidth = Math.min(strapMeta.width ?? STRAP_MAX_DIMENSION, STRAP_MAX_DIMENSION);
        const strapResizedHeight = Math.min(strapMeta.height ?? STRAP_MAX_DIMENSION, STRAP_MAX_DIMENSION);

        // 4. Size the watch face as a fraction of the strap's (normalized) width instead of the face
        // photo's own native resolution — the old `faceWidth / N` formula was completely decoupled from
        // the strap, so every strap+face pairing landed at a random, often-oversized ratio (face source
        // photos vary in native resolution for reasons unrelated to real watch proportions). Anchoring to
        // the strap's own width keeps the case-to-strap ratio consistent across every pairing, calibrated
        // against the one pairing (python-leather strap + Lange face) that already looked correct.
        // Went 0.23 → 0.20 (confirmed good) → 0.10 → 0.07 chasing a smaller case, but 0.07 combined
        // with an overly strict prompt caused the model to badly misassemble the watch (forked the
        // strap into two separate bands instead of one). Rolled back to 0.20, then nudged to 0.16 —
        // paired this time with padding the face reference image itself (see faceReferenceBuffer
        // below) rather than relying on the draft ratio or prompt text alone.
        const FACE_TO_STRAP_WIDTH_RATIO = 0.16;
        const targetFaceWidth = Math.round(strapResizedWidth * FACE_TO_STRAP_WIDTH_RATIO);

        console.log(`🛠️ Resizing watch face to ${targetFaceWidth}px (${Math.round(FACE_TO_STRAP_WIDTH_RATIO * 100)}% of strap width ${strapResizedWidth}px)`);

        const resizedFace = await sharp(faceBuffer)
            .resize({ width: targetFaceWidth })
            .png()
            .toBuffer();
        const resizedFaceMeta = await sharp(resizedFace).metadata();
        const resizedFaceHeight = resizedFaceMeta.height ?? targetFaceWidth;

        // 5. Build 3 reference images to send: (1) a rough draft composite, only to hint at
        // layout/scale, (2) a CLEAN strap image (no face pasted on) as the exact texture/pattern
        // reference, (3) a CLEAN, higher-resolution watch face image as the exact case/dial reference.
        // Previously only 1 flattened composite was sent — the model had no clean original to check
        // against, so it was prone to both redrawing the pattern and misplacing the watch face on
        // detailed strap photos.
        const strapReferenceBuffer = await sharp(strapBuffer)
            .resize(strapResize)
            .png()
            .toBuffer();

        // Real watch straps are asymmetric: the end nearer the buckle is shorter than the end with
        // the holes/tail. `gravity: 'center'` placed the face at dead-center, making both halves look
        // equal — unrealistic, and (per the case-size lesson above) this visual cue in the draft/prompt
        // matters more to the model than text alone. SHORT_END_TOP_RATIO < 0.5 shifts the face upward
        // so the top (buckle) segment is visibly shorter than the bottom (tail) segment.
        // 0.42 produced only a mild, easy-to-miss difference in real generations (user flagged it as
        // still looking near-equal). 0.33 was still not consistently obeyed by the model (one real test
        // came back ~75% instead of the intended ~41%) — dropped further to 0.28 to push the draft's
        // visual cue harder, paired with an explicit numeric target in the prompt text below.
        const SHORT_END_TOP_RATIO = 0.28;
        const faceTop = Math.max(0, Math.round(strapResizedHeight * SHORT_END_TOP_RATIO - resizedFaceHeight / 2));
        const faceLeft = Math.max(0, Math.round((strapResizedWidth - targetFaceWidth) / 2));

        const draftCompositeBuffer = await sharp(strapReferenceBuffer)
            .composite([
                {
                    input: resizedFace,
                    top: faceTop,
                    left: faceLeft
                }
            ])
            .png()
            .toBuffer();

        // Previously this just filled the whole STRAP_MAX_DIMENSION frame edge-to-edge — which gave the
        // model a strong VISUAL cue that the watch is a "large" object, regardless of what the prompt or
        // the draft's tiny pasted face said (real-world testing showed the model leans on this visual
        // scale cue more than on text instructions). Now the face is resized modestly and padded with
        // white space on a same-size canvas, so image 3 itself reads as a small object, consistent with
        // the intended proportions.
        const FACE_DETAIL_WIDTH_RATIO = 0.40;
        const faceDetailBuffer = await sharp(faceBuffer)
            .resize({ width: Math.round(STRAP_MAX_DIMENSION * FACE_DETAIL_WIDTH_RATIO) })
            .png()
            .toBuffer();

        const faceReferenceBuffer = await sharp({
            create: {
                width: STRAP_MAX_DIMENSION,
                height: STRAP_MAX_DIMENSION,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        })
            .composite([{ input: faceDetailBuffer, gravity: 'center' }])
            .png()
            .toBuffer();

        const draftCompositeDataUri = `data:image/png;base64,${draftCompositeBuffer.toString('base64')}`;
        const strapReferenceDataUri = `data:image/png;base64,${strapReferenceBuffer.toString('base64')}`;
        const faceReferenceDataUri = `data:image/png;base64,${faceReferenceBuffer.toString('base64')}`;

        console.log("🚀 Sending 3 reference images (draft composite + strap original + face original) for precise assembly...");

        // 6. CALL THE MODEL WITH 3 REFERENCE IMAGES
        const replicateInput = {
            seed: 19826,
            prompt: "Image 1 shows the required composition, scale, and placement — the watch head positioned between two strap ends, compact and modest in size relative to the strap. Image 2 is the exact texture/color/grain reference for the watch strap only, not a length-ratio reference even if it looks symmetric — reproduce its leather color, pattern, stitching, grain, and edge finishing pixel-for-pixel, ignoring its background; if image 2 shows the strap staged on or beside larger leather hides or swatches used as a photography backdrop, the actual product is only the narrow strip with a buckle and/or punched holes — use that strip's material only, completely disregarding the larger background leather pieces, even when those background pieces occupy most of the frame and the actual strap is a small diagonal object within it; zoom in mentally on just that small strap object and copy its exact color and scale pattern, including any faint color undertones such as green, blue, or purple patina — do not default to a generic brown or plain black leather when the reference photo is dark, busy, or hard to parse. Image 3 is the exact shape/design reference for the case and dial only, not a scale reference even though it fills its own frame — reproduce its case shape, dial design, hands, indices, subdials, crown, and lugs identical, ignoring its background. If the photo shows a human hand, fingers, wrist, or skin holding, wearing, or framing the watch, treat that as part of the disregarded background too — extract only the watch case and dial itself, exactly as if it were a clean studio product photo from an existing reference library, and never reproduce any hand, finger, skin, or wrist tone anywhere in the final result. Using image 1 only for scale and placement, assemble one complete, photorealistic wristwatch: the strap is a single continuous piece threaded through the case on both sides via a physically correct spring bar under the four lugs, matching strap width to the inner lug spacing — never two parallel strap pieces on one side, and never two disconnected or floating strap segments that fail to connect to the case. Segment lengths follow image 1 and this rule, not image 2: the buckle-side segment must be clearly and noticeably shorter than the holes-side segment, roughly 40-50% of its length — never equal or near-equal, even if the strap reference photo looks close to symmetric. Only refine the small transition areas where the strap meets the lugs — do not redesign, simplify, duplicate, or reinterpret any part of the strap or watch case. The result must be centered, perfectly symmetrical left-to-right, photographed top-down in sharp 8k focus with soft professional studio lighting and shadows, on a pure solid light-gray or white studio background." + strapProfileClause,
            resolution: "2 MP",
            aspect_ratio: "9:16",
            input_images: [draftCompositeDataUri, strapReferenceDataUri, faceReferenceDataUri],
            output_format: "webp",
            output_quality: 90,
            safety_tolerance: 5,
            prompt_upsampling: false
        };

        // Replicate's safety filter occasionally throws a transient "E005 flagged as sensitive"
        // false positive on completely normal inputs — an identical retry succeeds immediately.
        // Retry once so a random false positive doesn't surface as a failed generation to the customer.
        let output: any;
        try {
            output = await replicate.run("black-forest-labs/flux-2-pro", { input: replicateInput });
        } catch (err: any) {
            const isFlaggedSensitive = String(err?.message ?? err).includes('E005') || String(err?.message ?? err).toLowerCase().includes('flagged as sensitive');
            if (!isFlaggedSensitive) throw err;
            console.warn("⚠️ Replicate flagged the request as sensitive (likely a false positive) — retrying once...");
            output = await replicate.run("black-forest-labs/flux-2-pro", { input: replicateInput });
        }

        console.log("✅ Processing complete.");

        if (!output) throw new Error("Did not receive a valid result. Please try again.");
        const imageUrl = typeof output === 'string' ? output : output.url();

        return NextResponse.json({ success: true, resultImage: imageUrl });

    } catch (error: any) {
        console.error("❌ Processing error:", error);
        return NextResponse.json({ success: false, error: "Something went wrong while generating your preview. Please try again." }, { status: 500 });
    }
}
