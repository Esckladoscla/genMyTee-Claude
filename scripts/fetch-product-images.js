// scripts/fetch-product-images.js
// Enriquece data/products.json con imágenes reales de Printful.
//
// Uso:
//   node scripts/fetch-product-images.js            # actualiza todos los productos sin image_url
//   node scripts/fetch-product-images.js --force     # sobreescribe todas las imágenes
//
// Requiere: PRINTFUL_API_KEY en el entorno.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const API_KEY = process.env.PRINTFUL_API_KEY;
if (!API_KEY) {
  console.error('ERROR: faltan credenciales. Exporta PRINTFUL_API_KEY.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes('--force');

const H = { Authorization: `Bearer ${API_KEY}` };

async function getJSON(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status} ${r.statusText} -> ${t}`);
  }
  return r.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function readJSON(relPath) {
  const full = path.resolve(__dirname, '..', relPath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function writeJSON(relPath, data) {
  const full = path.resolve(__dirname, '..', relPath);
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

(async () => {
  const productsData = readJSON('data/products.json');
  const productIds = readJSON('data/printful_product_ids.json');
  const products = productsData.products;

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    // Skip if already has image_url and not forcing
    if (product.image_url && !force) {
      console.log(`[skip] ${product.slug} — ya tiene image_url`);
      skipped++;
      continue;
    }

    // Find Printful product ID
    const pfId = productIds[product.product_key];
    if (!pfId) {
      console.warn(`[warn] ${product.slug} — product_key "${product.product_key}" no encontrado en printful_product_ids.json`);
      failed++;
      continue;
    }

    try {
      console.log(`[fetch] ${product.slug} (Printful ID: ${pfId})...`);
      const detail = await getJSON(`https://api.printful.com/products/${pfId}`);

      // Main product image
      const mainImage = detail?.result?.product?.image;
      if (mainImage) {
        product.image_url = mainImage;
      }

      // Color-specific images from variants
      const variants = detail?.result?.variants || [];
      if (variants.length > 0 && product.colors?.length > 0) {
        const colorImages = {};
        for (const color of product.colors) {
          const colorLower = color.toLowerCase();
          const match = variants.find(v =>
            v.color?.toLowerCase() === colorLower ||
            v.name?.toLowerCase().includes(colorLower)
          );
          if (match?.image) {
            colorImages[color] = match.image;
          }
        }
        if (Object.keys(colorImages).length > 0) {
          product.color_images = colorImages;
        }
      }

      console.log(`  ✅ image_url: ${product.image_url ? 'OK' : 'MISSING'}, color_images: ${Object.keys(product.color_images || {}).length}`);
      updated++;
    } catch (err) {
      console.error(`  ❌ Error fetching ${product.slug}: ${err.message}`);
      failed++;
    }

    // Rate limit delay
    await sleep(500);
  }

  writeJSON('data/products.json', productsData);
  console.log(`\n✅ Completado: ${updated} actualizados, ${skipped} omitidos, ${failed} fallidos`);
})();
