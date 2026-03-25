/**
 * Reuters adapter — extraction logic for Arc/Fusion pages.
 *
 * Reuters uses Washington Post's Arc/Fusion CMS.
 * Data lives in `window.Fusion.globalContent` and `window.Fusion.contentCache`.
 */

/* ── helpers ─────────────────────────────────────────────────── */

function mapArticle(a: Record<string, unknown>): Record<string, unknown> {
  return {
    id: a.id,
    title: a.title || (a.headlines as Record<string, string>)?.basic,
    description: (a.description as Record<string, string>)?.basic || null,
    url: a.canonical_url || null,
    publishedAt: a.display_date || a.published_time || null,
    kicker: (a.kicker as Record<string, string>)?.name || null,
    authors: ((a.authors as Array<Record<string, string>>) || []).map(
      (au) => au.name,
    ),
    thumbnail:
      (
        (a.thumbnail as Record<string, Record<string, Record<string, string>>>)
          ?.renditions?.original as Record<string, string> | undefined
      )?.url || null,
  };
}

/* ── extractors ──────────────────────────────────────────────── */

export function extractArticle(): Record<string, unknown> | null {
  const gc = (window as Record<string, unknown>).Fusion as
    | Record<string, unknown>
    | undefined;
  const content = gc?.globalContent as Record<string, unknown> | undefined;
  const r = (content?.result || content) as Record<string, unknown> | undefined;
  if (!r?.title && !r?.id) return null;

  const elements = (r.content_elements || []) as Array<
    Record<string, unknown>
  >;
  return {
    id: r.id,
    title: r.title || (r.headlines as Record<string, string>)?.basic,
    description:
      (r.description as Record<string, string>)?.basic || r.description || null,
    publishedAt: r.display_date || r.published_time || null,
    updatedAt: r.last_updated_date || r.updated_time || null,
    authors: ((r.authors as Array<Record<string, string>>) || []).map((a) => ({
      name: a.name,
    })),
    kicker: (r.kicker as Record<string, string>)?.name || null,
    wordCount: r.word_count || null,
    readMinutes: r.read_minutes || null,
    body: elements.map((e) => ({
      type: e.type,
      content: e.content || null,
    })),
    thumbnail:
      (
        (r.thumbnail as Record<string, Record<string, Record<string, string>>>)
          ?.renditions?.original as Record<string, string> | undefined
      )?.url || null,
    canonicalUrl: r.canonical_url || null,
  };
}

export function extractSectionArticles(): Record<string, unknown> {
  const gc = (window as Record<string, unknown>).Fusion as
    | Record<string, unknown>
    | undefined;
  const content = gc?.globalContent as Record<string, unknown> | undefined;
  const r = content?.result as Record<string, unknown> | undefined;
  const articles = (r?.articles || []) as Array<Record<string, unknown>>;
  return {
    count: articles.length,
    items: articles.slice(0, 30).map(mapArticle),
  };
}

export function extractMarketData(): Record<string, unknown> {
  const gc = (window as Record<string, unknown>).Fusion as
    | Record<string, unknown>
    | undefined;
  const cc = gc?.contentCache as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  if (!cc?.["quote-by-rics-v2"]) return {};

  const entries = Object.values(cc["quote-by-rics-v2"]);
  const indices: Array<Record<string, unknown>> = [];
  const commodities: Array<Record<string, unknown>> = [];
  const currencies: Array<Record<string, unknown>> = [];
  const bonds: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    const data = entry?.data as Record<string, unknown> | undefined;
    const result = data?.result as Record<string, unknown> | undefined;
    const quotes = (result?.market_data || []) as Array<
      Record<string, unknown>
    >;
    for (const q of quotes) {
      const mapped = {
        ric: q.ric,
        name: q.name,
        type: q.type || q.ricType,
        last: q.last,
        percentChange: q.percent_change,
        currency: q.currency || null,
      };
      const t = (q.type || q.ricType || "") as string;
      if (t === "Index") indices.push(mapped);
      else if (t.includes("Commodity") || t.includes("Future"))
        commodities.push(mapped);
      else if (t === "Currency") currencies.push(mapped);
      else if (t === "Bond") bonds.push(mapped);
      else indices.push(mapped);
    }
  }

  // Deduplicate by ric
  const dedup = (arr: Array<Record<string, unknown>>) => {
    const seen = new Set<string>();
    return arr.filter((q) => {
      const ric = q.ric as string;
      if (seen.has(ric)) return false;
      seen.add(ric);
      return true;
    });
  };

  return {
    indices: dedup(indices),
    commodities: dedup(commodities),
    currencies: dedup(currencies),
    bonds: dedup(bonds),
  };
}

export function extractCompanyProfile(): Record<string, unknown> | null {
  const gc = (window as Record<string, unknown>).Fusion as
    | Record<string, unknown>
    | undefined;
  const content = gc?.globalContent as Record<string, unknown> | undefined;
  const r = content?.result as Record<string, unknown> | undefined;
  const mi = (r?.marketInfo || r) as Record<string, unknown> | undefined;
  if (!mi?.ric) return null;

  return {
    ric: mi.ric,
    name: mi.name,
    ticker: mi.ticker || null,
    ricType: mi.ricType || null,
    about: mi.about || null,
    website: mi.website || null,
    exchange: mi.exchange || null,
    sector: mi.sector || null,
    industry: mi.industry || null,
    employees: mi.employees || null,
    officers: ((mi.officers as Array<Record<string, string>>) || []).map(
      (o) => ({
        name: o.name,
        title: o.title,
      }),
    ),
  };
}

export function extractQuote(): Record<string, unknown> | null {
  const gc = (window as Record<string, unknown>).Fusion as
    | Record<string, unknown>
    | undefined;
  const content = gc?.globalContent as Record<string, unknown> | undefined;
  const r = content?.result as Record<string, unknown> | undefined;
  const mi = (r?.marketInfo || r) as Record<string, unknown> | undefined;
  if (!mi?.ric) return null;

  return {
    ric: mi.ric,
    name: mi.name,
    type: mi.ricType || null,
    last: mi.last || null,
    percentChange: mi.percent_change || mi.pctChange || null,
    currency: mi.currency || null,
  };
}
