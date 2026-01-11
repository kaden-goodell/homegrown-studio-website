// Workshop data model based on Square Catalog + Bookings API

import type { SquareClient } from 'square';

export interface SquareMoney {
	amount: string;
	currency: string;
}

export interface SquareVariation {
	id: string;
	created_at: string;
	updatedAt: string;
	isDeleted: boolean;
	type: 'ITEM_VARIATION';
	itemVariationData: {
		itemId: string;
		name: string;
		ordinal: number;
		priceMoney: SquareMoney;
		pricingType: string;
		sellable: boolean;
		stockable: boolean;
		channels: string[];
	};
}

export interface SquareCatalogItem {
	id: string;
	type: 'ITEM';
	created_at: string;
	updatedAt: string;
	isDeleted: boolean;
	presentAtAllLocations: boolean;
	itemData: {
		name: string;
		description: string;
		descriptionHtml?: string;
		descriptionPlaintext?: string;
		productType: string;
		isTaxable: boolean;
		isArchived: boolean;
		isAlcoholic: boolean;
		skipModifierScreen: boolean;
		categories: Array<{ id: string; ordinal: string }>;
		variations: SquareVariation[];
		channels: string[];
		imageIds?: string[];
	};
}

// Our clean workshop model
export interface WorkshopSlot {
	// Identifiers
	id: string;
	variationId: string;

	// Display info
	name: string;
	description: string;
	descriptionHtml: string;

	// Pricing
	price: number; // in dollars
	priceFormatted: string;
	currency: string;

	// Media
	imageUrl: string | null;

	// Scheduling (from Bookings API - not available in Catalog)
	scheduledDate: Date | null;
	scheduledDateFormatted: string | null;

	// Availability
	availableSlots: number | null;
	isSoldOut: boolean;

	// Metadata
	productType: string;
	createdAt: Date;
	updatedAt: Date;
}

export class Workshop {
	slots: WorkshopSlot[] = [];

	constructor(catalogItems: SquareCatalogItem[], inventoryCounts?: Map<string, number>) {
		this.slots = this.parseItems(catalogItems, inventoryCounts);
	}

	private parseItems(items: any[], inventoryCounts?: Map<string, number>): WorkshopSlot[] {
		const slots: WorkshopSlot[] = [];

		for (const item of items) {
			// Handle both camelCase and snake_case from Square API
			const itemData = item.itemData || item.item_data;
			if (!itemData) {
				console.log('No itemData for item:', item.id);
				continue;
			}

			const imageIds = itemData.imageIds || itemData.image_ids || [];
			const imageUrl = imageIds[0]
				? `https://items-images-production.s3.us-west-2.amazonaws.com/files/${imageIds[0]}/original.jpeg`
				: null;

			const variations = itemData.variations || [];
			console.log(`Item ${itemData.name} has ${variations.length} variations`);

			for (const variation of variations) {
				// Handle both camelCase and snake_case
				const varData = variation.itemVariationData || variation.item_variation_data;
				if (!varData) {
					console.log('No varData for variation:', variation.id);
					continue;
				}

				const priceMoney = varData.priceMoney || varData.price_money || {};
				const priceInCents = parseInt(priceMoney.amount || '0', 10);
				const price = priceInCents / 100;

				const availableSlots = inventoryCounts?.get(variation.id) ?? null;
				const isSoldOut = availableSlots !== null && availableSlots <= 0;

				const createdAt = item.created_at || item.createdAt;
				const updatedAt = item.updatedAt || item.updated_at;

				slots.push({
					id: item.id,
					variationId: variation.id,
					name: itemData.name || 'Unnamed Workshop',
					description: itemData.descriptionPlaintext || itemData.description_plaintext || itemData.description || '',
					descriptionHtml: itemData.descriptionHtml || itemData.description_html || itemData.description || '',
					price,
					priceFormatted: price.toFixed(2),
					currency: priceMoney.currency || 'USD',
					imageUrl,
					scheduledDate: null, // Would come from Bookings API
					scheduledDateFormatted: null,
					availableSlots,
					isSoldOut,
					productType: itemData.productType || itemData.product_type || 'REGULAR',
					createdAt: createdAt ? new Date(createdAt) : new Date(),
					updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
				});
			}
		}

		console.log(`parseItems created ${slots.length} slots`);
		return slots;
	}

	// Sort methods
	sortByName(ascending = true): WorkshopSlot[] {
		return [...this.slots].sort((a, b) => {
			const comparison = a.name.localeCompare(b.name);
			return ascending ? comparison : -comparison;
		});
	}

	sortByPrice(ascending = true): WorkshopSlot[] {
		return [...this.slots].sort((a, b) => {
			const comparison = a.price - b.price;
			return ascending ? comparison : -comparison;
		});
	}

	sortByDate(ascending = true): WorkshopSlot[] {
		return [...this.slots].sort((a, b) => {
			if (!a.scheduledDate && !b.scheduledDate) return 0;
			if (!a.scheduledDate) return 1;
			if (!b.scheduledDate) return -1;
			const comparison = a.scheduledDate.getTime() - b.scheduledDate.getTime();
			return ascending ? comparison : -comparison;
		});
	}

	sortByCreated(ascending = false): WorkshopSlot[] {
		return [...this.slots].sort((a, b) => {
			const comparison = a.createdAt.getTime() - b.createdAt.getTime();
			return ascending ? comparison : -comparison;
		});
	}

	// Filter methods
	search(query: string): WorkshopSlot[] {
		const q = query.toLowerCase().trim();
		if (!q) return this.slots;

		return this.slots.filter(slot =>
			slot.name.toLowerCase().includes(q) ||
			slot.description.toLowerCase().includes(q)
		);
	}

	filterByPriceRange(min: number, max: number): WorkshopSlot[] {
		return this.slots.filter(slot => slot.price >= min && slot.price <= max);
	}

	filterAvailable(): WorkshopSlot[] {
		return this.slots.filter(slot => !slot.isSoldOut);
	}

	filterByDateRange(start: Date, end: Date): WorkshopSlot[] {
		return this.slots.filter(slot => {
			if (!slot.scheduledDate) return false;
			return slot.scheduledDate >= start && slot.scheduledDate <= end;
		});
	}

	// Getters
	get count(): number {
		return this.slots.length;
	}

	get availableCount(): number {
		return this.slots.filter(s => !s.isSoldOut).length;
	}

	// Serialize for client-side use
	toJSON(): WorkshopSlot[] {
		return this.slots.map(slot => ({
			...slot,
			scheduledDate: slot.scheduledDate?.toISOString() || null,
			createdAt: slot.createdAt.toISOString(),
			updatedAt: slot.updatedAt.toISOString(),
		})) as any;
	}
}

// Fetch scheduled class times from Square Bookings API
export async function fetchBookingAvailability(client: any, locationId?: string): Promise<Map<string, Array<{ startAt: Date; endAt: Date; spotsAvailable: number }>>> {
	const availabilityMap = new Map<string, Array<{ startAt: Date; endAt: Date; spotsAvailable: number }>>();

	try {
		// Get location ID if not provided
		if (!locationId) {
			const locationsResponse = await client.locations.list();
			const locations = locationsResponse.result?.locations || [];
			locationId = locations[0]?.id;
		}

		if (!locationId) {
			console.log('No location found for bookings');
			return availabilityMap;
		}

		// Search for available booking slots
		const now = new Date();
		const endDate = new Date();
		endDate.setMonth(endDate.getMonth() + 3); // Look 3 months ahead

		const searchResponse = await client.bookings.searchAvailability({
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

		const availabilities = searchResponse.result?.availabilities || [];

		for (const availability of availabilities) {
			const serviceVariationId = availability.serviceVariationId;
			if (!serviceVariationId) continue;

			if (!availabilityMap.has(serviceVariationId)) {
				availabilityMap.set(serviceVariationId, []);
			}

			availabilityMap.get(serviceVariationId)!.push({
				startAt: new Date(availability.startAt),
				endAt: new Date(availability.startAt), // Calculate based on duration if available
				spotsAvailable: availability.appointmentSegments?.[0]?.availableCapacity || 1,
			});
		}
	} catch (err) {
		console.log('Bookings API not available or error:', err instanceof Error ? err.message : err);
	}

	return availabilityMap;
}

// Alternative: Fetch from catalog custom attributes if dates are stored there
export function parseDateFromCustomAttributes(item: any): Date | null {
	const customAttributes = item.customAttributeValues;
	if (!customAttributes) return null;

	// Look for common date field names
	const dateFields = ['date', 'class_date', 'event_date', 'start_date', 'scheduled_date'];

	for (const field of dateFields) {
		if (customAttributes[field]) {
			const dateValue = customAttributes[field].stringValue || customAttributes[field].dateValue;
			if (dateValue) {
				const parsed = new Date(dateValue);
				if (!isNaN(parsed.getTime())) return parsed;
			}
		}
	}

	return null;
}
