/* Cloudflare Pages Function: serves /q/<id> with per-quiz link-preview tags. */

const SITE_NAME = "Maujix";
/* Same Apps Script web app the page already uses (SHORT_ENDPOINT in index.html). */
const SHORT_ENDPOINT = "https://script.google.com/macros/s/AKfycbzpBmEq1C-R-653AF31ja4tFcz971SyDwehiQqcbh2O7_y6CZlbFV_xN4lMPyPNZncgWQ/exec";
const ID_RE = /^[A-Za-z0-9]{6,10}$/;

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* returns {quiz, json} | null (quiz does not exist) | undefined (lookup failed, try again later) */
async function lookupQuiz(id) {
  try {
    const r = await fetch(SHORT_ENDPOINT + "?action=get&id=" + id, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (!d || !d.ok) return null;
    const quiz = JSON.parse(d.json);
    if (!quiz || !Array.isArray(quiz.qs) || !quiz.qs.length || !quiz.owner) return null;
    return { quiz, json: d.json };
  } catch (e) { return undefined; }
}

function setMeta(html, attr, key, value) {
  const re = new RegExp('(<meta\\s+' + attr + '="' + key + '"\\s+content=")[^"]*(")', "i");
  const tag = '<meta ' + attr + '="' + key + '" content="' + esc(value) + '">';
  return re.test(html) ? html.replace(re, (m, a, b) => a + esc(value) + b) : html.replace("</head>", tag + "\n</head>");
}

function renderQuizPage(html, id, found, origin) {
  const owner = String(found.quiz.owner).slice(0, 30);
  const title = owner + " is blocking \u{1F6AB}\u{1F4F1} their fake friends";
  const desc = "Will they block you as well? Take " + owner + "'s quiz on " + SITE_NAME + " and find out.";
  const url = origin + "/q/" + id;
  const image = origin + "/og-image.png";
  html = html.replace(/<title>[^<]*<\/title>/i, "<title>" + esc(title + " | " + SITE_NAME) + "</title>");
  const pairs = [
    ["name", "description", desc],
    ["property", "og:type", "website"], ["property", "og:site_name", SITE_NAME],
    ["property", "og:title", title], ["property", "og:description", desc],
    ["property", "og:url", url], ["property", "og:image", image],
    ["name", "twitter:card", "summary_large_image"], ["name", "twitter:title", title],
    ["name", "twitter:description", desc], ["name", "twitter:image", image]
  ];
  pairs.forEach(p => { html = setMeta(html, p[0], p[1], p[2]); });
  /* Embed the quiz so the page opens without a second request. "<" is escaped so the data cannot close the script tag. */
  const data = JSON.stringify({ id, json: found.json }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return html.replace("</head>", '<link rel="canonical" href="' + esc(url) + '">\n<script type="application/json" id="fkq">' + data + "</script>\n</head>");
}

async function handle(request, id, getIndex) {
  const url = new URL(request.url);
  const page = await getIndex();
  let html = await page.text();
  const baseHeaders = { "content-type": "text/html; charset=utf-8" };
  if (!ID_RE.test(id)) {
    html = setMeta(html, "name", "robots", "noindex");
    return new Response(html, { status: 404, headers: { ...baseHeaders, "cache-control": "no-store" } });
  }
  const found = await lookupQuiz(id);
  if (found === undefined) {        // Apps Script hiccup: serve the plain app, it will retry from the browser
    return new Response(html, { status: 200, headers: { ...baseHeaders, "cache-control": "no-store" } });
  }
  if (found === null) {             // unknown or expired id
    html = setMeta(html, "name", "robots", "noindex");
    return new Response(html, { status: 404, headers: { ...baseHeaders, "cache-control": "public, max-age=60" } });
  }
  return new Response(renderQuizPage(html, id, found, url.origin), {
    status: 200, headers: { ...baseHeaders, "cache-control": "public, max-age=300" }
  });
}

export async function onRequest({ request, params, env }) {
  const id = String(params.id || "");
  return handle(request, id, () => env.ASSETS.fetch(new URL("/", request.url)));
}
