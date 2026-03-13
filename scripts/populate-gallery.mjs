/**
 * Populate gallery: assign existing R2 images + generate new ones via OpenAI
 * Usage: node scripts/populate-gallery.mjs
 *
 * Requires .env with OPENAI_KEY, R2_* credentials
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import OpenAI from 'openai';

const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL || 'https://assets.genmytee.com').replace(/\/+$/, '');
const BUCKET = process.env.R2_BUCKET || 'genmytee-printful';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// ── Existing R2 images mapped to curated design IDs ──────────────────
const EXISTING_IMAGE_MAP = {
  'tigre-retro': 'images/A retro geometric tiger in orange and blue.png',
  'madrid-artistica': 'images/Madrid artística.png',
  'egipto-dali': 'images/egipto estilo hiperrealismo de Dalí.png',
  'guernica-ghibli': 'images/el guernica de picasso estilo gibhi.png',
  'sol-naciente': 'images/el país del sol naciente en un estilo artístico y esperanzador.png',
  'furgoneta-hippie': 'images/estilo dibujo hippie una furgoneta estilo hippie tícipa volkswagen con colorines en grafiti en la playa del chill.png',
  'le-mans-retro': 'images/estilo retro conmemorativo de las 24 horas de le mans del wec.png',
  'futuro-humanidad': 'images/la IA representando el futuro de la humanidad, sólo se ve su silueta sobre una montaña con el sol cayendo de fondo, mientras a los pies de la montaña está toda la humanidad.png',
  'new-york-vangogh': 'images/new york estilo van gogh.png',
  'astronauta-ghibli': 'images/un astronauta estilo gibi conquistando el mundo tras las estrellas y las galaxiaspng.png',
  'oso-geometrico': 'images/un oso retro geométrico de estilo super realismo en un mix con estilo gibi.png',
  'viaje-interestelar': 'images/un viaje interestelar estilo van gogh.png',
  'rosa-cristal': 'images/una rosa geométrica encerrada en un cristal.png',
  'espacio-dali': 'images/viaje al espacio estilo hiperrealismo de Dalí.png',
  'despedida-soltera': 'images/la imagen perfecta para una camiseta de despedida de soltera desenfrenada.png',
  'tres-en-raya': 'images/3 en raya friki.png',
  'gamba-bjj': 'images/gamba bjj peleona.png',
  'gamba-bjj-2': 'images/gamba bjj peleona2.png',
  'gamba-enfurecida': 'images/gamba peleona enfurecida de bjj.png',
  'gamba-peleona': 'images/la gamba peleona de bjj.png',
  'barbie-600': 'images/una barbie en un 600 rosa de despedida de soltera.png',
  'barbie-600-real': 'images/una barbie de carne y hueso en un 600 rosa de despedida de soltera.png',
};

// ── Designs that use existing R2 images ──────────────────────────────
const EXISTING_DESIGNS = [
  {
    id: 'tigre-retro',
    title: 'Tigre Geométrico Retro',
    description: 'Tigre en estilo geométrico retro con naranjas y azules vibrantes',
    tags: ['animal', 'geometrico', 'retro'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'A retro geometric tiger in orange and blue',
    collection: 'animales',
  },
  {
    id: 'madrid-artistica',
    title: 'Madrid Artística',
    description: 'La esencia de Madrid capturada en un estilo artístico único',
    tags: ['urbano', 'cultural', 'colorido'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'Madrid artística',
    collection: 'urbano',
  },
  {
    id: 'egipto-dali',
    title: 'Egipto Surrealista',
    description: 'Las pirámides y misterios de Egipto en estilo hiperrealista de Dalí',
    tags: ['cultural', 'dorado', 'vintage'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: true,
    prompt_used: 'Egipto estilo hiperrealismo de Dalí',
    collection: 'cultural',
  },
  {
    id: 'guernica-ghibli',
    title: 'Guernica Reimaginado',
    description: 'El Guernica de Picasso reinterpretado con estilo Ghibli',
    tags: ['cultural', 'clasico', 'colorido'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'El Guernica de Picasso estilo Ghibli',
    collection: 'cultural',
  },
  {
    id: 'sol-naciente',
    title: 'Sol Naciente',
    description: 'El país del sol naciente en un estilo artístico y esperanzador',
    tags: ['japones', 'naturaleza', 'clasico'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie', 'all-over-print-mens-tank-top'],
    featured: true,
    prompt_used: 'El país del sol naciente en un estilo artístico y esperanzador',
    collection: 'arte-oriental',
  },
  {
    id: 'furgoneta-hippie',
    title: 'Furgoneta Hippie',
    description: 'Volkswagen hippie con colorines en grafiti en la playa',
    tags: ['retro', 'colorido', 'urbano'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'Furgoneta hippie Volkswagen con colorines en grafiti en la playa',
    collection: 'retro',
  },
  {
    id: 'le-mans-retro',
    title: 'Le Mans Retro',
    description: 'Homenaje retro a las míticas 24 horas de Le Mans del WEC',
    tags: ['retro', 'vintage', 'urbano'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: 'Estilo retro conmemorativo de las 24 horas de Le Mans del WEC',
    collection: 'retro',
  },
  {
    id: 'futuro-humanidad',
    title: 'El Futuro de la Humanidad',
    description: 'Silueta contemplando el futuro desde la cima de una montaña al atardecer',
    tags: ['minimalista', 'celestial', 'abstracto'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'La IA representando el futuro de la humanidad, silueta sobre una montaña con el sol cayendo',
    collection: 'cosmos',
  },
  {
    id: 'new-york-vangogh',
    title: 'New York Van Gogh',
    description: 'El skyline de Nueva York pintado al estilo de Van Gogh',
    tags: ['urbano', 'clasico', 'colorido'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'New York estilo Van Gogh',
    collection: 'urbano',
  },
  {
    id: 'astronauta-ghibli',
    title: 'Astronauta entre Galaxias',
    description: 'Astronauta conquistando las estrellas en estilo Ghibli',
    tags: ['espacio', 'retro', 'scifi'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie', 'all-over-print-mens-tank-top'],
    featured: true,
    prompt_used: 'Un astronauta estilo Ghibli conquistando el mundo tras las estrellas y las galaxias',
    collection: 'cosmos',
  },
  {
    id: 'oso-geometrico',
    title: 'Oso Geométrico',
    description: 'Oso en estilo geométrico retro mezclando super realismo y Ghibli',
    tags: ['animal', 'geometrico', 'retro'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: false,
    prompt_used: 'Un oso retro geométrico de estilo super realismo en un mix con estilo Ghibli',
    collection: 'animales',
  },
  {
    id: 'viaje-interestelar',
    title: 'Viaje Interestelar',
    description: 'Un viaje interestelar al estilo impresionista de Van Gogh',
    tags: ['espacio', 'clasico', 'colorido'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'Un viaje interestelar estilo Van Gogh',
    collection: 'cosmos',
  },
  {
    id: 'rosa-cristal',
    title: 'Rosa en Cristal',
    description: 'Rosa geométrica encerrada en un cristal brillante',
    tags: ['floral', 'geometrico', 'minimalista'],
    compatible_products: ['all-over-print-womens-crop-top', 'all-over-print-dress', 'all-over-print-womens-racerback-tank-top', 'all-over-print-mens-athletic-t-shirt'],
    featured: true,
    prompt_used: 'Una rosa geométrica encerrada en un cristal',
    collection: 'botanico',
  },
  {
    id: 'espacio-dali',
    title: 'Cosmos de Dalí',
    description: 'Viaje al espacio en el estilo hiperrealista surrealista de Dalí',
    tags: ['espacio', 'clasico', 'celestial'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: false,
    prompt_used: 'Viaje al espacio estilo hiperrealismo de Dalí',
    collection: 'cosmos',
  },
  {
    id: 'despedida-soltera',
    title: 'Fiesta Desenfrenada',
    description: 'El diseño perfecto para una despedida de soltera inolvidable',
    tags: ['colorido', 'cultural', 'neon'],
    compatible_products: ['all-over-print-womens-crop-top', 'all-over-print-dress', 'all-over-print-womens-racerback-tank-top'],
    featured: false,
    prompt_used: 'La imagen perfecta para una camiseta de despedida de soltera desenfrenada',
    collection: 'cultural',
  },
  {
    id: 'tres-en-raya',
    title: '3 en Raya Friki',
    description: 'Un clásico tres en raya con estilo friki y geek',
    tags: ['retro', 'colorido', 'abstracto'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: '3 en raya friki',
    collection: 'retro',
  },
  {
    id: 'gamba-bjj',
    title: 'Gamba Peleona BJJ',
    description: 'La mítica gamba peleona del jiu-jitsu brasileño',
    tags: ['animal', 'colorido', 'cultural'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: 'Gamba BJJ peleona',
    collection: 'animales',
  },
  {
    id: 'gamba-bjj-2',
    title: 'Gamba BJJ Combate',
    description: 'Gamba de jiu-jitsu brasileño en posición de combate',
    tags: ['animal', 'colorido', 'cultural'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: 'Gamba BJJ peleona variante 2',
    collection: 'animales',
  },
  {
    id: 'gamba-enfurecida',
    title: 'Gamba Enfurecida',
    description: 'Gamba enfurecida de BJJ lista para el tatami',
    tags: ['animal', 'colorido', 'cultural'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: 'Gamba peleona enfurecida de BJJ',
    collection: 'animales',
  },
  {
    id: 'gamba-peleona',
    title: 'La Gamba del Tatami',
    description: 'La gamba peleona de jiu-jitsu brasileño, ícono del tatami',
    tags: ['animal', 'colorido', 'cultural'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: 'La gamba peleona de BJJ',
    collection: 'animales',
  },
  {
    id: 'barbie-600',
    title: 'Barbie en 600 Rosa',
    description: 'Barbie en un SEAT 600 rosa de despedida de soltera',
    tags: ['retro', 'colorido', 'cultural'],
    compatible_products: ['all-over-print-womens-crop-top', 'all-over-print-dress', 'all-over-print-womens-racerback-tank-top'],
    featured: false,
    prompt_used: 'Una Barbie en un 600 rosa de despedida de soltera',
    collection: 'retro',
  },
  {
    id: 'barbie-600-real',
    title: 'Barbie Real en 600',
    description: 'Barbie hiperrealista en un SEAT 600 rosa para despedida',
    tags: ['retro', 'colorido', 'cultural'],
    compatible_products: ['all-over-print-womens-crop-top', 'all-over-print-dress', 'all-over-print-womens-racerback-tank-top'],
    featured: false,
    prompt_used: 'Una Barbie de carne y hueso en un 600 rosa de despedida de soltera',
    collection: 'retro',
  },
];

// ── NEW designs to generate (SEO-optimized, high-conversion) ─────────
const DESIGNS_TO_GENERATE = [
  {
    id: 'lobo-geometrico',
    title: 'Lobo Geométrico',
    description: 'Lobo majestuoso en triángulos degradados, estilo low poly moderno',
    tags: ['animal', 'geometrico', 'minimalista'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-womens-crop-top', 'all-over-print-mens-tank-top'],
    featured: true,
    prompt_used: 'Lobo geométrico majestuoso en triángulos degradados azules y morados, estilo low poly sobre fondo oscuro',
    collection: 'animales',
  },
  {
    id: 'ola-japonesa',
    title: 'Ola Japonesa',
    description: 'La gran ola en estilo ukiyo-e japonés moderno y vibrante',
    tags: ['japones', 'oceano', 'clasico'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'Gran ola oceánica estilo ukiyo-e japonés moderno con espuma blanca detallada y cielo dramático, colores azul profundo y blanco',
    collection: 'arte-oriental',
  },
  {
    id: 'flores-botanicas',
    title: 'Flores Botánicas',
    description: 'Flores silvestres en acuarela delicada sobre fondo claro',
    tags: ['floral', 'acuarela', 'botanico'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-womens-crop-top', 'all-over-print-womens-racerback-tank-top', 'all-over-print-dress'],
    featured: true,
    prompt_used: 'Composición de flores silvestres botánicas en acuarela delicada, lavanda, amapolas y margaritas sobre fondo blanco crema',
    collection: 'botanico',
  },
  {
    id: 'dragon-chino',
    title: 'Dragón Chino',
    description: 'Dragón serpenteante majestuoso en tinta china tradicional',
    tags: ['animal', 'japones', 'cultural'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie', 'all-over-print-mens-tank-top'],
    featured: true,
    prompt_used: 'Dragón chino serpenteante majestuoso en tinta china negra sobre fondo de pergamino dorado, estilo tradicional con nubes',
    collection: 'arte-oriental',
  },
  {
    id: 'leon-corona',
    title: 'León con Corona',
    description: 'León majestuoso con corona dorada en retrato renacentista',
    tags: ['animal', 'dorado', 'clasico'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'Retrato majestuoso de león con corona dorada y melena espectacular, estilo pintura renacentista sobre fondo oscuro dramático',
    collection: 'animales',
  },
  {
    id: 'fenix-fuego',
    title: 'Fénix en Llamas',
    description: 'Ave fénix renaciendo entre llamas doradas y naranjas',
    tags: ['animal', 'dorado', 'colorido'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie', 'all-over-print-mens-tank-top'],
    featured: true,
    prompt_used: 'Ave fénix majestuosa renaciendo entre llamas doradas y naranjas con alas extendidas, fondo oscuro con chispas',
    collection: 'animales',
  },
  {
    id: 'samurai-cerezo',
    title: 'Samurái y Cerezo',
    description: 'Samurái bajo lluvia de pétalos de cerezo, estilo ukiyo-e',
    tags: ['japones', 'cultural', 'clasico'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top', 'all-over-print-unisex-hoodie'],
    featured: true,
    prompt_used: 'Samurái de espaldas con katana bajo lluvia de pétalos de cerezo rosa, estilo ukiyo-e japonés con luna llena',
    collection: 'arte-oriental',
  },
  {
    id: 'mandala-dorado',
    title: 'Mandala Dorado',
    description: 'Mandala geométrico sagrado con líneas doradas sobre negro',
    tags: ['geometrico', 'mandala', 'dorado'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-womens-crop-top', 'all-over-print-dress'],
    featured: false,
    prompt_used: 'Mandala geométrico sagrado intrincado con líneas doradas brillantes sobre fondo negro profundo, estilo ornamental',
    collection: 'geometrico',
  },
  {
    id: 'medusa-neon',
    title: 'Medusa Neón',
    description: 'Medusa bioluminiscente con tentáculos en colores neón',
    tags: ['animal', 'neon', 'oceano'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-womens-crop-top'],
    featured: false,
    prompt_used: 'Medusa bioluminiscente con tentáculos brillantes en colores neón rosa, azul y violeta, fondo oscuro oceánico profundo',
    collection: 'oceano',
  },
  {
    id: 'ciudad-cyberpunk',
    title: 'Ciudad Cyberpunk',
    description: 'Skyline futurista con neón y lluvia estilo cyberpunk',
    tags: ['urbano', 'cyberpunk', 'neon'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: false,
    prompt_used: 'Skyline de ciudad futurista cyberpunk con carteles neón vibrantes reflejados en calles mojadas por la lluvia nocturna',
    collection: 'urbano',
  },
  {
    id: 'ballena-cosmica',
    title: 'Ballena Cósmica',
    description: 'Ballena jorobada nadando entre estrellas y nebulosas',
    tags: ['animal', 'espacio', 'celestial'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: false,
    prompt_used: 'Ballena jorobada majestuosa nadando entre estrellas y nebulosas coloridas en el espacio profundo, estilo surrealista',
    collection: 'cosmos',
  },
  {
    id: 'pulpo-steampunk',
    title: 'Pulpo Steampunk',
    description: 'Pulpo mecánico con engranajes y tentáculos de cobre',
    tags: ['animal', 'steampunk', 'retro'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: false,
    prompt_used: 'Pulpo mecánico steampunk detallado con engranajes dorados y tentáculos de cobre, fondo de pergamino antiguo con planos técnicos',
    collection: 'steampunk',
  },
  {
    id: 'calavera-mexicana',
    title: 'Calavera Mexicana',
    description: 'Calavera con flores estilo Día de Muertos vibrante y colorido',
    tags: ['cultural', 'colorido', 'mexicano'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-womens-crop-top', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: 'Calavera mexicana decorada con flores coloridas de cempasúchil, rosas y patrones ornamentales, estilo Día de Muertos vibrante',
    collection: 'cultural',
  },
  {
    id: 'aurora-boreal',
    title: 'Aurora Boreal',
    description: 'Aurora boreal verde y violeta reflejada en lago de montaña',
    tags: ['naturaleza', 'celestial', 'colorido'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-unisex-hoodie'],
    featured: false,
    prompt_used: 'Aurora boreal espectacular en tonos verde y violeta reflejada en lago de montaña cristalino, cielo estrellado',
    collection: 'naturaleza',
  },
  {
    id: 'koi-japones',
    title: 'Koi Japonés',
    description: 'Pez koi rojo y dorado nadando entre ondas y flores de loto',
    tags: ['japones', 'animal', 'dorado'],
    compatible_products: ['all-over-print-mens-athletic-t-shirt', 'all-over-print-mens-crew-neck-t-shirt', 'all-over-print-mens-tank-top'],
    featured: false,
    prompt_used: 'Pez koi rojo y dorado nadando entre ondas y flores de loto blancas, estilo tinta japonesa tradicional',
    collection: 'arte-oriental',
  },
];

// ────────────────────────────────────────────────────────────────────────
function r2Url(key) {
  return `${R2_PUBLIC_BASE}/${encodeURI(key)}`;
}

async function uploadBuffer(buffer, key) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return r2Url(key);
}

async function generateAndUpload(design) {
  console.log(`  Generating: "${design.title}" ...`);
  const result = await openai.images.generate({
    model: 'gpt-image-1',
    prompt: design.prompt_used,
    size: '1024x1024',
  });

  const imageData = result.data[0];
  let buffer;
  if (imageData.b64_json) {
    buffer = Buffer.from(imageData.b64_json, 'base64');
  } else if (imageData.url) {
    const resp = await fetch(imageData.url, { signal: AbortSignal.timeout(30000) });
    buffer = Buffer.from(await resp.arrayBuffer());
  } else {
    throw new Error('No image data returned');
  }

  const key = `images/gallery-${design.id}.png`;
  const url = await uploadBuffer(buffer, key);
  console.log(`  ✓ Uploaded: ${url}`);
  return url;
}

async function main() {
  const designsFile = new URL('../data/curated-designs.json', import.meta.url);

  // Step 1: Build designs with existing R2 images
  console.log('\n=== Step 1: Mapping existing R2 images ===\n');
  const allDesigns = [];

  for (const design of EXISTING_DESIGNS) {
    const r2Key = EXISTING_IMAGE_MAP[design.id];
    const url = r2Url(r2Key);
    console.log(`  ✓ ${design.title} → ${url}`);
    allDesigns.push({ ...design, image_url: url });
  }

  // Step 2: Generate new images
  console.log('\n=== Step 2: Generating new images via OpenAI ===\n');
  for (const design of DESIGNS_TO_GENERATE) {
    try {
      const url = await generateAndUpload(design);
      allDesigns.push({ ...design, image_url: url });
    } catch (err) {
      console.error(`  ✗ Failed: ${design.title} — ${err.message}`);
      // Still add with null so we don't lose the design entry
      allDesigns.push({ ...design, image_url: null });
    }
    // Small delay between generations to avoid rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  // Step 3: Write updated file
  console.log('\n=== Step 3: Writing curated-designs.json ===\n');
  const output = { designs: allDesigns };
  writeFileSync(designsFile, JSON.stringify(output, null, 2) + '\n', 'utf8');

  const withImages = allDesigns.filter(d => d.image_url).length;
  const total = allDesigns.length;
  console.log(`Done! ${withImages}/${total} designs have images.\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
