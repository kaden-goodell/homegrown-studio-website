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

		// Get ALL catalog items (no filtering)
		let allItems: any[] = [];
		const catalogResponse = client.catalog.list();

		if (catalogResponse[Symbol.asyncIterator]) {
			for await (const item of catalogResponse) {
				allItems.push(item);
			}
		}

		// Group by type for easy viewing
		const byType: Record<string, any[]> = {};
		for (const item of allItems) {
			const type = item.type || 'unknown';
			if (!byType[type]) byType[type] = [];

			// For ITEM types, also note the productType
			const productType = item.itemData?.productType || null;
			byType[type].push({
				id: item.id,
				type: item.type,
				productType,
				name: item.itemData?.name || item.categoryData?.name || item.id,
			});
		}

		return new Response(
			JSON.stringify({
				totalItems: allItems.length,
				byType,
				// Also show raw items with APPOINTMENTS_SERVICE
				appointmentServices: allItems.filter(i =>
					i.itemData?.productType === 'APPOINTMENTS_SERVICE'
				),
			}, (key, value) =>
				typeof value === 'bigint' ? value.toString() : value
			, 2),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		return new Response(
			JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
