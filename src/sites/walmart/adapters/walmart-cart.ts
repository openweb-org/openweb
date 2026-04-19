import type { Page } from "patchright";

import type { CustomRunner } from "../../../types/adapter.js";
/**
 * Walmart L3 adapter — cart operations via persisted GraphQL mutations.
 *
 * PerimeterX blocks CDP full-page navigations, but in-page fetch() calls
 * work — provided the request carries Walmart's canonical orchestra headers
 * (x-o-platform, x-o-mart, x-apollo-operation-name, wm_qos.correlation_id…).
 * Without them the orchestra gateway returns 418 (anti-bot fingerprint).
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
	mergeAndGetCart:
		"effc66bed0da38a9a774caaf24844ca6880bbc62eeece7ab46a6868c48ed91b8",
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

/** Ensure the page is on a walmart.com tab so orchestra fetch() carries the
 *  right Origin + cookies. The runtime PagePlan navigates here by default. */
async function ensureWalmartPage(page: Page): Promise<void> {
	const url = page.url();
	if (!url.includes("walmart.com")) {
		await page.goto("https://www.walmart.com/", {
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

	await ensureWalmartPage(page);

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
			const orchestraHeaders = (op: string): Record<string, string> => ({
				"Content-Type": "application/json",
				accept: "application/json",
				"x-apollo-operation-name": op,
				"x-o-gql-query": `mutation ${op}`,
				"x-o-platform": "rweb",
				"x-o-mart": "B2C",
				"x-o-bu": "WALMART-US",
				"x-o-segment": "oaoh",
				"x-o-ccm": "server",
				wm_mp: "true",
				"wm_qos.correlation_id": randId(28),
				"x-o-correlation-id": randId(28),
				wm_page_url: location.href,
			});

			// Step 1: Fetch product page to get offerId from __NEXT_DATA__
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
			const product =
				nextData?.props?.pageProps?.initialData?.data?.product;
			if (!product) throw new Error("No product data in __NEXT_DATA__");
			const offerId: string = product.offerId;
			const productName: string = product.name || "";
			if (!offerId)
				throw new Error(`No offerId found for product ${usItemId}`);

			// Step 2: Get or create cart via MergeAndGetCart
			const cartResp = await fetch(
				`/orchestra/cartxo/graphql/MergeAndGetCart/${hashes.mergeAndGetCart}`,
				{
					method: "POST",
					headers: orchestraHeaders("MergeAndGetCart"),
					credentials: "include",
					body: JSON.stringify({
						variables: {
							input: {
								strategy: "MERGE",
								enableLiquorBox: true,
								enableCartSplitClarity: false,
								features: [],
							},
						},
					}),
				},
			);
			if (!cartResp.ok)
				throw new Error(`MergeAndGetCart failed: ${cartResp.status}`);
			const cartJson = (await cartResp.json()) as {
				data?: { MergeAndGetCart?: { id?: string } };
			};
			const cartId = cartJson.data?.MergeAndGetCart?.id;
			if (!cartId) throw new Error("No cartId from MergeAndGetCart");

			// Step 3: Add item to cart via updateItems
			const addResp = await fetch(
				`/orchestra/home/graphql/updateItems/${hashes.updateItems}`,
				{
					method: "POST",
					headers: orchestraHeaders("updateItems"),
					credentials: "include",
					body: JSON.stringify({
						variables: {
							input: {
								cartId,
								items: [
									{
										offerId,
										usItemId,
										quantity,
										name: productName,
									},
								],
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
								priceInfo?: {
									currentPrice?: { priceString?: string };
								};
							};
							priceInfo?: {
								linePrice?: { value?: number };
							};
						}>;
					};
				};
				errors?: Array<{ message: string }>;
			};

			if (addJson.errors?.length) {
				throw new Error(
					`addToCart error: ${addJson.errors[0].message}`,
				);
			}

			const cart = addJson.data?.updateItems;
			if (!cart) throw new Error("No cart data in updateItems response");

			const addedItem = cart.lineItems?.find(
				(li) => li.product?.usItemId === usItemId,
			);
			const lineItems = cart.lineItems || [];

			return {
				cartId: cart.id || cartId,
				cartCount: lineItems.reduce(
					(sum: number, li: { quantity: number }) =>
						sum + li.quantity,
					0,
				),
				item: {
					usItemId,
					name: addedItem?.product?.name || productName,
					quantity: addedItem?.quantity || quantity,
					price: addedItem?.priceInfo?.linePrice?.value || 0,
					priceString:
						addedItem?.product?.priceInfo?.currentPrice
							?.priceString || "",
					imageUrl:
						addedItem?.product?.imageInfo?.thumbnailUrl || null,
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

	await ensureWalmartPage(page);

	// Single combined flow — minimise orchestra calls (Walmart rate-limits
	// /orchestra/cartxo aggressively). One MergeAndGetCart, optional seed via
	// updateItems if the item is missing, then a second updateItems to set
	// quantity:0. Idempotent for verify/replay (no paired addToCart needed).
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
			const orchestraHeaders = (op: string): Record<string, string> => ({
				"Content-Type": "application/json",
				accept: "application/json",
				"x-apollo-operation-name": op,
				"x-o-gql-query": `mutation ${op}`,
				"x-o-platform": "rweb",
				"x-o-mart": "B2C",
				"x-o-bu": "WALMART-US",
				"x-o-segment": "oaoh",
				"x-o-ccm": "server",
				wm_mp: "true",
				"wm_qos.correlation_id": randId(28),
				"x-o-correlation-id": randId(28),
				wm_page_url: location.href,
			});

			// Step 1: Get current cart + line items.
			const cartResp = await fetch(
				`/orchestra/cartxo/graphql/MergeAndGetCart/${hashes.mergeAndGetCart}`,
				{
					method: "POST",
					headers: orchestraHeaders("MergeAndGetCart"),
					credentials: "include",
					body: JSON.stringify({
						variables: {
							input: {
								strategy: "MERGE",
								enableLiquorBox: true,
								enableCartSplitClarity: false,
								features: [],
							},
						},
					}),
				},
			);
			if (!cartResp.ok)
				throw new Error(`MergeAndGetCart failed: ${cartResp.status}`);
			const cartJson = (await cartResp.json()) as {
				data?: {
					MergeAndGetCart?: {
						id?: string;
						lineItems?: Array<{
							product?: { usItemId?: string };
						}>;
					};
				};
			};
			const cartId = cartJson.data?.MergeAndGetCart?.id;
			if (!cartId) throw new Error("No cartId from MergeAndGetCart");
			const present = (
				cartJson.data?.MergeAndGetCart?.lineItems || []
			).some((li) => li.product?.usItemId === usItemId);

			// Step 2 (optional): seed the item if missing, so the remove has
			// a real line to act on.
			if (!present) {
				const productResp = await fetch(`/ip/p/${usItemId}`, {
					credentials: "include",
				});
				if (!productResp.ok)
					throw new Error(
						`Product fetch failed: ${productResp.status}`,
					);
				const html = await productResp.text();
				const ndMatch = html.match(
					/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
				);
				if (!ndMatch)
					throw new Error("No __NEXT_DATA__ in product page");
				const nextData = JSON.parse(ndMatch[1]);
				const product =
					nextData?.props?.pageProps?.initialData?.data?.product;
				if (!product)
					throw new Error("No product data in __NEXT_DATA__");
				const offerId: string = product.offerId;
				const productName: string = product.name || "";
				if (!offerId)
					throw new Error(`No offerId for product ${usItemId}`);

				const seedResp = await fetch(
					`/orchestra/home/graphql/updateItems/${hashes.updateItems}`,
					{
						method: "POST",
						headers: orchestraHeaders("updateItems"),
						credentials: "include",
						body: JSON.stringify({
							variables: {
								input: {
									cartId,
									items: [
										{
											offerId,
											usItemId,
											quantity: 1,
											name: productName,
										},
									],
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
					throw new Error(
						`updateItems (seed) failed: ${seedResp.status}`,
					);
			}

			// Step 3: Remove the item by setting quantity to 0.
			const removeResp = await fetch(
				`/orchestra/home/graphql/updateItems/${hashes.updateItems}`,
				{
					method: "POST",
					headers: orchestraHeaders("updateItems"),
					credentials: "include",
					body: JSON.stringify({
						variables: {
							input: {
								cartId,
								items: [
									{
										usItemId,
										quantity: 0,
									},
								],
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
				throw new Error(
					`updateItems (remove) failed: ${removeResp.status}`,
				);
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
				throw new Error(
					`removeFromCart error: ${removeJson.errors[0].message}`,
				);
			}

			const cart = removeJson.data?.updateItems;
			if (!cart) throw new Error("No cart data in updateItems response");

			const lineItems = cart.lineItems || [];

			return {
				cartId: cart.id || cartId,
				cartCount: lineItems.reduce(
					(sum: number, li: { quantity: number }) =>
						sum + li.quantity,
					0,
				),
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
