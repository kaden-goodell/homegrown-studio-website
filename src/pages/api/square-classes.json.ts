import type { APIRoute } from 'astro';

// Format date with timezone offset like: 2026-01-11T20:00:18.668-05:00
function formatDateWithOffset(date: Date): string {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
	const minutes = String(Math.abs(offset) % 60).padStart(2, '0');

	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hour = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	const sec = String(date.getSeconds()).padStart(2, '0');
	const ms = String(date.getMilliseconds()).padStart(3, '0');

	return `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}${sign}${hours}:${minutes}`;
}

export const GET: APIRoute = async ({ url }) => {
	const locationId = import.meta.env.SQUARE_LOCATION_ID || 'LTHCH1W1J3Y4Q';

	// Date range: now to 5 years from now (like their widget does)
	const now = new Date();
	const endDate = new Date();
	endDate.setFullYear(endDate.getFullYear() + 5);

	const requestBody = {
		cursor: null,
		sort: { field: 'START_AT' },
		query: {
			filter: {
				location_id: locationId,
				starting_at: {
					start_at: formatDateWithOffset(now),
					end_at: formatDateWithOffset(endDate)
				},
				status: 'CLASS_SCHEDULE_ACTIVE'
			}
		},
		includes: ['CLASS_SCHEDULE'],
		limit: 50
	};

	try {
		const response = await fetch(
			`https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search?unit_token=${locationId}`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
					'Origin': 'https://book.squareup.com',
					'Referer': 'https://book.squareup.com/',
					'sec-fetch-dest': 'empty',
					'sec-fetch-mode': 'cors',
					'sec-fetch-site': 'same-site',
				},
				body: JSON.stringify(requestBody)
			}
		);

		if (!response.ok) {
			const errorText = await response.text();
			return new Response(
				JSON.stringify({
					error: `Square API error: ${response.status}`,
					details: errorText,
					requestBody
				}),
				{ status: response.status, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const data = await response.json();

		// Build a lookup map for class schedules
		const classScheduleMap = new Map();
		if (data.included_resources?.class_schedules) {
			for (const schedule of data.included_resources.class_schedules) {
				classScheduleMap.set(schedule.id, schedule);
			}
		}

		// Merge class details into each instance
		const mergedClasses = (data.class_schedule_instances || []).map((instance: any) => {
			const classDetails = classScheduleMap.get(instance.class_schedule_id) || {};

			return {
				// Instance-specific data
				id: instance.id,
				startAt: instance.start_at,
				availableCapacity: instance.available_capacity,
				deleted: instance.deleted,

				// Class details
				classScheduleId: instance.class_schedule_id,
				name: classDetails.name || 'Unnamed Class',
				description: classDetails.description || '',
				descriptionHtml: classDetails.description_html || '',
				durationMinutes: classDetails.duration_minutes || 60,
				price: (classDetails.price_amount || 0) / 100, // Convert cents to dollars
				priceFormatted: ((classDetails.price_amount || 0) / 100).toFixed(2),
				currency: classDetails.price_currency || 'USD',
				staffName: classDetails.staff_name || '',
				teamMemberId: classDetails.team_member_id || '',
				status: classDetails.status || 'unknown',
			};
		});

		// Sort by date
		mergedClasses.sort((a: any, b: any) =>
			new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
		);

		return new Response(
			JSON.stringify({
				classes: mergedClasses,
				total: mergedClasses.length,
				cursor: data.cursor
			}, null, 2),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
				requestBody
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
