// Lista variantes de un product_id del catálogo (ej. 4011 = Bella+Canvas 3001).
// Usa PRINTFUL_API_KEY en el .env
import 'dotenv/config';

const PRODUCT_ID = 4011; // cambia si quieres otro producto DTG

(async () => {
  const res = await fetch(`https://api.printful.com/products/${PRODUCT_ID}`, {
    headers: { Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}` }
  });
  const data = await res.json();
  if (!data || !data.result || !data.result.variants) {
    console.error('No pude obtener variantes:', data);
    process.exit(1);
  }
  // Muestra color/talla/id
  for (const v of data.result.variants) {
    console.log(`${v.id}\t${v.name}`);
  }
})();
