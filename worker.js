export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/api/espn") {
      return handleFeed();
    }

    return new Response("Not found", { status: 404 });
  }
};

const FEED_URL = "https://www.espn.com/espn/rss/news";
const MAX_ITEMS = 10;

async function handleFeed() {
  try {
    const feedRes = await fetch(FEED_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!feedRes.ok) {
      return json({ error: `Feed request failed: ${feedRes.status}` }, 500);
    }

    const xml = await feedRes.text();
    const items = parseRssItems(xml).slice(0, MAX_ITEMS);

    const stories = await Promise.all(
      items.map(async (item) => {
        const enriched = await enrichStoryFromArticle(item.link);
        return {
          title: decodeHtml(item.title || ""),
          summary: enriched.summary || decodeHtml(stripHtml(item.description || "")),
          pubDate: item.pubDate || "",
          link: item.link || "",
          image: enriched.image || "",
          source: "ESPN"
        };
      })
    );

    return json(
      {
        stories,
        fetchedAt: new Date().toISOString()
      },
      200,
      {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300"
      }
    );
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
}

function parseRssItems(xml) {
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

  return matches.map((m) => {
    const block = m[1];
    return {
      title: getTag(block, "title"),
      link: getTag(block, "link"),
      pubDate: getTag(block, "pubDate"),
      description: getTag(block, "description")
    };
  });
}

function getTag(block, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? match[1].trim() : "";
}

async function enrichStoryFromArticle(link) {
  if (!link) return { image: "", summary: "" };

  try {
    const res = await fetch(link, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!res.ok) {
      return { image: "", summary: "" };
    }

    const html = await res.text();

    const image =
      getMetaContent(html, "property", "og:image") ||
      getMetaContent(html, "name", "twitter:image") ||
      getFirstImg(html) ||
      "";

    const summary =
      getMetaContent(html, "property", "og:description") ||
      getMetaContent(html, "name", "description") ||
      "";

    return {
      image: decodeHtml(image),
      summary: decodeHtml(summary)
    };
  } catch {
    return { image: "", summary: "" };
  }
}

function getMetaContent(html, attrName, attrValue) {
  const patterns = [
    new RegExp(
      `<meta[^>]*${attrName}=["']${escapeRegex(attrValue)}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escapeRegex(attrValue)}["'][^>]*>`,
      "i"
    )
  ];

  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return match[1];
  }

  return "";
}

function getFirstImg(html) {
  const match = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
  return match?.[1] || "";
}

function stripHtml(input) {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
