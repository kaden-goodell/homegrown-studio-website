import type { APIRoute } from 'astro';
import squarePkg from 'square';

// Initialize Square client
const client = new squarePkg.SquareClient({
	accessToken: import.meta.env.SQUARE_ACCESS_TOKEN,
	environment: import.meta.env.SQUARE_ENVIRONMENT === 'production'
		? squarePkg.SquareEnvironment.Production
		: squarePkg.SquareEnvironment.Sandbox,
});

export const GET: APIRoute = async ({ request }) => {
	try {
		const url = new URL(request.url);
		const filterDate = url.searchParams.get('date');

		// Debug: Log environment variables
		const token = import.meta.env.SQUARE_ACCESS_TOKEN || '';
		const env = import.meta.env.SQUARE_ENVIRONMENT || '';
		console.log('DEBUG - Token prefix:', token.substring(0, 15));
		console.log('DEBUG - Environment:', env);
		console.log('DEBUG - Token length:', token.length);

		// Fetch catalog items from Square
		const { result } = await client.catalog.list(undefined, 'ITEM');

		if (!result.objects) {
			return new Response(JSON.stringify({ classes: [] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Filter for classes (not parties)
		// Assumes you tag classes differently than parties in Square
		// You can customize this logic based on your Square setup
		const classes = result.objects
			.filter(item => {
				// Filter out items with "party" or "private" in the name
				const name = item.itemData?.name?.toLowerCase() || '';
				return !name.includes('party') && !name.includes('private');
			})
			.map(item => {
				const itemData = item.itemData;
				const variation = itemData?.variations?.[0];

				return {
					id: item.id,
					name: itemData?.name || 'Unnamed Class',
					description: itemData?.description || '',
					price: variation?.itemVariationData?.priceMoney?.amount
						? (variation.itemVariationData.priceMoney.amount / 100).toFixed(2)
						: '0.00',
					currency: variation?.itemVariationData?.priceMoney?.currency || 'USD',
					category: itemData?.categoryId || null,
					imageUrl: itemData?.imageIds?.[0]
						? `https://items-images-production.s3.us-west-2.amazonaws.com/files/${itemData.imageIds[0]}/original.jpeg`
						: null,
					// Add more fields as needed
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

		const token = import.meta.env.SQUARE_ACCESS_TOKEN || '';
		const env = import.meta.env.SQUARE_ENVIRONMENT || '';

		return new Response(
			JSON.stringify({
				error: 'Failed to fetch classes',
				message: error instanceof Error ? error.message : 'Unknown error',
				debug: {
					tokenPrefix: token.substring(0, 15),
					tokenLength: token.length,
					environment: env,
					hasToken: !!token
				}
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};
