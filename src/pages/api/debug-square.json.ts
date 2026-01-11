import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
	try {
		const { default: squarePkg } = await import('square');

		const client = new squarePkg.SquareClient({
			token: import.meta.env.SQUARE_ACCESS_TOKEN,
			environment: import.meta.env.SQUARE_ENVIRONMENT === 'production'
				? squarePkg.SquareEnvironment.Production
				: squarePkg.SquareEnvironment.Sandbox,
		});

		const apiResponse = await client.catalog.list(undefined, 'ITEM');
		const items = apiResponse.result?.objects || apiResponse.response?.objects || apiResponse.data || [];

		// Filter for workshop items only
		const workshopCategory = items.find(item =>
			item.type === 'CATEGORY' &&
			item.categoryData?.name === 'Workshop'
		);
		const workshopCategoryId = workshopCategory?.id;

		const workshopItems = items.filter(item => {
			if (item.type !== 'ITEM') return false;
			const categories = item.itemData?.categories || [];
			return categories.some(cat => cat.id === workshopCategoryId);
		});

		return new Response(
			JSON.stringify(workshopItems, (key, value) =>
				typeof value === 'bigint' ? value.toString() : value
			, 2),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	} catch (error) {
		return new Response(
			JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
