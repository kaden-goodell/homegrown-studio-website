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

		console.log('=== STARTING API REQUEST ===');

		// Fetch catalog items from Square
		const apiResponse = await client.catalog.list(undefined, 'ITEM');

		console.log('=== RAW API RESPONSE ===');
		console.log('apiResponse keys:', Object.keys(apiResponse));
		console.log('apiResponse.result exists?', !!apiResponse.result);
		console.log('apiResponse.response exists?', !!apiResponse.response);
		console.log('apiResponse.data exists?', !!apiResponse.data);

		if (apiResponse.response) {
			console.log('apiResponse.response type:', typeof apiResponse.response);
			console.log('apiResponse.response keys:', Object.keys(apiResponse.response));
			console.log('apiResponse.response:', JSON.stringify(apiResponse.response, (key, value) =>
				typeof value === 'bigint' ? value.toString() : value
			, 2).substring(0, 500));
		}

		if (apiResponse.data) {
			console.log('apiResponse.data type:', typeof apiResponse.data);
			console.log('apiResponse.data is array?', Array.isArray(apiResponse.data));
			console.log('apiResponse.data length:', apiResponse.data?.length);
			console.log('apiResponse.data:', JSON.stringify(apiResponse.data, (key, value) =>
				typeof value === 'bigint' ? value.toString() : value
			, 2).substring(0, 500));
		}

		// Get the data from the response - try multiple possible locations
		const items = apiResponse.result?.objects || apiResponse.response?.objects || apiResponse.data || [];

		console.log('=== ITEMS ARRAY ===');
		console.log('items length:', items.length);
		console.log('items:', JSON.stringify(items, (key, value) =>
			typeof value === 'bigint' ? value.toString() : value
		, 2));

		if (!items || items.length === 0) {
			console.log('No items found, returning empty array');
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

		console.log('=== WORKSHOP CATEGORY ===');
		console.log('workshopCategory found?', !!workshopCategory);
		console.log('workshopCategoryId:', workshopCategoryId);

		// Filter for classes with Workshop category
		const classes = items
			.filter(item => {
				console.log(`=== FILTERING ITEM: ${item.id} ===`);
				console.log('item.type:', item.type);

				// Only process ITEM types (not CATEGORY, etc.)
				if (item.type !== 'ITEM') {
					console.log('Filtered out: not an ITEM type');
					return false;
				}

				// Check if item has Workshop category
				const categories = item.itemData?.categories || [];
				console.log('item.itemData.categories:', categories);

				const hasWorkshopCategory = categories.some(cat => cat.id === workshopCategoryId);
				console.log('hasWorkshopCategory?', hasWorkshopCategory);

				return hasWorkshopCategory;
			})
			.map(item => {
				console.log(`=== MAPPING ITEM: ${item.id} ===`);
				const itemData = item.itemData;
				const variation = itemData?.variations?.[0];

				console.log('itemData.name:', itemData?.name);
				console.log('itemData.description:', itemData?.description);
				console.log('variation exists?', !!variation);
				console.log('variation.itemVariationData:', variation?.itemVariationData);

				// Get price amount and convert from cents to dollars
				const amountInCents = variation?.itemVariationData?.priceMoney?.amount;
				console.log('amountInCents:', amountInCents);
				console.log('amountInCents type:', typeof amountInCents);

				const price = amountInCents
					? (Number(amountInCents) / 100).toFixed(2)
					: '0.00';
				console.log('calculated price:', price);

				const mappedClass = {
					id: item.id,
					name: itemData?.name || 'Unnamed Class',
					description: itemData?.description || '',
					price: price,
					currency: variation?.itemVariationData?.priceMoney?.currency || 'USD',
					category: itemData?.categoryId || null,
					imageUrl: itemData?.imageIds?.[0]
						? `https://items-images-production.s3.us-west-2.amazonaws.com/files/${itemData.imageIds[0]}/original.jpeg`
						: null,
					// Add more fields as needed
				};

				console.log('mappedClass:', JSON.stringify(mappedClass, null, 2));
				return mappedClass;
			});

		console.log('=== FINAL CLASSES ARRAY ===');
		console.log('classes length:', classes.length);
		console.log('classes:', JSON.stringify(classes, null, 2));

		// Filter by date if provided
		let filteredClasses = classes;
		if (filterDate) {
			// This is a simple example - you'll need to implement actual date filtering
			// based on how you store class dates in Square (custom attributes, etc.)
			// For now, we'll return all classes
			filteredClasses = classes;
		}

		console.log('=== RETURNING RESPONSE ===');
		console.log('filteredClasses count:', filteredClasses.length);

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
