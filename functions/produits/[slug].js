const PRODUCTS_JSON_URL =
  "https://opensheet.elk.sh/1KHd21NIpAbtMcEUI9NtQ3rvp4pgbZ4xJmQn2-eEI7Ss/1";

const SITE_URL = "https://the3dprinter3.dpdns.org";

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function parsePrice(value) {
  let cleaned = String(value == null ? "" : value)
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!cleaned) return NaN;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else {
    cleaned = cleaned.replace(",", ".");
  }

  return Number(cleaned);
}

function formatPrice(value) {
  const number = parsePrice(value);
  if (!Number.isFinite(number)) return String(value || "");
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(number);
}

function stockLimit(value) {
  const normalized = String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    !normalized ||
    ["illimite", "unlimited", "in", "oui", "yes"].includes(normalized)
  ) {
    return null;
  }

  if (["out", "rupture", "epuise", "non"].includes(normalized)) {
    return 0;
  }

  const quantity = Number.parseInt(normalized, 10);
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : null;
}

function stockText(limit) {
  if (limit === null) return "En stock";
  if (limit <= 0) return "Rupture de stock";
  if (limit === 1) return "1 exemplaire en stock";
  return `${limit} exemplaires en stock`;
}

function absoluteImage(value) {
  try {
    const url = new URL(String(value || ""), SITE_URL);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function colorCodes(product) {
  return String(product.couleurs_codes || "")
    .split("/")
    .map((color) => color.trim().toUpperCase())
    .filter((color) => /^#[0-9A-F]{3,8}$/.test(color));
}

function colorNames(product) {
  return String(product.couleurs || "")
    .split(/[,/;]+/)
    .map((color) => color.trim())
    .filter(Boolean);
}

function metaDescription(product) {
  const text = String(product.description || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 155);
  return `${product.nom || "Création imprimée en 3D"} fabriqué avec soin par The 3D Printer à Reims.`;
}

function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Produit introuvable — The 3D Printer</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;background:#f5f3ef;color:#161616;margin:0}
    main{min-height:100vh;display:grid;place-items:center;padding:24px}
    div{max-width:620px;text-align:center}
    h1{font-size:48px;margin:0 0 14px}
    p{color:#666;line-height:1.7}
    a{display:inline-block;margin-top:20px;padding:14px 20px;border-radius:14px;background:#ff6b35;color:#fff;text-decoration:none;font-weight:800}
  </style>
</head>
<body><main><div><h1>Produit introuvable</h1><p>Cette création n’existe plus ou son adresse a changé.</p><a href="/#catalogue">Retour au catalogue</a></div></main></body>
</html>`;
}

function renderPage(product) {
  const slug = productSlug(product);
  const canonical = `${SITE_URL}/produits/${encodeURIComponent(slug)}`;
  const price = parsePrice(product.prix);
  const numericPrice = Number.isFinite(price);
  const limit = stockLimit(product.stock);
  const available = limit !== 0;

  const mainImage = absoluteImage(product.image);
  const detailImage = absoluteImage(product.image_detail);
  const images = [mainImage, detailImage].filter(
    (value, index, array) => value && array.indexOf(value) === index
  );

  const codes = colorCodes(product);
  const names = colorNames(product);

  const description = String(product.description || "").trim();
  const material = String(product.materiau || "").trim();
  const dimensions = String(product.dimensions || "").trim();
  const printTime = String(product.temps || "").trim();
  const category = String(product.categorie || "").trim();

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: String(product.nom || ""),
    description: description || metaDescription(product),
    sku: String(product.id || product.nom || ""),
    url: canonical,
    image: images,
    ...(category ? { category } : {}),
    ...(material ? { material } : {}),
    ...(names.length ? { color: names.join(", ") } : {}),
    ...(numericPrice
      ? {
          offers: {
            "@type": "Offer",
            url: canonical,
            priceCurrency: "EUR",
            price: price.toFixed(2),
            availability: available
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
            itemCondition: "https://schema.org/NewCondition",
          },
        }
      : {}),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Accueil",
        item: SITE_URL + "/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Catalogue",
        item: SITE_URL + "/#catalogue",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: String(product.nom || "Produit"),
        item: canonical,
      },
    ],
  };

  const swatches = codes.length
    ? `<div class="swatches" id="swatches">
        ${codes.map((code, index) => {
          const name = names[index] || `Couleur ${index + 1}`;
          return `<button class="swatch${index === 0 ? " active" : ""}"
            type="button"
            data-color="${esc(code)}"
            data-color-name="${esc(name)}"
            aria-label="${esc(name)}"
            title="${esc(name)}"
            style="--swatch:${esc(code)}"></button>`;
        }).join("")}
      </div>
      <p class="selected-color" id="selectedColor">Couleur : ${esc(names[0] || codes[0])}</p>`
    : "";

  const galleryThumbs = images.length > 1
    ? `<div class="thumbs">
        ${images.map((image, index) =>
          `<button class="thumb${index === 0 ? " active" : ""}" type="button" data-image="${esc(image)}">
             <img src="${esc(image)}" alt="Vue ${index + 1} de ${esc(product.nom)}">
           </button>`
        ).join("")}
      </div>`
    : "";

  const priceHtml = numericPrice
    ? `<div class="price">${esc(formatPrice(product.prix))}</div>`
    : `<div class="price quote">Prix sur demande</div>`;

  const mainAction = numericPrice
    ? `<button class="buy-button" id="addToCart" type="button" ${available ? "" : "disabled"}>
         ${available ? "Ajouter au panier" : "Indisponible"}
       </button>`
    : `<a class="buy-button" href="mailto:contact@the3dprinter3.dpdns.org?subject=${encodeURIComponent("Devis — " + String(product.nom || "Création"))}">
         Demander un devis
       </a>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(product.nom)} — The 3D Printer</title>
  <meta name="description" content="${esc(metaDescription(product))}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="theme-color" content="#ff6b35">
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${esc(canonical)}">

  <meta property="og:type" content="product">
  <meta property="og:site_name" content="The 3D Printer">
  <meta property="og:title" content="${esc(product.nom)}">
  <meta property="og:description" content="${esc(metaDescription(product))}">
  <meta property="og:url" content="${esc(canonical)}">
  ${mainImage ? `<meta property="og:image" content="${esc(mainImage)}">` : ""}
  ${numericPrice ? `<meta property="product:price:amount" content="${price.toFixed(2)}"><meta property="product:price:currency" content="EUR">` : ""}

  <script type="application/ld+json">${jsonLd(productSchema)}</script>
  <script type="application/ld+json">${jsonLd(breadcrumbSchema)}</script>

  <style>
    :root {
      --bg:#f5f3ef;--surface:#fff;--text:#161616;--muted:#666;
      --border:#d9d6d0;--accent:#ff6b35;--accent-dark:#de4f1d;
      --shadow:0 20px 60px rgba(0,0,0,.09);--radius:26px;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{font-family:Inter,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
    body.dark{--bg:#0f0f10;--surface:#18181a;--text:#f5f3ef;--muted:#aaa7a2;--border:#36363a;--shadow:0 24px 70px rgba(0,0,0,.35)}
    a{color:inherit;text-decoration:none}
    button{font:inherit;cursor:pointer}
    img{max-width:100%;display:block}
    .container{width:min(calc(100% - 30px),1180px);margin:auto}
    .top{background:#111;color:#fff;text-align:center;padding:9px 15px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
    header{position:sticky;top:0;z-index:50;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--surface) 90%,transparent);backdrop-filter:blur(16px)}
    .header-inner{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:20px}
    .brand{display:flex;align-items:center;gap:10px;font-weight:950;letter-spacing:-.03em}
    .mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#111;color:#fff}
    nav{display:flex;gap:20px;color:var(--muted);font-size:12px;font-weight:800}
    .cart-link{padding:11px 15px;border-radius:12px;background:#111;color:#fff;font-size:11px;font-weight:900;text-transform:uppercase}
    .breadcrumb{padding:25px 0 5px;color:var(--muted);font-size:11px;font-weight:700}
    .breadcrumb a:hover{color:var(--accent)}
    main{padding:25px 0 80px}
    .product{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.85fr);gap:54px;align-items:start}
    .gallery{position:sticky;top:110px}
    .main-image{aspect-ratio:1/1;display:grid;place-items:center;overflow:hidden;border:1px solid var(--border);border-radius:32px;background:#ece9e4;box-shadow:var(--shadow)}
    body.dark .main-image{background:#242426}
    .main-image img{width:100%;height:100%;object-fit:cover;color:transparent}
    .image-empty{color:var(--muted);font-weight:800}
    .thumbs{display:flex;gap:10px;margin-top:12px}
    .thumb{width:78px;height:78px;padding:0;overflow:hidden;border:2px solid transparent;border-radius:14px;background:var(--surface)}
    .thumb.active{border-color:var(--accent)}
    .thumb img{width:100%;height:100%;object-fit:cover;color:transparent}
    .category{margin-bottom:10px;color:var(--accent);font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    h1{font-size:clamp(42px,6vw,72px);line-height:.96;letter-spacing:-.055em;margin-bottom:18px}
    .description{color:var(--muted);font-size:16px;line-height:1.75;margin-bottom:22px;white-space:pre-line}
    .price{font-size:32px;font-weight:950;margin-bottom:8px}
    .price.quote{font-size:25px}
    .stock{display:inline-flex;align-items:center;gap:8px;margin-bottom:24px;padding:8px 11px;border-radius:999px;background:rgba(34,168,90,.11);color:#208c4d;font-size:10px;font-weight:900;text-transform:uppercase}
    .stock.out{background:rgba(215,75,69,.12);color:#d74b45}
    .stock::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
    .choice-title{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;margin:8px 0 11px}
    .swatches{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}
    .swatch{width:40px;height:40px;border:3px solid var(--surface);border-radius:50%;background:var(--swatch);box-shadow:0 0 0 1px var(--border)}
    .swatch.active{box-shadow:0 0 0 3px var(--accent)}
    .selected-color{color:var(--muted);font-size:11px;margin-bottom:20px}
    .qty-row{display:flex;gap:10px;margin:20px 0 10px}
    .qty{display:flex;align-items:center;border:1px solid var(--border);border-radius:14px;background:var(--surface);overflow:hidden}
    .qty button{width:42px;height:52px;border:0;background:transparent;color:var(--text);font-size:20px}
    .qty input{width:50px;border:0;background:transparent;color:var(--text);text-align:center;font-weight:900}
    .buy-button{display:flex;min-height:56px;flex:1;align-items:center;justify-content:center;border:0;border-radius:15px;background:var(--accent);color:#fff;font-size:12px;font-weight:950;text-transform:uppercase}
    .buy-button:hover{background:var(--accent-dark)}
    .buy-button:disabled{opacity:.45;cursor:not-allowed}
    .reassurance{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0 26px}
    .reassurance div{padding:13px;border:1px solid var(--border);border-radius:14px;background:var(--surface);color:var(--muted);font-size:10px;font-weight:750;text-align:center}
    .specs{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border);border-left:1px solid var(--border);border-radius:18px;overflow:hidden}
    .spec{padding:16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface)}
    .spec span{display:block;margin-bottom:5px;color:var(--muted);font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.07em}
    .spec strong{font-size:12px}
    .share-row{display:flex;gap:8px;margin-top:17px}
    .secondary{display:flex;min-height:44px;align-items:center;justify-content:center;padding:0 14px;border:1px solid var(--border);border-radius:13px;background:var(--surface);color:var(--text);font-size:10px;font-weight:900;text-transform:uppercase}
    .notice{display:none;margin-top:14px;padding:13px;border-radius:13px;background:rgba(34,168,90,.11);color:#208c4d;font-size:12px;font-weight:800}
    .notice.show{display:block}
    .back-catalog{margin-top:55px;padding:34px;border-radius:28px;background:#111;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:24px}
    .back-catalog h2{font-size:clamp(28px,4vw,48px);letter-spacing:-.04em}
    .back-catalog p{color:rgba(255,255,255,.6);margin-top:6px}
    .back-catalog a{padding:14px 18px;border-radius:13px;background:var(--accent);font-size:11px;font-weight:900;text-transform:uppercase;white-space:nowrap}
    footer{padding:30px 0;border-top:1px solid var(--border);color:var(--muted);font-size:11px;text-align:center}
    @media(max-width:850px){
      nav{display:none}
      .product{grid-template-columns:1fr;gap:28px}
      .gallery{position:static}
      .reassurance{grid-template-columns:1fr}
    }
    @media(max-width:560px){
      .brand span:last-child{display:none}
      h1{font-size:44px}
      .specs{grid-template-columns:1fr}
      .qty-row{display:grid;grid-template-columns:120px 1fr}
      .back-catalog{display:grid}
    }
  </style>
</head>
<body>
  <div class="top">Fabrication à Reims • Paiement sécurisé</div>

  <header>
    <div class="container header-inner">
      <a class="brand" href="/">
        <span class="mark">3D</span>
        <span>The 3D Printer</span>
      </a>

      <nav aria-label="Navigation principale">
        <a href="/#catalogue">Catalogue</a>
        <a href="/mes-commandes.html">Mes commandes</a>
        <a href="/#faq">FAQ</a>
        <a href="/#contact">Contact</a>
      </nav>

      <a class="cart-link" href="/?panier=1">Panier <span id="cartCount">0</span></a>
    </div>
  </header>

  <div class="container breadcrumb">
    <a href="/">Accueil</a> / <a href="/#catalogue">Catalogue</a> / ${esc(product.nom)}
  </div>

  <main>
    <div class="container">
      <article class="product">
        <section class="gallery" aria-label="Photos du produit">
          <div class="main-image">
            ${mainImage
              ? `<img id="mainProductImage" src="${esc(mainImage)}" alt="${esc(product.nom)}">`
              : `<span class="image-empty">Image indisponible</span>`
            }
          </div>
          ${galleryThumbs}
        </section>

        <section>
          ${category ? `<p class="category">${esc(category)}</p>` : ""}
          <h1>${esc(product.nom)}</h1>
          ${description ? `<p class="description">${esc(description)}</p>` : ""}

          ${priceHtml}

          <div class="stock${available ? "" : " out"}">${esc(stockText(limit))}</div>

          ${codes.length ? `<p class="choice-title">Choisissez votre couleur</p>${swatches}` : ""}

          ${numericPrice
            ? `<div class="qty-row">
                <div class="qty">
                  <button type="button" id="qtyMinus" aria-label="Retirer une unité">−</button>
                  <input id="qty" type="number" min="1" max="${limit === null ? 99 : Math.max(1, limit)}" value="1" aria-label="Quantité">
                  <button type="button" id="qtyPlus" aria-label="Ajouter une unité">+</button>
                </div>
                ${mainAction}
              </div>`
            : mainAction
          }

          <div class="notice" id="cartNotice">
            Produit ajouté. <a href="/?panier=1"><strong>Ouvrir le panier →</strong></a>
          </div>

          <div class="reassurance">
            <div>Paiement sécurisé</div>
            <div>Fabrication soignée</div>
            <div>Livraison affichée dans le panier</div>
          </div>

          <div class="specs">
            ${material ? `<div class="spec"><span>Matière</span><strong>${esc(material)}</strong></div>` : ""}
            ${dimensions ? `<div class="spec"><span>Dimensions</span><strong>${esc(dimensions)}</strong></div>` : ""}
            ${printTime ? `<div class="spec"><span>Fabrication</span><strong>${esc(printTime)}</strong></div>` : ""}
            ${names.length ? `<div class="spec"><span>Couleurs</span><strong>${esc(names.join(", "))}</strong></div>` : ""}
            ${category ? `<div class="spec"><span>Catégorie</span><strong>${esc(category)}</strong></div>` : ""}
            <div class="spec"><span>Disponibilité</span><strong>${esc(stockText(limit))}</strong></div>
          </div>

          <div class="share-row">
            <button class="secondary" id="shareButton" type="button">Partager</button>
            <a class="secondary" href="/#contact">Une question ?</a>
          </div>
        </section>
      </article>

      <section class="back-catalog">
        <div>
          <h2>Découvrez les autres créations</h2>
          <p>Parcourez le catalogue complet et les différentes couleurs disponibles.</p>
        </div>
        <a href="/#catalogue">Voir le catalogue</a>
      </section>
    </div>
  </main>

  <footer>
    <div class="container">The 3D Printer — Créations imprimées en 3D</div>
  </footer>

  <script>
    "use strict";

    const CART_KEY = "the3dprinter_cart_v1";

    const PRODUCT = {
      id: ${jsonLd(String(product.id || product.nom || ""))},
      name: ${jsonLd(String(product.nom || ""))},
      price: ${numericPrice ? price.toFixed(2) : "null"},
      image: ${jsonLd(mainImage || "")},
      stockLimit: ${limit === null ? "null" : String(limit)},
    };

    let selectedColor = ${jsonLd(names[0] || codes[0] || "")};

    function loadCart() {
      try {
        const value = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    }

    function saveCart(cart) {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      updateCartCount();
    }

    function updateCartCount() {
      const cart = loadCart();
      const count = cart.reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);
      document.getElementById("cartCount").textContent = String(count);
    }

    function itemKey(item) {
      return String(item.id) + "::" + String(item.color || "");
    }

    function addProductToCart() {
      if (PRODUCT.price === null || PRODUCT.stockLimit === 0) return;

      const qtyInput = document.getElementById("qty");
      let quantity = Math.max(1, parseInt(qtyInput.value, 10) || 1);

      const cart = loadCart();
      const alreadyForProduct = cart
        .filter((item) => String(item.id) === String(PRODUCT.id))
        .reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);

      if (PRODUCT.stockLimit !== null) {
        const remaining = Math.max(0, PRODUCT.stockLimit - alreadyForProduct);
        if (remaining <= 0) {
          alert("Le stock maximum de ce produit est déjà dans votre panier.");
          return;
        }
        quantity = Math.min(quantity, remaining);
      }

      const item = {
        id: String(PRODUCT.id),
        name: PRODUCT.name,
        price: Number(PRODUCT.price),
        image: PRODUCT.image,
        color: selectedColor || "",
        stockLimit: PRODUCT.stockLimit,
        quantity,
      };

      const key = itemKey(item);
      const existing = cart.find((entry) => itemKey(entry) === key);

      if (existing) {
        existing.quantity = Math.min(
          99,
          (parseInt(existing.quantity, 10) || 0) + quantity
        );
      } else {
        cart.push(item);
      }

      saveCart(cart);

      const notice = document.getElementById("cartNotice");
      notice.classList.add("show");
      notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    document.querySelectorAll(".thumb").forEach((thumb) => {
      thumb.addEventListener("click", () => {
        const image = document.getElementById("mainProductImage");
        if (!image) return;
        image.src = thumb.dataset.image;
        document.querySelectorAll(".thumb").forEach((item) => {
          item.classList.toggle("active", item === thumb);
        });
      });
    });

    document.querySelectorAll(".swatch").forEach((swatch) => {
      swatch.addEventListener("click", () => {
        selectedColor = swatch.dataset.colorName || swatch.dataset.color || "";
        document.querySelectorAll(".swatch").forEach((item) => {
          item.classList.toggle("active", item === swatch);
        });

        const label = document.getElementById("selectedColor");
        if (label) label.textContent = "Couleur : " + selectedColor;
      });
    });

    const qtyInput = document.getElementById("qty");
    const qtyMinus = document.getElementById("qtyMinus");
    const qtyPlus = document.getElementById("qtyPlus");

    if (qtyInput && qtyMinus && qtyPlus) {
      const maxQty = PRODUCT.stockLimit === null ? 99 : Math.max(1, PRODUCT.stockLimit);

      qtyMinus.addEventListener("click", () => {
        qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
      });

      qtyPlus.addEventListener("click", () => {
        qtyInput.value = Math.min(maxQty, (parseInt(qtyInput.value, 10) || 1) + 1);
      });
    }

    const addButton = document.getElementById("addToCart");
    if (addButton) addButton.addEventListener("click", addProductToCart);

    const shareButton = document.getElementById("shareButton");
    shareButton.addEventListener("click", async () => {
      try {
        if (navigator.share) {
          await navigator.share({
            title: PRODUCT.name,
            text: PRODUCT.name + " — The 3D Printer",
            url: location.href,
          });
        } else {
          await navigator.clipboard.writeText(location.href);
          shareButton.textContent = "Lien copié";
        }
      } catch {}
    });

    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const THEME_KEY = "the3dprinter_theme_mode_v2";

    function applyTheme() {
      const saved = localStorage.getItem(THEME_KEY) || "auto";
      const dark = saved === "dark" || (saved === "auto" && systemTheme.matches);
      document.body.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }

    applyTheme();
    systemTheme.addEventListener("change", applyTheme);
    updateCartCount();
  </script>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const requestedSlug = String(context.params.slug || "");

  try {
    const response = await fetch(PRODUCTS_JSON_URL, {
      headers: {
        "User-Agent": "The3DPrinter-ProductPages/1.0",
      },
    });

    if (!response.ok) {
      return new Response("Catalogue momentanément indisponible.", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    const products = await response.json();

    const product = Array.isArray(products)
      ? products.find((item) => productSlug(item) === requestedSlug)
      : null;

    if (!product || !product.nom) {
      return new Response(notFoundPage(), {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    return new Response(renderPage(product), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Robots-Tag": "index, follow",
      },
    });
  } catch (error) {
    console.error("Product page error:", error);

    return new Response("Catalogue momentanément indisponible.", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
