import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import clientPromise from '@/lib/mongodb';

// Fail fast with a clear message if a deployment (e.g. a Vercel environment) is missing one of
// these — otherwise the AWS SDK throws its own cryptic "No value provided for input HTTP label:
// Bucket." error deep inside a command call, which is easy to mistake for a CORS/permissions
// issue (Vercel never reads .env.local, so these must be set in the project's own env settings).
for (const name of ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET']) {
  if (!process.env[name]) {
    throw new Error(`Missing required AWS env var: ${name}`);
  }
}

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET as string;
const PREFIX = process.env.AWS_S3_FACES_PREFIX || '';
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

export type FaceItem = { key: string; name: string; category: string };

const VALID_BRANDS = new Set([
  'a-lange-sohne', 'akrivia', 'albishorn', 'alpina', 'angelus', 'anoma', 'anonimo', 'anordain',
  'audemars-piguet', 'ball', 'baltic', 'baume-mercier', 'blancpain', 'bomberg', 'breguet',
  'breitling', 'bremont', 'bulgari', 'bulova', 'candino', 'cartier', 'casio', 'certina',
  'chopard', 'chronoswiss', 'citizen', 'corniche', 'czapek', 'doxa', 'f-p-journe', 'farer',
  'fears', 'formex', 'fortis', 'frederique-constant', 'garmin', 'geckota', 'glashutte-original',
  'grand-seiko', 'gronefeld', 'h-moser', 'habring2', 'hamilton', 'hanhart', 'hermes', 'iwc',
  'jlc', 'junkers', 'kollokium', 'kuoe', 'kurono', 'laco', 'longines', 'lorca', 'mido',
  'minase', 'ming', 'montblanc', 'nodus', 'nomos', 'nuun', 'omega', 'orient', 'oris',
  'otsuka', 'panerai', 'parmigiani', 'patek-philippe', 'pequignet', 'perrelet', 'piaget',
  'ressence', 'rolex', 'seagull', 'seiko', 'shinola', 'sinn', 'steinhart', 'sugess',
  'swatch', 'tag-heuer', 'timex', 'tissot', 'titoni', 'traska', 'tudor', 'unimatic',
  'vacheron-constantin', 'venezianico', 'vostok', 'vulcain', 'weiss', 'wren', 'zelos', 'zenith'
]);

// Keys are expected as `<prefix>/<category>/<file>` — the first folder after the
// configured prefix becomes the filter category; files with no subfolder, or folders
// listed in OTHER_FOLDERS, fall back to "Others".
function deriveCategoryAndName(key: string): { category: string; name: string } {
  const relative = PREFIX && key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
  const segments = relative.split('/').filter(Boolean);
  const fileName = segments.pop() || relative;
  const rawCategory = segments.length > 0 ? segments[0] : '';
  const category = rawCategory && VALID_BRANDS.has(rawCategory.toLowerCase()) ? rawCategory : 'Others';
  const name = fileName.replace(/\.[^.]+$/, '');
  return { category, name };
}

export async function listAllFaceKeys(): Promise<FaceItem[]> {
  const items: FaceItem[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX || undefined,
      ContinuationToken: continuationToken,
    }));

    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith('/')) continue; // skip "folder" placeholder objects
      if (!IMAGE_EXT.test(obj.Key)) continue;
      items.push({ key: obj.Key, ...deriveCategoryAndName(obj.Key) });
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return items;
}

const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function getObjectBuffer(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  const ext = key.split('.').pop()?.toLowerCase() || '';

  return {
    buffer: Buffer.from(bytes),
    contentType: res.ContentType || EXT_CONTENT_TYPE[ext] || 'application/octet-stream',
  };
}

// Small resized copy for the picker grid — the originals can be several MB each,
// which is wasteful to ship for a ~100px thumbnail. /api/generate always uses the
// full-resolution getObjectBuffer above, never this, so combine quality is unaffected.
// Clean studio renders of the straps live in the same bucket as the face library, under their own
// prefix and keyed by product id. They are generated once per product and then read on every
// generation, so they belong somewhere the serverless runtime can actually reach — reading them
// off the dataset folder only ever worked on a developer's machine.
export const CLEAN_STRAP_PREFIX = process.env.AWS_S3_CLEAN_STRAP_PREFIX || 'straps-clean/';

export function cleanStrapKey(productId: number): string {
  return `${CLEAN_STRAP_PREFIX}${productId}.webp`;
}

export async function putCleanStrapRender(productId: number, body: Buffer): Promise<string> {
  const key = cleanStrapKey(productId);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/webp' }));
  return key;
}

// Replicate's `lora_weights` input accepts an arbitrary signed URL, and calling this fresh on every
// generation (rather than storing one long-lived URL) means it never has an expiry to manage. Added
// after Replicate's own weight-serving for private models broke for an entire account (both an old,
// previously-working version and a brand new one, on two different destination models) for 15+ hours
// straight, unrelated to billing — see loraEngine.ts. Hosting the weights file ourselves and handing
// Replicate a direct URL sidesteps that resolution path entirely; a short expiry is enough since the
// URL is used within the same request that generates it, never stored or reused.
export async function getPresignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresInSeconds });
}

export async function getThumbnailBuffer(key: string, width = 240): Promise<{ buffer: Buffer; contentType: string }> {
  const { buffer } = await getObjectBuffer(key);
  const resized = await sharp(buffer)
    .resize({ width })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { buffer: resized, contentType: 'image/jpeg' };
}

// Reads the synced face catalog from MongoDB (mirrors getDatabaseProducts in woocommerce.ts).
export const getDatabaseFaces = async (): Promise<FaceItem[]> => {
  try {
    const client = await clientPromise;
    const db = client.db('watch_customizer');

    const faces = await db.collection('faces').find({}).sort({ category: 1, name: 1 }).toArray();

    return faces.map((f) => ({
      key: f.key,
      name: f.name,
      category: f.category,
    })) as FaceItem[];
  } catch (error) {
    console.error('❌ Lỗi khi đọc Database (faces):', error);
    return [];
  }
};
