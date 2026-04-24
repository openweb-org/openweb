import type { Page } from "patchright";

import type { CustomRunner } from "../../../types/adapter.js";

type Params = Readonly<Record<string, unknown>>;

async function searchProducts(
	page: Page,
	params: Params,
	errors: { missingParam(name: string): Error },
): Promise<unknown> {
	const q = String(params.q || "");
	if (!q) throw errors.missingParam("q");

	return page.evaluate(async (query: string) => {
		const resp = await fetch(`/search?q=${encodeURIComponent(query)}`, {
			credentials: "include",
		});
		if (!resp.ok) throw new Error(`Search fetch failed: ${resp.status}`);
		const html = await resp.text();
		const m = html.match(
			/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
		);
		if (!m) throw new Error("No __NEXT_DATA__ in search response");
		const nd = JSON.parse(m[1]);
		const sr = nd?.props?.pageProps?.initialData?.searchResult;
		if (!sr) throw new Error("searchResult not found in __NEXT_DATA__");

		const stacks = sr.itemStacks || [];
		const items: Array<Record<string, unknown>> = [];
		const seen = new Set<string>();
		outer: for (const stack of stacks) {
			for (const item of stack.items || []) {
				if (items.length >= 20) break outer;
				const uid = item.usItemId;
				if (!uid || seen.has(uid)) continue;
				seen.add(uid);
				const pi = item.priceInfo || {};
				const ii = item.imageInfo || {};
				items.push({
					usItemId: uid,
					name: item.name || "",
					brand: item.brand || null,
					canonicalUrl: item.canonicalUrl || null,
					averageRating: item.averageRating ?? null,
					numberOfReviews: item.numberOfReviews ?? null,
					linePrice: pi.linePrice || null,
					wasPrice: pi.wasPrice || null,
					savings: pi.savings || null,
					thumbnailUrl: ii.thumbnailUrl || null,
				});
			}
		}
		return {
			title: sr.title || null,
			count: sr.count ?? stacks[0]?.count ?? 0,
			items,
		};
	}, q);
}

async function getProductDetail(
	page: Page,
	params: Params,
	errors: { missingParam(name: string): Error },
): Promise<unknown> {
	const itemId = String(params.itemId || "");
	if (!itemId) throw errors.missingParam("itemId");

	return page.evaluate(async (id: string) => {
		const resp = await fetch(`/ip/p/${id}`, { credentials: "include" });
		if (!resp.ok) throw new Error(`Product fetch failed: ${resp.status}`);
		const html = await resp.text();
		const m = html.match(
			/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
		);
		if (!m) throw new Error("No __NEXT_DATA__ in product response");
		const nd = JSON.parse(m[1]);
		const p = nd?.props?.pageProps?.initialData?.data?.product;
		if (!p) throw new Error("Product data not found in __NEXT_DATA__");

		const pi = p.priceInfo || {};
		const cp = pi.currentPrice || {};
		const wp = pi.wasPrice;
		const up = pi.unitPrice;
		const sa = pi.savingsAmount;
		const ii = p.imageInfo || {};
		const allImages = (ii.allImages || [])
			.slice(0, 5)
			.map((img: { url?: string }) => ({ url: img.url || null }));
		const desc = p.shortDescription;

		return {
			usItemId: p.usItemId || id,
			name: p.name || "",
			brand: p.brand || null,
			shortDescription: desc ? desc.slice(0, 500) : null,
			averageRating: p.averageRating ?? null,
			numberOfReviews: p.numberOfReviews ?? null,
			canonicalUrl: p.canonicalUrl || null,
			priceInfo: {
				currentPrice: {
					price: cp.price ?? null,
					priceString: cp.priceString || null,
				},
				wasPrice: wp
					? { price: wp.price ?? null, priceString: wp.priceString || null }
					: null,
				unitPrice: up ? (up.priceString || null) : null,
				savingsAmount: sa
					? { amount: sa.amount ?? null, priceString: sa.priceString || null }
					: null,
				isPriceReduced: pi.isPriceReduced ?? false,
			},
			imageInfo: {
				thumbnailUrl: ii.thumbnailUrl || null,
				allImages,
			},
			availabilityStatus: p.availabilityStatus || null,
			sellerName: p.sellerName || null,
		};
	}, itemId);
}

async function getProductPricing(
	page: Page,
	params: Params,
	errors: { missingParam(name: string): Error },
): Promise<unknown> {
	const itemId = String(params.itemId || "");
	if (!itemId) throw errors.missingParam("itemId");

	return page.evaluate(async (id: string) => {
		const resp = await fetch(`/ip/p/${id}`, { credentials: "include" });
		if (!resp.ok) throw new Error(`Product fetch failed: ${resp.status}`);
		const html = await resp.text();
		const m = html.match(
			/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
		);
		if (!m) throw new Error("No __NEXT_DATA__ in product response");
		const nd = JSON.parse(m[1]);
		const pi = nd?.props?.pageProps?.initialData?.data?.product?.priceInfo;
		if (!pi) throw new Error("priceInfo not found in __NEXT_DATA__");

		const cp = pi.currentPrice || {};
		const wp = pi.wasPrice;
		const up = pi.unitPrice;
		const sa = pi.savingsAmount;

		return {
			currentPrice: {
				price: cp.price ?? null,
				priceString: cp.priceString || null,
				currencyUnit: cp.currencyUnit || null,
			},
			wasPrice: wp
				? { price: wp.price ?? null, priceString: wp.priceString || null }
				: null,
			unitPrice: up ? (up.priceString || null) : null,
			savingsAmount: sa
				? { amount: sa.amount ?? null, priceString: sa.priceString || null }
				: null,
			isPriceReduced: pi.isPriceReduced ?? false,
		};
	}, itemId);
}

const adapter: CustomRunner = {
	name: "walmart-read",
	description: "Walmart — read operations via in-page SSR fetch with trimming",

	async run(ctx) {
		const { page, operation, params, helpers } = ctx;
		const errors = (
			helpers as {
				errors: {
					unknownOp(op: string): Error;
					missingParam(name: string): Error;
				};
			}
		).errors;
		if (!page)
			throw errors.fatal("walmart-read adapter requires a browser page");

		switch (operation) {
			case "searchProducts":
				return searchProducts(page, params, errors);
			case "getProductDetail":
				return getProductDetail(page, params, errors);
			case "getProductPricing":
				return getProductPricing(page, params, errors);
			default:
				throw errors.unknownOp(operation);
		}
	},
};

export default adapter;
