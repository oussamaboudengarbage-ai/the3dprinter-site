const PRODUCTS_JSON_URL =
  "https://opensheet.elk.sh/1KHd21NIpAbtMcEUI9NtQ3rvp4pgbZ4xJmQn2-eEI7Ss/1";

const SITE_URL = "https://the3dprinter3.dpdns.org";

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 110) || "produit";
}

function productSlug(product) {
  const raw = [product.id, product.nom]
    .filter((value) => String(value || "").trim())
    .join("-");
  return slugify(raw || product.nom || product.id || "produit");
}

export async function onRequestGet() {
  try {
    const response = await fetch(PRODUCTS_JSON_URL);

    if (!response.ok) {
      throw new Error("Catalogue indisponible.");
    }

    const products = await response.json();

    const urls = [
      SITE_URL + "/",
      ...((Array.isArray(products) ? products : [])
        .filter((product) => product && product.nom)
        .map((product) =>
          SITE_URL + "/produits/" + encodeURIComponent(productSlug(product))
        )),
    ];

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((url) =>
        "  <url><loc>" + xmlEscape(url) + "</loc></url>"
      ).join("\n") +
      "\n</urlset>";

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (error) {
    console.error("Sitemap error:", error);

    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
        SITE_URL +
        '/</loc></url></urlset>',
      {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
