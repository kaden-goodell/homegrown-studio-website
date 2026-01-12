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

		const locationId = import.meta.env.SQUARE_LOCATION_ID || 'LTHCH1W1J3Y4Q';

		// Date range: now to 3 months from now
		const now = new Date();
		const endDate = new Date();
		endDate.setMonth(endDate.getMonth() + 3);

		const response = await client.bookings.searchAvailability({
			query: {
				filter: {
					locationId: locationId,
					startAtRange: {
						startAt: now.toISOString(),
						endAt: endDate.toISOString(),
					},
				},
			},
		});

		return new Response(
			JSON.stringify({
				availabilities: response.result?.availabilities || [],
				total: response.result?.availabilities?.length || 0,
				rawResult: response.result,
			}, (key, value) =>
				typeof value === 'bigint' ? value.toString() : value
			, 2),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
				details: error
			}, null, 2),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
