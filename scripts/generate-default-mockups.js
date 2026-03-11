/**
 * generate-default-mockups.js
 *
 * Generates Printful mockups for all customizable products using a default
 * design image. Calls our own API endpoint which handles variant resolution
 * and Printful integration.
 *
 * Usage:
 *   node scripts/generate-default-mockups.js
 *   node scripts/generate-default-mockups.js --base-url https://genmytee.com
 *   node scripts/generate-default-mockups.js --base-url http://localhost:3000
 *
 * Requirements:
 *   - The server at --base-url must be running
 *   - The server must have PRINTFUL_API_KEY configured
 *   - The image at /img/hero.png must be publicly accessible from Printful
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = join(__dirname, '..', 'data', 'products.json');

const DEFAULT_BASE_URL = 'https://genmytee.com';
const DEFAULT_IMAGE_PATH = '/img/hero.png';
const DELAY_MS = 2000;

function parseArgs() {
  const args = process.argv.slice(2);
  let baseUrl = DEFAULT_BASE_URL;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--base-url=')) {
      baseUrl = args[i].split('=')[1];
    } else if (args[i] === '--base-url' && args[i + 1]) {
      baseUrl = args[++i];
    }
  }

  return { baseUrl };
}

async function pollMockup(baseUrl, taskKey, attempt = 0) {
  if (attempt > 20) return { mockup_status: 'timeout' };

  await new Promise(r => setTimeout(r, 3500));

  const res = await fetch(
    `${baseUrl}/api/preview/mockup/status?task_key=${encodeURIComponent(taskKey)}`
  );
  const data = await res.json();

  if (data.mockup_status === 'completed') return data;
  if (data.mockup_status === 'failed') return data;

  process.stdout.write('.');
  return pollMockup(baseUrl, taskKey, attempt + 1);
}

async function generateMockupForProduct(baseUrl, imageUrl, product) {
  const color = product.colors?.[0];
  const size = product.sizes?.includes('M') ? 'M' : (product.sizes?.[0] || 'M');
  const variantTitle = color ? `${color} / ${size}` : size;

  const res = await fetch(`${baseUrl}/api/preview/mockup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      pf_product_key: product.product_key,
      variant_title: variantTitle,
    }),
  });

  let data = await res.json();

  // If still processing, poll until done
  if (data.ok && data.task_key && data.mockup_status === 'processing') {
    process.stdout.write('  polling');
    data = await pollMockup(baseUrl, data.task_key);
    process.stdout.write('\n');
  }

  return data;
}

async function main() {
  const { baseUrl } = parseArgs();
  const imageUrl = `${baseUrl}${DEFAULT_IMAGE_PATH}`;

  console.log(`Base URL:  ${baseUrl}`);
  console.log(`Image URL: ${imageUrl}`);
  console.log();

  const raw = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));
  const products = raw.products;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];

    if (!product.customizable) {
      console.log(`[${i + 1}/${products.length}] skip  ${product.slug} (not customizable)`);
      skipped++;
      continue;
    }

    // Skip if already has a default mockup (use --force to regenerate)
    if (product.default_mockup_url && !process.argv.includes('--force')) {
      console.log(`[${i + 1}/${products.length}] skip  ${product.slug} (already has mockup)`);
      skipped++;
      continue;
    }

    const color = product.colors?.[0];
    const size = product.sizes?.includes('M') ? 'M' : (product.sizes?.[0] || 'M');
    const variantTitle = color ? `${color} / ${size}` : size;

    console.log(`[${i + 1}/${products.length}] gen   ${product.slug} (${variantTitle})`);

    try {
      const data = await generateMockupForProduct(baseUrl, imageUrl, product);

      if (data.mockup_url) {
        product.default_mockup_url = data.mockup_url;
        // Keep up to 4 angles for gallery
        if (data.mockup_urls?.length > 0) {
          product.default_mockup_urls = data.mockup_urls.slice(0, 4);
        }
        updated++;
        console.log(`  OK  ${data.mockup_urls?.length || 1} mockup(s)`);
      } else {
        failed++;
        console.log(`  FAIL  ${data.mockup_status || 'unknown'}: ${data.reason || 'no reason'}`);
      }
    } catch (err) {
      failed++;
      console.error(`  ERROR  ${err.message}`);
    }

    // Delay between requests
    if (i < products.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Save updated products.json
  writeFileSync(PRODUCTS_PATH, JSON.stringify(raw, null, 2) + '\n');

  console.log();
  console.log(`Done: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
