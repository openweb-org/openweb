import type { Page } from "patchright";

import type { CustomRunner } from "../../../types/adapter.js";
/**
 * Walmart L3 adapter — cart operations via persisted GraphQL mutations.
 *
 * Uses the SPA's natural call pattern instead of the older MergeAndGetCart
 * mutation. Walmart aggressively rate-limits POST /orchestra/cartxo/...
 * MergeAndGetCart (the previous implementation always hit it twice per op
 * and quickly tripped 429 even on logged-in sessions where the live UI
 * worked fine). The web UI almost always reads cart state via the GET
 * /orchestra/home/graphql/getCart query, so we mirror that.
 *
 * Operations:
 *   addToCart      — add a product to the cart by usItemId
 *   removeFromCart — remove a product from the cart by usItemId (qty=0).
 *                    Idempotent: if the item is not present, seeds it via
 *                    addToCart first so verify works without a paired
 *                    addToCart example.
 */

/** Persisted query hashes — derived from GraphQL query text, stable across deploys. */
const HASHES = {
	getCart:
		"68812b13d3ff790112f61d1fd5cd01383603ba881d1152721454f7ce2a441f82",
	updateItems:
		"3171442fac997fe8df7920c5ea06a5da50db7bcf66eff78d1b3e8009621592a0",
};

interface AddToCartResult {
	cartId: string;
	cartCount: number;
	item: {
		usItemId: string;
		name: string;
		quantity: number;
		price: number;
		priceString: string;
		imageUrl: string | null;
	};
}

interface RemoveFromCartResult {
	cartId: string;
	cartCount: number;
	removedItemId: string;
}

/** Ensure the page is on a real walmart.com page so the SPA bot-mitigation
 *  signals (cookies, akamai sensor) are warm and Origin/Referer are valid. */
async function ensureCartPage(page: Page): Promise<void> {
	const url = page.url();
	if (!url.includes("walmart.com/cart")) {
		await page.goto("https://www.walmart.com/cart", {
			waitUntil: "load",
			timeout: 60000,
		});
	}
}

async function addToCart(
	page: Page,
	params: Record<string, unknown>,
	errors: { missingParam(name: string): Error },
): Promise<AddToCartResult> {
	const usItemId = String(params.usItemId || "");
	if (!usItemId) throw errors.missingParam("usItemId");
	const quantity = Number(params.quantity) || 1;

	await ensureCartPage(page);

	return page.evaluate(
		async ({
			usItemId,
			quantity,
			hashes,
		}: {
			usItemId: string;
			quantity: number;
			hashes: typeof HASHES;
		}) => {
			const randId = (n: number) =>
				Array.from(crypto.getRandomValues(new Uint8Array(n)))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("")
					.slice(0, n);
			// Mirror the full header set the live SPA injects. Without
			// x-o-platform-version + tenant-id + traceparent + wm-client-traceid
			// Akamai's bot-mitigation layer treats orchestra calls as scripted
			// and returns 429 on the first hit. With them, the request is
			// indistinguishable from the real React app's fetch.
			const orchestraHeaders = (op: string, isMutation: boolean): Record<string, string> => {
				const corr = randId(28);
				const traceA = randId(32);
				const traceB = randId(16);
				return {
					"Content-Type": "application/json",
					accept: "application/json",
					"x-apollo-operation-name": op,
					"x-o-gql-query": `${isMutation ? "mutation" : "query"} ${op}`,
					"x-o-platform": "rweb",
					"x-o-platform-version": "usweb-1.256.1",
					"x-o-mart": "B2C",
					"x-o-bu": "WALMART-US",
					"x-o-segment": "oaoh",
					"x-o-ccm": "server",
					"x-latency-trace": "1",
					"tenant-id": "elh9ie",
					wm_mp: "true",
					"wm_qos.correlation_id": corr,
					"x-o-correlation-id": corr,
					"wm-client-traceid": randId(32),
					traceparent: `00-${traceA}-${traceB}-00`,
					wm_page_url: location.href,
				};
			};

			// Read current cart via the lightweight GET getCart query (what
			// the SPA itself uses on /cart). Avoid MergeAndGetCart (heavy
			// mutation, aggressively rate-limited).
			const getCartVars = {
				cartInput: { cartId: null, forceRefresh: false, enableLiquorBox: true, enableCartSplitClarity: false, features: [] },
				includePartialFulfillmentSwitching: true,
				enableAEBadge: false,
				includeExpressSla: true,
				enableACCScheduling: true,
			};
			const cartResp = await fetch(
				`/orchestra/home/graphql/getCart/${hashes.getCart}?variables=${encodeURIComponent(JSON.stringify(getCartVars))}`,
				{
					method: "GET",
					headers: orchestraHeaders("getCart", false),
					credentials: "include",
				},
			);
			if (!cartResp.ok)
				throw new Error(`getCart failed: ${cartResp.status}`);
			const cartJson = (await cartResp.json()) as {
				data?: { cart?: { id?: string } };
			};
			const cartId = cartJson.data?.cart?.id;
			if (!cartId) throw new Error("No cartId from getCart");

			// Fetch product page to get offerId from __NEXT_DATA__
			const productResp = await fetch(`/ip/p/${usItemId}`, {
				credentials: "include",
			});
			if (!productResp.ok)
				throw new Error(`Product fetch failed: ${productResp.status}`);
			const html = await productResp.text();
			const ndMatch = html.match(
				/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
			);
			if (!ndMatch) throw new Error("No __NEXT_DATA__ in product page");
			const nextData = JSON.parse(ndMatch[1]);
			const product = nextData?.props?.pageProps?.initialData?.data?.product;
			if (!product) throw new Error("No product data in __NEXT_DATA__");
			const offerId: string = product.offerId;
			const productName: string = product.name || "";
			if (!offerId)
				throw new Error(`No offerId found for product ${usItemId}`);

			// Add item via updateItems mutation
			const addResp = await fetch(
				`/orchestra/home/graphql/updateItems/${hashes.updateItems}`,
				{
					method: "POST",
					headers: orchestraHeaders("updateItems", true),
					credentials: "include",
					body: JSON.stringify({
						variables: {
							input: {
								cartId,
								items: [{ offerId, usItemId, quantity, name: productName }],
								enableCartSplitClarity: false,
								features: [],
							},
							includePartialFulfillmentSwitching: true,
							enableAEBadge: false,
							includeExpressSla: true,
							enableACCScheduling: true,
						},
					}),
				},
			);
			if (!addResp.ok)
				throw new Error(`updateItems failed: ${addResp.status}`);
			const addJson = (await addResp.json()) as {
				data?: {
					updateItems?: {
						id?: string;
						lineItems?: Array<{
							quantity: number;
							product?: {
								usItemId?: string;
								name?: string;
								imageInfo?: { thumbnailUrl?: string };
								priceInfo?: { currentPrice?: { priceString?: string } };
							};
							priceInfo?: { linePrice?: { value?: number } };
						}>;
					};
				};
				errors?: Array<{ message: string }>;
			};

			if (addJson.errors?.length) {
				throw new Error(`addToCart error: ${addJson.errors[0].message}`);
			}

			const cart = addJson.data?.updateItems;
			if (!cart) throw new Error("No cart data in updateItems response");

			const addedItem = cart.lineItems?.find(
				(li) => li.product?.usItemId === usItemId,
			);
			const lineItems = cart.lineItems || [];

			return {
				cartId: cart.id || cartId,
				cartCount: lineItems.reduce((sum, li) => sum + li.quantity, 0),
				item: {
					usItemId,
					name: addedItem?.product?.name || productName,
					quantity: addedItem?.quantity || quantity,
					price: addedItem?.priceInfo?.linePrice?.value || 0,
					priceString:
						addedItem?.product?.priceInfo?.currentPrice?.priceString || "",
					imageUrl: addedItem?.product?.imageInfo?.thumbnailUrl || null,
				},
			};
		},
		{ usItemId, quantity, hashes: HASHES },
	);
}

async function removeFromCart(
	page: Page,
	params: Record<string, unknown>,
	errors: { missingParam(name: string): Error },
): Promise<RemoveFromCartResult> {
	const usItemId = String(params.usItemId || "");
	if (!usItemId) throw errors.missingParam("usItemId");

	await ensureCartPage(page);

	return page.evaluate(
		async ({
			usItemId,
			hashes,
		}: {
			usItemId: string;
			hashes: typeof HASHES;
		}) => {
			const randId = (n: number) =>
				Array.from(crypto.getRandomValues(new Uint8Array(n)))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("")
					.slice(0, n);
			const orchestraHeaders = (op: string, isMutation: boolean): Record<string, string> => {
				const corr = randId(28);
				const traceA = randId(32);
				const traceB = randId(16);
				return {
					"Content-Type": "application/json",
					accept: "application/json",
					"x-apollo-operation-name": op,
					"x-o-gql-query": `${isMutation ? "mutation" : "query"} ${op}`,
					"x-o-platform": "rweb",
					"x-o-platform-version": "usweb-1.256.1",
					"x-o-mart": "B2C",
					"x-o-bu": "WALMART-US",
					"x-o-segment": "oaoh",
					"x-o-ccm": "server",
					"x-latency-trace": "1",
					"tenant-id": "elh9ie",
					wm_mp: "true",
					"wm_qos.correlation_id": corr,
					"x-o-correlation-id": corr,
					"wm-client-traceid": randId(32),
					traceparent: `00-${traceA}-${traceB}-00`,
					wm_page_url: location.href,
				};
			};

			// Step 1: read cart via lightweight getCart query.
			const getCartVars = {
				cartInput: { cartId: null, forceRefresh: false, enableLiquorBox: true, enableCartSplitClarity: false, features: [] },
				includePartialFulfillmentSwitching: true,
				enableAEBadge: false,
				includeExpressSla: true,
				enableACCScheduling: true,
			};
			const cartResp = await fetch(
				`/orchestra/home/graphql/getCart/${hashes.getCart}?variables=${encodeURIComponent(JSON.stringify(getCartVars))}`,
				{
					method: "GET",
					headers: orchestraHeaders("getCart", false),
					credentials: "include",
				},
			);
			if (!cartResp.ok)
				throw new Error(`getCart failed: ${cartResp.status}`);
			const cartJson = (await cartResp.json()) as {
				data?: {
					cart?: {
						id?: string;
						lineItems?: Array<{ product?: { usItemId?: string } }>;
					};
				};
			};
			const cartId = cartJson.data?.cart?.id;
			if (!cartId) throw new Error("No cartId from getCart");
			// getCart's lineItems shape may nest under groups; flatten defensively.
			const flatLineItems = (() => {
				const cart = cartJson.data?.cart as Record<string, unknown> | undefined
				if (!cart) return [] as Array<{ product?: { usItemId?: string; offerId?: string }; offerId?: string }>
				if (Array.isArray(cart.lineItems)) return cart.lineItems as Array<{ product?: { usItemId?: string; offerId?: string }; offerId?: string }>
				const groups = (cart as { groups?: Array<{ items?: Array<{ product?: { usItemId?: string; offerId?: string }; offerId?: string }> }> }).groups
				if (Array.isArray(groups)) {
					return groups.flatMap((g) => g.items || [])
				}
				return [] as Array<{ product?: { usItemId?: string; offerId?: string }; offerId?: string }>
			})()
			const existing = flatLineItems.find(
				(li) => li.product?.usItemId === usItemId,
			);
			let offerId: string | undefined = existing?.offerId || existing?.product?.offerId

			// Step 2: seed the item if missing so the remove has a real line.
			if (!existing) {
				const productResp = await fetch(`/ip/p/${usItemId}`, {
					credentials: "include",
				});
				if (!productResp.ok)
					throw new Error(`Product fetch failed: ${productResp.status}`);
				const html = await productResp.text();
				const ndMatch = html.match(
					/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
				);
				if (!ndMatch) throw new Error("No __NEXT_DATA__ in product page");
				const nextData = JSON.parse(ndMatch[1]);
				const product = nextData?.props?.pageProps?.initialData?.data?.product;
				if (!product) throw new Error("No product data in __NEXT_DATA__");
				offerId = product.offerId as string;
				const productName: string = product.name || "";
				if (!offerId) throw new Error(`No offerId for product ${usItemId}`);

				const seedResp = await fetch(
					`/orchestra/home/graphql/updateItems/${hashes.updateItems}`,
					{
						method: "POST",
						headers: orchestraHeaders("updateItems", true),
						credentials: "include",
						body: JSON.stringify({
							variables: {
								input: {
									cartId,
									items: [{ offerId, usItemId, quantity: 1, name: productName }],
									enableCartSplitClarity: false,
									features: [],
								},
								includePartialFulfillmentSwitching: true,
								enableAEBadge: false,
								includeExpressSla: true,
								enableACCScheduling: true,
							},
						}),
					},
				);
				if (!seedResp.ok)
					throw new Error(`updateItems (seed) failed: ${seedResp.status}`);
			}
			if (!offerId) throw new Error(`Could not resolve offerId for ${usItemId}`);

			// Step 3: remove by setting quantity to 0. Walmart requires offerId
			// on the remove side too — pull it from the existing line or the
			// seed step above.
			const removeResp = await fetch(
				`/orchestra/home/graphql/updateItems/${hashes.updateItems}`,
				{
					method: "POST",
					headers: orchestraHeaders("updateItems", true),
					credentials: "include",
					body: JSON.stringify({
						variables: {
							input: {
								cartId,
								items: [{ offerId, usItemId, quantity: 0 }],
								enableCartSplitClarity: false,
								features: [],
							},
							includePartialFulfillmentSwitching: true,
							enableAEBadge: false,
							includeExpressSla: true,
							enableACCScheduling: true,
						},
					}),
				},
			);
			if (!removeResp.ok)
				throw new Error(`updateItems (remove) failed: ${removeResp.status}`);
			const removeJson = (await removeResp.json()) as {
				data?: {
					updateItems?: {
						id?: string;
						lineItems?: Array<{ quantity: number }>;
					};
				};
				errors?: Array<{ message: string }>;
			};

			if (removeJson.errors?.length) {
				throw new Error(`removeFromCart error: ${removeJson.errors[0].message}`);
			}

			const cart = removeJson.data?.updateItems;
			if (!cart) throw new Error("No cart data in updateItems response");

			const lineItems = cart.lineItems || [];

			return {
				cartId: cart.id || cartId,
				cartCount: lineItems.reduce((sum, li) => sum + li.quantity, 0),
				removedItemId: usItemId,
			};
		},
		{ usItemId, hashes: HASHES },
	);
}

const adapter: CustomRunner = {
	name: "walmart-cart",
	description: "Walmart — cart operations via persisted GraphQL mutations",

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
		if (operation === "addToCart") {
			return addToCart(page as Page, { ...params }, errors);
		}
		if (operation === "removeFromCart") {
			return removeFromCart(page as Page, { ...params }, errors);
		}
		throw errors.unknownOp(operation);
	},
};

export default adapter;
