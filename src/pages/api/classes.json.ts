import type { APIRoute } from 'astro';
import squarePkg from 'square';

// Initialize Square client
const client = new squarePkg.SquareClient({
	token: import.meta.env.SQUARE_ACCESS_TOKEN,
	environment: import.meta.env.SQUARE_ENVIRONMENT === 'production'
		? squarePkg.SquareEnvironment.Production
		: squarePkg.SquareEnvironment.Sandbox,
});

export const GET: APIRoute = async ({ request }) => {
	try {
		const url = new URL(request.url);
		const filterDate = url.searchParams.get('date');

		// Fetch catalog items from Square
		const apiResponse = await client.catalog.list(undefined, 'ITEM');

		// Get the data from the response
		const items = apiResponse.result?.objects || apiResponse.response?.objects || apiResponse.data || [];

		if (!items || items.length === 0) {
			return new Response(JSON.stringify({ classes: [] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Find the Workshop category ID
		const workshopCategory = items.find(item =>
			item.type === 'CATEGORY' &&
			item.categoryData?.name === 'Workshop'
		);
		const workshopCategoryId = workshopCategory?.id;

		// Filter for classes with Workshop category
		const classes = items
			.filter(item => {
				// Only process ITEM types (not CATEGORY, etc.)
				if (item.type !== 'ITEM') {
					return false;
				}

				// Check if item has Workshop category
				const categories = item.itemData?.categories || [];
				const hasWorkshopCategory = categories.some(cat => cat.id === workshopCategoryId);

				return hasWorkshopCategory;
			})
			.map(item => {
				const itemData = item.itemData;
				const variation = itemData?.variations?.[0];

				// Get price amount and convert from cents to dollars
				const amountInCents = variation?.itemVariationData?.priceMoney?.amount;
				const price = amountInCents
					? (Number(amountInCents) / 100).toFixed(2)
					: '0.00';

				return {
					id: item.id,
					name: itemData?.name || 'Unnamed Class',
					description: itemData?.description || '',
					price: price,
					currency: variation?.itemVariationData?.priceMoney?.currency || 'USD',
					category: itemData?.categoryId || null,
					imageUrl: itemData?.imageIds?.[0]
						? `https://items-images-production.s3.us-west-2.amazonaws.com/files/${itemData.imageIds[0]}/original.jpeg`
						: null,
				};
			});

		// Filter by date if provided
		let filteredClasses = classes;
		if (filterDate) {
			// This is a simple example - you'll need to implement actual date filtering
			// based on how you store class dates in Square (custom attributes, etc.)
			// For now, we'll return all classes
			filteredClasses = classes;
		}

		return new Response(
			JSON.stringify({
				classes: filteredClasses,
				count: filteredClasses.length
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-cache, no-store, must-revalidate'
				}
			}
		);

	} catch (error) {
		console.error('Error fetching classes from Square:', error);

		return new Response(
			JSON.stringify({
				error: 'Failed to fetch classes',
				message: error instanceof Error ? error.message : 'Unknown error'
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};
