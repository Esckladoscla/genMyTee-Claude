// scripts/fetch-variants.js
// Uso:
//   node scripts/fetch-variants.js "<busqueda printful>" --key "<product_key>" --type normal|aop
//   node scripts/fetch-variants.js --id <PRODUCT_ID> --key "<product_key>" --type normal|aop
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

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const search = process.argv.slice(2).find(a => !a.startsWith('--')) || '';
const forcedId = Number(argVal('--id'));
const productKey = argVal('--key');
const type = (argVal('--type') || '').toLowerCase();

if (!productKey || !['normal', 'aop'].includes(type)) {
  console.log('Uso: node scripts/fetch-variants.js "<busqueda>" --key "<product_key>" --type normal|aop');
  console.log('     node scripts/fetch-variants.js --id <PRODUCT_ID> --key "<product_key>" --type normal|aop');
  process.exit(1);
}

const H = { Authorization: `Bearer ${API_KEY}` };

async function getJSON(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status} ${r.statusText} -> ${t}`);
  }
  return r.json();
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/\s*&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pickBestProduct(list, q) {
  if (!list?.length) return null;
  const want = q ? norm(q) : '';
  // 1) exacto por model_code o nombre
  let best = list.find(p => norm(p.model_code) === want || norm(p.name) === want);
  if (best) return best;
  // 2) contiene
  best = list.find(p => norm(p.name).includes(want) || norm(p.model_code).includes(want));
  return best || list[0];
}

function readVariantsMap() {
  const candidates = [
    path.resolve(process.cwd(), 'variants-map.json'),
    path.resolve(process.cwd(), 'data/variants-map.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      return { map: JSON.parse(raw), file: p };
    } catch {}
  }
  // por defecto, en la raíz del proyecto
  return { map: {}, file: path.resolve(process.cwd(), 'variants-map.json') };
}

function writeVariantsMap(file, map) {
  fs.writeFileSync(file, JSON.stringify(map, null, 2), 'utf8');
  console.log(`\n✅ Actualizado ${file}`);
}

function summarize(obj) {
  console.log('Resumen:');
  console.log(JSON.stringify(obj, null, 2));
}

(async () => {
  try {
    let productId = forcedId || null;

    if (!productId) {
      if (!search) {
        console.error('Debes indicar una búsqueda o usar --id <PRODUCT_ID>.');
        process.exit(1);
      }
      const sUrl = 'https://api.printful.com/products?search=' + encodeURIComponent(search);
      const s = await getJSON(sUrl);
      const best = pickBestProduct(s.result, search);
      if (!best) {
        console.error('No se encontraron productos para la búsqueda:', search);
        process.exit(1);
      }
      productId = best.id;
      console.log(`[match] id=${best.id} name="${best.name}" code="${best.model_code}"`);
    } else {
      const p = await getJSON(`https://api.printful.com/products/${productId}`);
      console.log(`[match] id=${productId} name="${p.result.product.name}" code="${p.result.product.model_code}"`);
    }

    const detail = await getJSON(`https://api.printful.com/products/${productId}`);
    const variants = detail?.result?.variants || [];

    if (!variants.length) {
      console.error('El producto no tiene variantes.');
      process.exit(1);
    }

    let entry;

    if (type === 'aop') {
      // size -> { variant_id }
      entry = {};
      for (const v of variants) {
        const size = v.size?.toUpperCase();
        if (!size) continue;
        entry[size] = { variant_id: v.id };
      }
    } else {
      // normal: color -> size -> { variant_id }
      entry = {};
      for (const v of variants) {
        const color = v.color?.trim();
        const size = v.size?.toUpperCase();
        if (!color || !size) continue;
        entry[color] ||= {};
        entry[color][size] = { variant_id: v.id };
      }
    }

    const { map, file } = readVariantsMap();
    map[productKey] = entry;
    writeVariantsMap(file, map);
    summarize(entry);
  } catch (e) {
    console.error('ERROR:', e.message || e);
    process.exit(1);
  }
})();
