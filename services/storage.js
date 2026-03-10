import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import path from "node:path";
import { requireEnv } from "./env.js";

let s3;

function getS3Client() {
  if (s3) return s3;

  const endpoint = `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  return s3;
}

export async function uploadImageBuffer(
  buffer,
  {
    filename = `art-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`,
    folder = "printful",
  } = {}
) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('uploadImageBuffer: "buffer" must be a Buffer');
  }

  const key = path.posix.join(folder, filename.replace(/\.[^.]+$/, "") + ".png");

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: requireEnv("R2_BUCKET"),
      Key: key,
      Body: buffer,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  const base = requireEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
  return `${base}/${key}`;
}

export function _resetStorageClientForTests() {
  s3 = undefined;
}
