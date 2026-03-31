import type { Page } from "playwright-core";
import { OpenWebError, toOpenWebError } from "../../../lib/errors.js";
/**
 * JD L3 adapter — h5st-signed API calls + DOM extraction via page.evaluate().
 *
 * Covers two domains:
 *   global.jd.com — public data (recommendations, promos, categories)
 *   search/item/cart.jd.com — logged-in data (search, detail, reviews, cart)
 *
 * Operations:
 *   getRecommendations     — homepage product recommendations (37 products)
 *   getPromoBanners        — promotional banner ads
 *   getSquarePromotions    — square promotional modules
 *   getNewsMessages        — site news/announcements
 *   getCategoryNavigation  — category tree from DOM
 *   searchProducts         — product search by keyword (requires login)
 *   getProductDetail       — product detail by skuId (requires login)
 *   getProductReviews      — product reviews by skuId (requires login)
 *   getCart                — shopping cart contents (requires login)
 *   getHotSearchWords      — trending search keywords (requires login)
 */
import type { CodeAdapter } from "../../../types/adapter.js";

const JD_GLOBAL = "https://global.jd.com";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureJdPage(page: Page): Promise<void> {
	if (!page.url().includes("global.jd.com")) {
		await page.evaluate((url: string) => {
			window.location.href = url;
		}, JD_GLOBAL);
		await sleep(5000);
		await page
			.waitForLoadState("networkidle", { timeout: 10000 })
			.catch(() => {}); // intentional: best-effort wait for network idle
	}
}

/**
 * Call api.m.jd.com with PSign h5st signing from browser context.
 */
async function signedApiCall(
	page: Page,
	functionId: string,
	body: Record<string, unknown>,
): Promise<unknown> {
	return page.evaluate(
		async ({
			functionId,
			bodyStr,
		}: { functionId: string; bodyStr: string }) => {
			const t = String(Date.now());

			// Use PSign to generate h5st signature
			const PSign = (window as unknown as { PSign: { sign: (p: Record<string, string>) => Promise<Record<string, string>> } }).PSign;
			if (!PSign?.sign)
				throw new Error("PSign not available — page not ready");

			const signed = await PSign.sign({
				functionId,
				body: bodyStr,
				appid: "oversea_pc",
				client: "wh5",
				t,
			});

			const params = new URLSearchParams(
				signed as unknown as Record<string, string>,
			);
			const res = await fetch(
				`https://api.m.jd.com/?${params.toString()}`,
				{ credentials: "include" },
			);
			return res.json();
		},
		{ functionId, bodyStr: JSON.stringify(body) },
	);
}

async function queryModule(
	page: Page,
	moduleType: string,
	moduleId: string,
	moduleName: string,
): Promise<unknown> {
	const body = {
		stage: 0,
		commentType: "",
		sourceCode: "pcDt",
		pageId: "",
		qryParam: JSON.stringify([
			{ type: moduleType, mapTo: moduleName, id: moduleId },
		]),
		applyKey: moduleName,
	};

	const result = (await signedApiCall(
		page,
		"qryCompositeMaterials",
		body,
	)) as {
		code: string;
		data: Record<string, unknown>;
	};
	if (result.code !== "0") throw OpenWebError.apiError("JD Global", `API error: ${result.code}`);
	return result.data?.[moduleName];
}

/* ---------- Operations ---------- */

interface JdProduct {
	skuId: string;
	name: string;
	jdPrice: string;
	pcpPrice: string;
	pPrice: string;
	shopId: number;
	shopName: string;
	commentCount: number;
	goodRate: string;
	image: string;
	classIdL1: string;
	classIdL2: string;
	classIdL3: string;
	brandId: string;
}

async function getRecommendations(
	page: Page,
	_params: Record<string, unknown>,
): Promise<unknown> {
	await ensureJdPage(page);
	await sleep(2000);

	const data = (await queryModule(
		page,
		"productGroup",
		"12240015",
		"recommend",
	)) as { list: JdProduct[]; groupName: string };
	if (!data?.list) throw OpenWebError.apiError("JD Global", "No recommendation data returned");

	return {
		title: data.groupName || "为你推荐",
		count: data.list.length,
		products: data.list.map((p: JdProduct) => ({
			skuId: p.skuId,
			name: p.name,
			jdPrice: p.jdPrice,
			originalPrice: p.pcpPrice,
			promotionalPrice: p.pPrice,
			shopId: p.shopId,
			shopName: p.shopName,
			commentCount: p.commentCount,
			goodRate: p.goodRate,
			image: p.image ? `https:${p.image}` : null,
			categoryL1: p.classIdL1,
			categoryL2: p.classIdL2,
			categoryL3: p.classIdL3,
			brandId: p.brandId,
		})),
	};
}

interface JdBanner {
	advertId: string;
	name: string;
	pictureUrl: string;
	link: string;
	desc: string;
}

async function getPromoBanners(
	page: Page,
	_params: Record<string, unknown>,
): Promise<unknown> {
	await ensureJdPage(page);
	await sleep(2000);

	const data = (await queryModule(
		page,
		"advertGroup",
		"05382124",
		"banners",
	)) as { list: JdBanner[]; groupName: string };
	if (!data?.list) throw OpenWebError.apiError("JD Global", "No banner data returned");

	return {
		title: data.groupName || "首焦",
		banners: data.list.map((b: JdBanner) => ({
			id: b.advertId,
			name: b.name,
			image: b.pictureUrl ? `https:${b.pictureUrl}` : null,
			link: b.link,
			description: b.desc,
		})),
	};
}

async function getSquarePromotions(
	page: Page,
	_params: Record<string, unknown>,
): Promise<unknown> {
	await ensureJdPage(page);
	await sleep(2000);

	// Fetch both square modules
	const [left, right] = await Promise.all([
		queryModule(
			page,
			"advertGroup",
			"06813315",
			"squareLeft",
		) as Promise<{ list: JdBanner[]; groupName: string }>,
		queryModule(
			page,
			"advertGroup",
			"06813381",
			"squareRight",
		) as Promise<{ list: JdBanner[]; groupName: string }>,
	]);

	const mapBanners = (list: JdBanner[]) =>
		(list || []).map((b) => ({
			id: b.advertId,
			name: b.name,
			image: b.pictureUrl ? `https:${b.pictureUrl}` : null,
			link: b.link,
		}));

	return {
		left: {
			title: left?.groupName || "会场模块",
			items: mapBanners(left?.list),
		},
		right: {
			title: right?.groupName || "会场模块小",
			items: mapBanners(right?.list),
		},
	};
}

async function getNewsMessages(
	page: Page,
	_params: Record<string, unknown>,
): Promise<unknown> {
	await ensureJdPage(page);
	await sleep(2000);

	const data = (await queryModule(
		page,
		"advertGroup",
		"06784803",
		"messages",
	)) as { list: JdBanner[]; groupName: string };
	if (!data?.list) throw OpenWebError.apiError("JD Global", "No message data returned");

	return {
		title: data.groupName || "全球特讯",
		messages: data.list.map((m: JdBanner) => ({
			id: m.advertId,
			title: m.name,
			link: m.link,
			description: m.desc,
		})),
	};
}

async function getCategoryNavigation(
	page: Page,
	_params: Record<string, unknown>,
): Promise<unknown> {
	await ensureJdPage(page);
	await sleep(2000);

	return page.evaluate(() => {
		// Extract category navigation from the sidebar (floor 1)
		const categoryFloor = document.querySelectorAll(".floor")[1];
		if (!categoryFloor) return { categories: [] };

		const allLinks = categoryFloor.querySelectorAll("a[href]");
		const categories: { name: string; url: string }[] = [];
		const seen = new Set<string>();

		for (const link of allLinks) {
			const a = link as HTMLAnchorElement;
			const name = a.textContent?.trim();
			if (
				name &&
				name.length > 0 &&
				name.length < 20 &&
				!seen.has(name) &&
				!name.includes("登录") &&
				!name.includes("注册") &&
				!name.includes("福利") &&
				!name.includes("切换") &&
				!name.includes("退出") &&
				!name.includes("PLUS") &&
				!name.includes("更多") &&
				!name.includes("物流") &&
				!name.includes("客户") &&
				!name.includes("售后") &&
				!a.href.includes("passport") &&
				!a.href.includes("home.jd.com") &&
				!a.href.includes("vip.jd.com") &&
				!a.href.includes("plus.jd.com") &&
				!a.href.includes("help.jd.com") &&
				!a.href.includes("jdcs.jd.com") &&
				!a.href.includes("phat.jd.com")
			) {
				seen.add(name);
				categories.push({ name, url: a.href });
			}
		}

		return { categories };
	});
}

/* ---------- Navigation helpers for main JD site ---------- */

async function ensureSearchPage(page: Page): Promise<void> {
	if (!page.url().includes("search.jd.com")) {
		await page.evaluate(() => {
			window.location.href = "https://search.jd.com/Search?keyword=手机";
		});
		await sleep(5000);
		await page
			.waitForLoadState("networkidle", { timeout: 10000 })
			.catch(() => {});
	}
}

async function navigateToItem(page: Page, skuId: string): Promise<void> {
	const url = `https://item.jd.com/${skuId}.html`;
	if (!page.url().includes(`item.jd.com/${skuId}`)) {
		await page.evaluate((u: string) => {
			window.location.href = u;
		}, url);
		await sleep(5000);
		await page
			.waitForLoadState("networkidle", { timeout: 10000 })
			.catch(() => {});
	}
}

async function ensureCartPage(page: Page): Promise<void> {
	if (!page.url().includes("cart.jd.com")) {
		await page.evaluate(() => {
			window.location.href = "https://cart.jd.com/cart_index";
		});
		await sleep(5000);
		await page
			.waitForLoadState("networkidle", { timeout: 10000 })
			.catch(() => {});
	}
}

/* ---------- New operations (require login) ---------- */

interface SearchWare {
	wareId: string;
	skuId: string;
	wareName: string;
	jdPrice: string;
	realPrice: string;
	oriPrice: string;
	averageScore: string;
	good: string;
	comment: string;
	totalSales: string;
	shopId: string;
	shopName: string;
	imageurl: string;
	selfSupport: number;
	brandId: string;
}

async function searchProducts(
	page: Page,
	params: Record<string, unknown>,
): Promise<unknown> {
	const keyword = String(params.keyword || "");
	if (!keyword) throw OpenWebError.validation("keyword is required");
	const pageNum = Number(params.page) || 1;

	await ensureSearchPage(page);
	await sleep(1000);

	return page.evaluate(
		async ({ keyword, pageNum }: { keyword: string; pageNum: number }) => {
			const t = String(Date.now());
			const body = JSON.stringify({
				enc: "utf-8",
				keyword,
				page: pageNum,
				s: (pageNum - 1) * 30 + 1,
				scrolling: "y",
				log_id: t,
				tpl: "1_M",
				isList: 0,
			});
			const url = `https://api.m.jd.com/api?appid=search-pc-java&functionId=pc_search_searchWare&client=pc&clientVersion=1.0.0&loginType=3&keyword=${encodeURIComponent(keyword)}&body=${encodeURIComponent(body)}&t=${t}`;
			const res = await fetch(url, { credentials: "include" });
			const data = await res.json();

			if (data.code !== 0) throw new Error(`Search API error: ${data.code}`);
			const wl = data.data?.wareList || [];

			return {
				keyword,
				page: pageNum,
				resultCount: data.data?.resultCount || 0,
				products: wl.map(
					(w: {
						wareId: string;
						skuId: string;
						wareName: string;
						jdPrice: string;
						oriPrice: string;
						averageScore: string;
						good: string;
						comment: string;
						totalSales: string;
						shopId: string;
						shopName: string;
						imageurl: string;
						selfSupport: number;
					}) => ({
						skuId: w.skuId || w.wareId,
						name: w.wareName?.replace(/<[^>]*>/g, ""),
						jdPrice: w.jdPrice,
						originalPrice: w.oriPrice,
						averageScore: w.averageScore,
						goodRate: w.good ? `${w.good}%` : null,
						commentCount: w.comment,
						totalSales: w.totalSales,
						shopId: w.shopId,
						shopName: w.shopName,
						image: w.imageurl
							? `https://img14.360buyimg.com/n1/${w.imageurl}`
							: null,
						isJdSelf: w.selfSupport === 1,
					}),
				),
			};
		},
		{ keyword, pageNum },
	);
}

interface PageConfigProduct {
	skuid: number;
	name: string;
	shopId: string;
	venderId: number;
	cat: number[];
	brand: number;
	brandName?: string;
	imageList: string[];
	colorSize: Array<Record<string, string | number>>;
	warestatus: number;
	desc?: string;
}

async function getProductDetail(
	page: Page,
	params: Record<string, unknown>,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw OpenWebError.validation("skuId is required");

	await navigateToItem(page, skuId);
	await sleep(2000);

	return page.evaluate(() => {
		const pc = (
			window as unknown as { pageConfig?: { product?: Record<string, unknown> } }
		).pageConfig;
		if (!pc?.product) throw new Error("Product data not found on page");
		const p = pc.product;

		// Extract price from DOM
		const priceMatch = document.body?.innerText?.match(/￥([\d,.]+)/);
		const price = priceMatch ? priceMatch[1] : null;

		// Extract review summary from DOM
		const reviewMatch = document.body?.innerText?.match(
			/累计评价\s*\n?\s*(\d+)/,
		);
		const rateMatch = document.body?.innerText?.match(/好评率高达(\d+%)/);

		return {
			skuId: String(p.skuid),
			name: p.name as string,
			price,
			shopId: p.shopId as string,
			venderId: p.venderId as number,
			brand: p.brand as number,
			brandName: p.brandName as string | undefined,
			categories: p.cat as number[],
			images: ((p.imageList as string[]) || []).map(
				(img: string) => `https://img14.360buyimg.com/n1/${img}`,
			),
			variants: (
				(p.colorSize as Array<Record<string, string | number>>) || []
			).map((v) => {
				const copy = { ...v };
				const vid = copy.skuId;
				copy.skuId = undefined;
				return { skuId: String(vid), ...copy };
			}),
			reviewCount: reviewMatch ? Number(reviewMatch[1]) : null,
			goodRate: rateMatch ? rateMatch[1] : null,
			inStock: (p.warestatus as number) !== 0,
		};
	});
}

async function getProductReviews(
	page: Page,
	params: Record<string, unknown>,
): Promise<unknown> {
	const skuId = String(params.skuId || "");
	if (!skuId) throw OpenWebError.validation("skuId is required");

	await navigateToItem(page, skuId);
	await sleep(2000);

	return page.evaluate(() => {
		const bodyText = document.body?.innerText || "";

		// Extract review count and rate
		const countMatch = bodyText.match(/买家评价\((\d+)\)/);
		const rateMatch = bodyText.match(/好评率高达(\d+%)/);

		// Extract individual reviews from the comment section
		const commentStart = bodyText.indexOf("买家评价");
		const commentEnd = bodyText.indexOf("问大家");
		const commentSection =
			commentStart > 0
				? bodyText.substring(
						commentStart,
						commentEnd > commentStart ? commentEnd : commentStart + 800,
					)
				: "";

		// Parse individual reviews: pattern is "username\nreview text"
		const reviewLines = commentSection.split("\n").filter((l) => l.trim());
		const reviews: Array<{ user: string; content: string }> = [];
		// Skip first two lines ("买家评价(N)" and "好评率高达X%")
		for (let i = 2; i < reviewLines.length - 1; i += 2) {
			const user = reviewLines[i]?.trim();
			const content = reviewLines[i + 1]?.trim();
			if (
				user &&
				content &&
				!content.includes("全部评价") &&
				user.includes("*")
			) {
				reviews.push({ user, content });
			}
		}

		return {
			totalCount: countMatch ? Number(countMatch[1]) : 0,
			goodRate: rateMatch ? rateMatch[1] : null,
			reviews,
		};
	});
}

async function getCart(
	page: Page,
	_params: Record<string, unknown>,
): Promise<unknown> {
	await ensureCartPage(page);
	await sleep(3000);

	return page.evaluate(() => {
		const bodyText = document.body?.innerText || "";
		const cartMatch = bodyText.match(/购物车\((\d+)\)/);
		const totalCount = cartMatch ? Number(cartMatch[1]) : 0;

		// Parse cart items from rendered DOM text
		// Each item section contains: shop name, product name, price, quantity
		const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
		const items: Array<{
			name: string;
			price: string | null;
			shop: string | null;
		}> = [];

		let currentShop: string | null = null;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Shop names end with "旗舰店", "专区", "自营" etc.
			if (
				line.match(/(旗舰店|专卖店|专区|自营)$/) &&
				!line.includes("¥") &&
				line.length < 30
			) {
				currentShop = line;
				continue;
			}
			// Product names are long lines (>15 chars) not starting with ¥
			if (
				line.length > 15 &&
				!line.startsWith("¥") &&
				!line.startsWith("￥") &&
				!line.startsWith("商品") &&
				!line.includes("7天价保") &&
				!line.includes("购物车") &&
				!line.includes("京东") &&
				!line.includes("配送至") &&
				(line.includes("版") ||
					line.includes("册") ||
					line.includes("机") ||
					line.includes("书") ||
					line.includes("装") ||
					lines[i + 1]?.match(/^[¥￥]/) ||
					lines[i + 2]?.match(/^[¥￥]/))
			) {
				// Look for price in next few lines
				let price: string | null = null;
				for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
					const pm = lines[j].match(/^[¥￥]([\d,.]+)/);
					if (pm) {
						price = pm[1];
						break;
					}
				}
				items.push({
					name: line.substring(0, 100),
					price,
					shop: currentShop,
				});
			}
		}

		return { totalCount, items };
	});
}

async function getHotSearchWords(
	page: Page,
	_params: Record<string, unknown>,
): Promise<unknown> {
	await ensureSearchPage(page);
	await sleep(1000);

	return page.evaluate(async () => {
		const t = String(Date.now());
		const url = `https://api.m.jd.com/api?appid=search-pc-java&functionId=pc_search_hotwords&client=pc&clientVersion=1.0.0&t=${t}`;
		const res = await fetch(url, { credentials: "include" });
		const json = await res.json();

		if (json.code !== 0) throw new Error(`Hot words API error: ${json.code}`);
		const items = json.data || [];

		return {
			words: (items as Array<{ ext_columns?: { text?: string } }>)
				.map(
					(item: { ext_columns?: { text?: string } }) =>
						item.ext_columns?.text,
				)
				.filter(Boolean),
		};
	});
}

const OPERATIONS: Record<
	string,
	(page: Page, params: Record<string, unknown>) => Promise<unknown>
> = {
	getRecommendations,
	getPromoBanners,
	getSquarePromotions,
	getNewsMessages,
	getCategoryNavigation,
	searchProducts,
	getProductDetail,
	getProductReviews,
	getCart,
	getHotSearchWords,
};

const adapter: CodeAdapter = {
	name: "jd-global-api",
	description:
		"JD — product search, detail, reviews, cart, recommendations, and promotions",

	async init(page: Page): Promise<boolean> {
		const url = page.url();
		return (
			url.includes("global.jd.com") ||
			url.includes("jd.com") ||
			url.includes("item.jd.com") ||
			url.includes("search.jd.com") ||
			url.includes("cart.jd.com")
		);
	},

	async isAuthenticated(page: Page): Promise<boolean> {
		return page.evaluate(() => {
			return document.cookie.includes("pin=") || document.body?.innerText?.includes("购物车") || false;
		});
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
