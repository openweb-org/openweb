import type { Page } from "playwright-core";
import { OpenWebError, toOpenWebError } from "../../../lib/errors.js";
import type { CodeAdapter } from "../../../types/adapter.js";

/**
 * JD L3 adapter — DOM extraction + page.evaluate(fetch) for product data.
 *
 * Covers:
 *   search.jd.com  — product search (DOM extraction, no auth needed)
 *   item.jd.com    — product detail, price, reviews (pageConfig + DOM)
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- searchProducts ---------- */

async function searchProducts(
	page: Page,
	params: Record<string, unknown>,
): Promise<unknown> {
	const keyword = String(params.keyword || "");
	if (!keyword) throw OpenWebError.validation("keyword is required");
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

				// Name from title attribute (robust across CSS module changes)
				const titleEl = item.querySelector("[title]");
				const name =
					titleEl?.getAttribute("title")?.trim() || null;

				// Price: walk text nodes to find ¥ + number pattern
				let price: string | null = null;
				const walker = document.createTreeWalker(
					item,
					NodeFilter.SHOW_TEXT,
				);
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const match = node.textContent?.match(/[¥￥]([\d,.]+)/);
					if (match) {
						price = match[1];
						break;
					}
				}

				// Shop from mall/shop links
				let shopName: string | null = null;
				const links = item.querySelectorAll("a");
				for (const link of links) {
					const href = link.getAttribute("href") || "";
					if (
						href.includes("mall.jd.com") ||
						href.includes("shop.jd.com")
					) {
						shopName = link.textContent?.trim() || null;
						break;
					}
				}

				// Sales volume from text matching "已售N+"
				let sales: string | null = null;
				const allSpans = item.querySelectorAll("span");
				for (const span of allSpans) {
					const text = span.getAttribute("title") || "";
					if (text.match(/已售[\d万+]+/)) {
						sales = text.replace("已售", "");
						break;
					}
				}

				// Image
				const img = item.querySelector("img");
				const imgSrc =
					img?.getAttribute("data-src") || img?.getAttribute("src");
				const image = imgSrc
					? imgSrc.startsWith("//")
						? `https:${imgSrc}`
						: imgSrc
					: null;

				products.push({
					skuId,
					name,
					price,
					shopName,
					sales,
					image,
				});
			}

			return {
				keyword,
				page: pageNum,
				resultCount: products.length,
				products,
			};
		},
		{ keyword, pageNum },
	);
}

/* ---------- getProductDetail ---------- */

async function getProductDetail(
	page: Page,
	params: Record<string, unknown>,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw OpenWebError.validation("skuId is required");

	await page.goto(`https://item.jd.com/${skuId}.html`, {
		waitUntil: "load",
		timeout: 30_000,
	});
	await sleep(4000);

	return page.evaluate(() => {
		const pc = (
			window as unknown as {
				pageConfig?: { product?: Record<string, unknown> };
			}
		).pageConfig;
		if (!pc?.product) throw new Error("Product data not found on page");
		const p = pc.product;

		// Price from DOM
		const priceEl = document.querySelector(".p-price .price, span.price");
		const price = priceEl?.textContent?.trim() || null;

		// Review summary from DOM
		const countEl = document.querySelector("#comment-count, .comment-count");
		const countText = countEl?.textContent?.trim() || "";
		const countMatch = countText.match(/([\d万+]+)/);

		return {
			skuId: String(p.skuid),
			name: p.name as string,
			price,
			shopId: p.shopId as string,
			venderId: p.venderId as number,
			brand: p.brand as number,
			brandName: (p.brandName as string) || null,
			categories: p.cat as number[],
			images: ((p.imageList as string[]) || []).map((img: string) =>
				img.startsWith("//")
					? `https:${img}`
					: img.startsWith("http")
						? img
						: `https://img14.360buyimg.com/n1/${img}`,
			),
			variants: (
				(p.colorSize as Array<Record<string, unknown>>) || []
			).map((v) => ({
				skuId: String(v.skuId),
				...Object.fromEntries(
					Object.entries(v).filter(([k]) => k !== "skuId"),
				),
			})),
			reviewCount: countMatch ? countMatch[1] : null,
			inStock: (p.warestatus as number) !== 0,
		};
	});
}

/* ---------- getProductReviews ---------- */

async function getProductReviews(
	page: Page,
	params: Record<string, unknown>,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw OpenWebError.validation("skuId is required");

	await page.goto(`https://item.jd.com/${skuId}.html`, {
		waitUntil: "load",
		timeout: 30_000,
	});
	await sleep(4000);

	return page.evaluate(() => {
		const bodyText = document.body?.innerText || "";

		// Extract count and rate from review section
		const countMatch = bodyText.match(/买家评价\(?([\d万+]+)\)?/);
		const rateMatch = bodyText.match(/好评率高达(\d+%?)/);

		// Extract tags (e.g., "物流速度快 1", "材料质量好 1")
		const tagSection = bodyText.match(
			/好评率高达\d+%\n([\s\S]*?)\n[^\n]*\*[^\n]*\n/,
		);
		const tags: Array<{ label: string; count: number }> = [];
		if (tagSection?.[1]) {
			const tagLines = tagSection[1].split("\n").filter((l) => l.trim());
			for (let i = 0; i < tagLines.length - 1; i += 2) {
				const label = tagLines[i]?.trim();
				const count = Number.parseInt(tagLines[i + 1]?.trim() || "0");
				if (label && !Number.isNaN(count)) {
					tags.push({ label, count });
				}
			}
		}

		// Extract individual reviews from .comment-root or DOM text
		const reviews: Array<{ user: string; content: string }> = [];
		const commentUsers = document.querySelectorAll(".comment-user");
		if (commentUsers.length > 0) {
			// Structured DOM extraction
			for (const userEl of commentUsers) {
				const user = userEl.textContent?.trim() || "";
				// Review content follows the user element
				const parent = userEl.closest("[class*='comment']");
				const fullText = parent?.textContent?.trim() || "";
				// Extract content after username
				const idx = fullText.indexOf(user);
				if (idx >= 0) {
					const content = fullText
						.substring(idx + user.length)
						.trim()
						.replace(/全部评价.*$/, "")
						.trim();
					if (user && content) {
						reviews.push({ user, content });
					}
				}
			}
		}

		// Fallback: parse from body text
		if (reviews.length === 0) {
			const reviewStart = bodyText.indexOf("好评率高达");
			const reviewEnd = bodyText.indexOf("全部评价");
			if (reviewStart > 0 && reviewEnd > reviewStart) {
				const section = bodyText.substring(reviewStart, reviewEnd);
				const lines = section.split("\n").filter((l) => l.trim());
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].includes("*")) {
						const user = lines[i].trim();
						const content = lines[i + 1]?.trim();
						if (user && content) {
							reviews.push({ user, content });
						}
					}
				}
			}
		}

		return {
			totalCount: countMatch ? countMatch[1] : "0",
			goodRate: rateMatch ? rateMatch[1] : null,
			tags,
			reviews,
		};
	});
}

/* ---------- getProductPrice ---------- */

async function getProductPrice(
	page: Page,
	params: Record<string, unknown>,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw OpenWebError.validation("skuId is required");

	await page.goto(`https://item.jd.com/${skuId}.html`, {
		waitUntil: "load",
		timeout: 30_000,
	});
	await sleep(4000);

	return page.evaluate(() => {
		const pc = (
			window as unknown as {
				pageConfig?: { product?: Record<string, unknown> };
			}
		).pageConfig;
		const skuid = pc?.product
			? String((pc.product as Record<string, unknown>).skuid)
			: null;

		// Current price from DOM
		const priceEl = document.querySelector(".p-price .price, span.price");
		const currentPrice = priceEl?.textContent?.trim() || null;

		// Original/reference price
		const oppEl = document.querySelector("#page_opprice, .summary-price-reference");
		const originalPrice = oppEl?.textContent?.trim()?.replace(/[¥￥]/g, "") || null;

		// Promotion info from DOM
		const promoEls = document.querySelectorAll(
			".J-prom-flag, .p-promotions, [class*='promo']",
		);
		const promotions: string[] = [];
		for (const el of promoEls) {
			const text = el.textContent?.trim();
			if (text && text.length < 200) promotions.push(text);
		}

		// In stock check
		const warestatus = pc?.product
			? ((pc.product as Record<string, unknown>).warestatus as number)
			: null;
		const inStock = warestatus !== 0;

		return {
			skuId: skuid,
			currentPrice,
			originalPrice: originalPrice || null,
			currency: "CNY",
			inStock,
			promotions: promotions.length > 0 ? promotions : null,
		};
	});
}

/* ---------- Adapter ---------- */

const OPERATIONS: Record<
	string,
	(page: Page, params: Record<string, unknown>) => Promise<unknown>
> = {
	searchProducts,
	getProductDetail,
	getProductReviews,
	getProductPrice,
};

const adapter: CodeAdapter = {
	name: "jd-global-api",
	description:
		"JD — product search, detail, reviews, and pricing via DOM extraction",

	async init(page: Page): Promise<boolean> {
		const url = page.url();
		return (
			url.includes("jd.com") ||
			url.includes("item.jd.com") ||
			url.includes("search.jd.com")
		);
	},

	async isAuthenticated(): Promise<boolean> {
		return true; // All ops work without login
	},

	async execute(
		page: Page,
		operation: string,
		params: Readonly<Record<string, unknown>>,
	): Promise<unknown> {
		try {
			const handler = OPERATIONS[operation];
			if (!handler) throw OpenWebError.unknownOp(operation);
			return handler(page, { ...params });
		} catch (error) {
			throw toOpenWebError(error);
		}
	},
};

export default adapter;
