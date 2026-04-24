import type { Page, Response as PwResponse } from "patchright";

import type { CustomRunner } from "../../../types/adapter.js";

/**
 * JD L3 adapter — search via DOM extraction, detail/price/reviews via API intercept.
 *
 * search.jd.com  — product search (DOM extraction)
 * item.jd.com    — product detail, price, reviews
 *   JD's item page is client-rendered. Data comes from api.m.jd.com APIs
 *   signed with h5st (client-side HMAC). page.evaluate(fetch) cannot replicate
 *   the signature, so we use the intercept pattern: navigate to the product page
 *   and capture the API responses that JD's own JS triggers.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Errors = {
	missingParam(name: string): Error;
	unknownOp(op: string): Error;
	wrap(error: unknown): Error;
};

/* ---------- Intercept helpers ---------- */

interface InterceptResult {
	wareData: Record<string, unknown> | null;
	commentData: Record<string, unknown> | null;
}

/**
 * Navigate to a JD product page and intercept the two key API responses:
 * - pc_detailpage_wareBusiness: product attributes, price, stock, shop, images, variants
 * - getLegoWareDetailComment: reviews, ratings, tags
 */
async function interceptProductApis(
	page: Page,
	skuId: string,
	timeout = 15000,
): Promise<InterceptResult> {
	let wareData: Record<string, unknown> | null = null;
	let commentData: Record<string, unknown> | null = null;

	const handler = async (resp: PwResponse) => {
		const url = resp.url();
		try {
			if (!wareData && url.includes("pc_detailpage_wareBusiness")) {
				wareData = (await resp.json()) as Record<string, unknown>;
			}
			if (!commentData && url.includes("getLegoWareDetailComment")) {
				commentData = (await resp.json()) as Record<string, unknown>;
			}
		} catch { /* response body unavailable */ }
	};

	page.on("response", handler);
	try {
		await page.goto(`https://item.jd.com/${skuId}.html`, {
			waitUntil: "load",
			timeout: 30_000,
		});
		const deadline = Date.now() + timeout;
		while ((!wareData || !commentData) && Date.now() < deadline) {
			await sleep(500);
		}
	} finally {
		page.off("response", handler);
	}

	return { wareData, commentData };
}

/* ---------- searchProducts ---------- */

async function searchProducts(
	page: Page,
	params: Record<string, unknown>,
	errors: Errors,
): Promise<unknown> {
	const keyword = String(params.keyword || "");
	if (!keyword) throw errors.missingParam("keyword");
	const pageNum = Number(params.page) || 1;

	const url = `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}&enc=utf-8&page=${2 * pageNum - 1}`;
	await page.goto(url, { waitUntil: "load", timeout: 30_000 });
	await sleep(3000);

	return page.evaluate(
		({ keyword, pageNum }: { keyword: string; pageNum: number }) => {
			const items = document.querySelectorAll("[data-sku]");
			const products: Array<Record<string, unknown>> = [];

			for (const el of items) {
				const item = el as HTMLElement;
				const skuId = item.getAttribute("data-sku");
				if (!skuId) continue;

				const titleEl = item.querySelector("span[title]");
				const name = titleEl?.getAttribute("title")?.trim() || null;

				// Price: find <i>¥</i> then grab adjacent <span> with digits
				let price: string | null = null;
				for (const iEl of item.querySelectorAll("i")) {
					if (iEl.textContent?.trim() === "¥") {
						const nextSpan = iEl.nextElementSibling;
						if (nextSpan) {
							const t = nextSpan.textContent?.trim() || "";
							if (/^[\d,.]+$/.test(t)) { price = t; break; }
						}
						const parent = iEl.parentElement;
						if (!price && parent) {
							const sibSpan = parent.querySelector("span");
							if (sibSpan) {
								const t = sibSpan.textContent?.trim() || "";
								if (/^[\d,.]+$/.test(t)) { price = t; break; }
							}
						}
						break;
					}
				}

				// Shop name: CSS-module class with _limit_ or _name_ inside _shopFloor_
				let shopName: string | null = null;
				for (const span of item.querySelectorAll("span")) {
					const cls = span.className || "";
					if (cls.includes("_limit_") || cls.includes("_name_")) {
						const parent = span.closest("[class*='_shopFloor_']") || span.closest("[class*='_shop_']");
						if (parent) {
							shopName = span.textContent?.trim() || null;
							if (shopName) break;
						}
					}
				}
				if (!shopName) {
					for (const link of item.querySelectorAll("a")) {
						const href = link.getAttribute("href") || "";
						if (href.includes("mall.jd.com") || href.includes("shop.jd.com")) {
							shopName = link.textContent?.trim() || null;
							if (shopName) break;
						}
					}
				}

				// Sales: "已售X万+" or fallback to "X万+条评价"
				let sales: string | null = null;
				for (const span of item.querySelectorAll("span[title]")) {
					const title = span.getAttribute("title") || "";
					if (/^已售/.test(title)) {
						sales = title.replace("已售", "");
						break;
					}
				}
				if (!sales) {
					for (const span of item.querySelectorAll("span")) {
						const text = span.textContent?.trim() || "";
						if (/^已售[\d万+]+/.test(text)) {
							sales = text.replace("已售", "");
							break;
						}
					}
				}
				if (!sales) {
					for (const span of item.querySelectorAll("span[title]")) {
						const title = span.getAttribute("title") || "";
						if (/条评价/.test(title)) {
							sales = title;
							break;
						}
					}
				}

				const img = item.querySelector("img");
				const imgSrc = img?.getAttribute("data-src") || img?.getAttribute("src");
				const image = imgSrc ? (imgSrc.startsWith("//") ? `https:${imgSrc}` : imgSrc) : null;

				products.push({ skuId, name, price, shopName, sales, image });
			}

			return { keyword, page: pageNum, resultCount: products.length, products };
		},
		{ keyword, pageNum },
	);
}

/* ---------- getProductDetail ---------- */

async function getProductDetail(
	page: Page,
	params: Record<string, unknown>,
	errors: Errors,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw errors.missingParam("skuId");

	const { wareData } = await interceptProductApis(page, skuId);
	if (!wareData) return { skuId, name: null, price: null };

	const attrs = (wareData.productAttributeVO as Record<string, unknown>)?.attributes as Array<Record<string, string>> | undefined;
	const price = wareData.price as Record<string, string> | undefined;
	const shop = wareData.itemShopInfo as Record<string, unknown> | undefined;
	const head = wareData.skuHeadVO as Record<string, unknown> | undefined;
	const mainImage = wareData.mainImageVO as Record<string, unknown> | undefined;
	const colorSize = wareData.colorSizeVO as Record<string, unknown> | undefined;
	const stock = wareData.stockVO as Record<string, unknown> | undefined;
	const crumbs = (wareData.crumbInfoVO as Record<string, unknown>)?.crumbs as Array<Record<string, string>> | undefined;

	const findAttr = (name: string) => attrs?.find((a) => a.labelName === name)?.labelValue || null;

	// Images from mainImageVO carousel
	const carousel = (mainImage?.carouselArea as Array<Record<string, string>>) || [];
	const images = carousel.map((img) => {
		const src = img.imageUrl || img.bigUrl || "";
		return src.startsWith("//") ? `https:${src}` : src.startsWith("http") ? src : `https://img14.360buyimg.com/n1/${src}`;
	}).filter(Boolean);

	// Variants from colorSizeVO
	const colorSizeList = (colorSize?.colorSizeList as Array<Record<string, unknown>>) || [];
	const variants = colorSizeList.flatMap((group) => {
		const buttons = (group.buttons as Array<Record<string, unknown>>) || [];
		return buttons.map((b) => ({
			skuId: String(b.skuId || ""),
			text: String(b.text || ""),
			image: b.fullImageUrl ? `https://img14.360buyimg.com/n1/${b.fullImageUrl}` : null,
		}));
	});

	return {
		skuId,
		name: (head?.skuTitle as string) || null,
		price: price?.p || null,
		originalPrice: price?.op || null,
		shopId: shop?.shopId != null ? String(shop.shopId) : null,
		shopName: (shop?.shopName as string) || null,
		brand: findAttr("品牌"),
		categories: crumbs?.map((c) => c.text) || [],
		images,
		variants,
		inStock: stock?.stockStateName !== "无货",
	};
}

/* ---------- getProductReviews ---------- */

async function getProductReviews(
	page: Page,
	params: Record<string, unknown>,
	errors: Errors,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw errors.missingParam("skuId");

	const { commentData } = await interceptProductApis(page, skuId);
	if (!commentData) return { totalCount: "0", goodRate: null, tags: [], reviews: [] };

	const tags = ((commentData.semanticTagList as Array<Record<string, unknown>>) || []).map((t) => ({
		label: String(t.name || ""),
		count: Number(t.count) || 0,
	}));

	const commentInfoList = (commentData.commentInfoList as Array<Record<string, unknown>>) || [];
	const reviews = commentInfoList.map((c) => ({
		user: String(c.userNickName || ""),
		content: String(c.commentData || ""),
		score: Number(c.commentScore) || 0,
	}));

	return {
		totalCount: String(commentData.allCntStr || commentData.allCnt || "0"),
		goodRate: (commentData.goodRate as string) || null,
		tags,
		reviews,
	};
}

/* ---------- getProductPrice ---------- */

async function getProductPrice(
	page: Page,
	params: Record<string, unknown>,
	errors: Errors,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw errors.missingParam("skuId");

	const { wareData } = await interceptProductApis(page, skuId);
	if (!wareData) return { skuId, currentPrice: null, originalPrice: null, currency: "CNY", inStock: null };

	const price = wareData.price as Record<string, string> | undefined;
	const stock = wareData.stockVO as Record<string, unknown> | undefined;
	const promo = wareData.promotion as Record<string, unknown> | undefined;

	const promotions: string[] = [];
	if (promo) {
		const promoList = (promo.promoInfoList as Array<Record<string, unknown>>) || [];
		for (const p of promoList) {
			const text = String(p.promoText || p.content || "");
			if (text) promotions.push(text);
		}
	}

	return {
		skuId,
		currentPrice: price?.p || null,
		originalPrice: price?.op || null,
		currency: "CNY",
		inStock: stock?.stockStateName !== "无货",
		promotions: promotions.length > 0 ? promotions : null,
	};
}

/* ---------- Adapter ---------- */

const OPERATIONS: Record<
	string,
	(page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>
> = {
	searchProducts,
	getProductDetail,
	getProductReviews,
	getProductPrice,
};

const adapter: CustomRunner = {
	name: "jd-global-api",
	description: "JD — search via DOM, detail/price/reviews via API intercept",

	async run(ctx) {
		const { page, operation, params, helpers } = ctx;
		const { errors } = helpers as { errors: Errors };
		const handler = OPERATIONS[operation];
		if (!handler) throw errors.unknownOp(operation);
		try {
			return await handler(page as Page, { ...params }, errors);
		} catch (error) {
			throw errors.wrap(error);
		}
	},
};

export default adapter;
