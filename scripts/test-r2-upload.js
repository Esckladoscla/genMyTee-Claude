// test-r2-upload.js  (ESM)
import 'dotenv/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadImageBuffer } from '../services/storage.js';


const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_BASE_URL) {
  throw new Error('Faltan variables R2_* en .env');
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const key = `printful/test-${Date.now()}.png`;
const png1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HwAFgwJ3b9sJxQAAAABJRU5ErkJggg==',
  'base64'
);

await r2.send(new PutObjectCommand({
  Bucket: R2_BUCKET,
  Key: key,
  Body: png1x1,
  ContentType: 'image/png',
  CacheControl: 'public, max-age=31536000, immutable'
}));

const url = `${R2_PUBLIC_BASE_URL}/${key}`;
console.log('R2 URL:', url);
