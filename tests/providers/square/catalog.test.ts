import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCatalog = {
	list: vi.fn(),
	object: {
		get: vi.fn(),
	},
	batchGet: vi.fn(),
}

vi.mock('square', () => {
	return {
		SquareClient: class MockSquareClient {
			catalog = mockCatalog
			constructor(_opts: any) {}
		},
	}
})

import { SquareCatalogProvider } from '../../../src/providers/square/catalog'

const baseConfig = {
	accessToken: 'test-token',
	environment: 'sandbox' as const,
	locationId: 'loc-1',
	applicationId: 'app-1',
}

function makeItem(overrides: Record<string, any> = {}) {
	return {
		id: 'ITEM-1',
		type: 'ITEM',
		itemData: {
			name: 'Pottery Class',
			description: 'A fun pottery class',
			categories: [{ id: 'CAT-1', name: 'Workshops' }],
			variations: [
				{
					id: 'VAR-1',
					itemVariationData: {
						name: 'Adult',
						priceMoney: { amount: 5000n, currency: 'USD' },
						serviceDuration: 3600000, // 60 min in ms
					},
				},
				{
					id: 'VAR-2',
					itemVariationData: {
						name: 'Child',
						priceMoney: { amount: 2500n, currency: 'USD' },
					},
				},
			],
			modifierListInfo: [],
			imageIds: ['IMG-1'],
		},
		...overrides,
	}
}

function makeModifierList(id: string, modifiers: any[]) {
	return {
		id,
		modifierListData: {
			modifiers,
		},
	}
}

describe('SquareCatalogProvider', () => {
	let provider: SquareCatalogProvider

	beforeEach(() => {
		vi.clearAllMocks()
		provider = new SquareCatalogProvider(baseConfig)
	})

	describe('getEventTypes', () => {
		it('maps Square catalog items to EventType interface', async () => {
			const item = makeItem()

			// Mock async iterator for catalog.list
			mockCatalog.list.mockReturnValue(
				(async function* () {
					yield item
				})()
			)

			const result = await provider.getEventTypes()

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				id: 'ITEM-1',
				name: 'Pottery Class',
				description: 'A fun pottery class',
				category: 'Workshops',
				imageUrl:
					'https://items-images-production.s3.us-west-2.amazonaws.com/files/IMG-1/original.jpeg',
				variations: [
					{ id: 'VAR-1', name: 'Adult', priceAmount: 5000, priceCurrency: 'USD' },
					{ id: 'VAR-2', name: 'Child', priceAmount: 2500, priceCurrency: 'USD' },
				],
				modifiers: [],
				flow: 'booking',
				duration: 60,
			})
		})

		it('filters by category', async () => {
			const workshopItem = makeItem()
			const classItem = makeItem({
				id: 'ITEM-2',
				itemData: {
					name: 'Yoga Class',
					description: 'Relaxing yoga',
					categories: [{ id: 'CAT-2', name: 'Classes' }],
					variations: [
						{
							id: 'VAR-3',
							itemVariationData: {
								name: 'Standard',
								priceMoney: { amount: 2000n, currency: 'USD' },
							},
						},
					],
					modifierListInfo: [],
				},
			})

			mockCatalog.list.mockReturnValue(
				(async function* () {
					yield workshopItem
					yield classItem
				})()
			)

			const result = await provider.getEventTypes({ category: 'Classes' })

			expect(result).toHaveLength(1)
			expect(result[0].name).toBe('Yoga Class')
			expect(result[0].category).toBe('Classes')
		})

		it('converts BigInt money amounts to Number', async () => {
			const item = makeItem({
				itemData: {
					name: 'Expensive Workshop',
					description: 'Very premium',
					categories: [],
					variations: [
						{
							id: 'VAR-BIG',
							itemVariationData: {
								name: 'Premium',
								priceMoney: { amount: 99999n, currency: 'USD' },
							},
						},
					],
					modifierListInfo: [],
				},
			})

			mockCatalog.list.mockReturnValue(
				(async function* () {
					yield item
				})()
			)

			const result = await provider.getEventTypes()

			expect(result[0].variations[0].priceAmount).toBe(99999)
			expect(typeof result[0].variations[0].priceAmount).toBe('number')
		})

		it('fetches and maps modifier lists as modifiers', async () => {
			const item = makeItem({
				itemData: {
					name: 'Art Class',
					description: 'Creative art',
					categories: [{ id: 'CAT-1', name: 'Art' }],
					variations: [
						{
							id: 'VAR-1',
							itemVariationData: {
								name: 'Standard',
								priceMoney: { amount: 3000n, currency: 'USD' },
							},
						},
					],
					modifierListInfo: [{ modifierListId: 'MODLIST-1' }],
					imageIds: [],
				},
			})

			mockCatalog.list.mockReturnValue(
				(async function* () {
					yield item
				})()
			)

			mockCatalog.batchGet.mockResolvedValue({
				objects: [
					makeModifierList('MODLIST-1', [
						{
							id: 'MOD-1',
							modifierData: {
								name: 'Extra Supplies',
								priceMoney: { amount: 500n, currency: 'USD' },
							},
						},
						{
							id: 'MOD-2',
							modifierData: {
								name: 'Canvas Upgrade',
								priceMoney: { amount: 1000n, currency: 'USD' },
							},
						},
					]),
				],
			})

			const result = await provider.getEventTypes()

			expect(result[0].modifiers).toHaveLength(2)
			expect(result[0].modifiers[0]).toEqual({
				id: 'MOD-1',
				name: 'Extra Supplies',
				priceAmount: 500,
				priceCurrency: 'USD',
			})
			expect(result[0].modifiers[1]).toEqual({
				id: 'MOD-2',
				name: 'Canvas Upgrade',
				priceAmount: 1000,
				priceCurrency: 'USD',
			})
		})

		it('defaults duration to 60 when serviceDuration is missing', async () => {
			const item = makeItem({
				itemData: {
					name: 'No Duration',
					description: '',
					categories: [],
					variations: [
						{
							id: 'VAR-1',
							itemVariationData: {
								name: 'Default',
								priceMoney: { amount: 1000n, currency: 'USD' },
								// no serviceDuration
							},
						},
					],
					modifierListInfo: [],
				},
			})

			mockCatalog.list.mockReturnValue(
				(async function* () {
					yield item
				})()
			)

			const result = await provider.getEventTypes()
			expect(result[0].duration).toBe(60)
		})

		it('sets flow to quote when custom attribute specifies it', async () => {
			const item = makeItem({
				customAttributeValues: {
					flow: { stringValue: 'quote' },
				},
			})

			mockCatalog.list.mockReturnValue(
				(async function* () {
					yield item
				})()
			)

			const result = await provider.getEventTypes()
			expect(result[0].flow).toBe('quote')
		})
	})

	describe('getAddOns', () => {
		it('returns correct modifiers for a given event type', async () => {
			mockCatalog.object.get.mockResolvedValue({
				itemData: {
					modifierListInfo: [{ modifierListId: 'MODLIST-1' }],
				},
			})

			mockCatalog.batchGet.mockResolvedValue({
				objects: [
					makeModifierList('MODLIST-1', [
						{
							id: 'MOD-A',
							modifierData: {
								name: 'Gift Wrap',
								priceMoney: { amount: 300n, currency: 'USD' },
							},
						},
					]),
				],
			})

			const result = await provider.getAddOns('ITEM-1')

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				id: 'MOD-A',
				name: 'Gift Wrap',
				priceAmount: 300,
				priceCurrency: 'USD',
			})
		})

		it('returns empty array when no modifier lists exist', async () => {
			mockCatalog.object.get.mockResolvedValue({
				itemData: {
					modifierListInfo: [],
				},
			})

			const result = await provider.getAddOns('ITEM-1')
			expect(result).toEqual([])
		})
	})

	describe('getPricing', () => {
		it('returns correct variation pricing', async () => {
			mockCatalog.object.get.mockResolvedValue({
				itemData: {
					variations: [
						{
							id: 'VAR-1',
							itemVariationData: {
								name: 'Adult',
								priceMoney: { amount: 5000n, currency: 'USD' },
							},
						},
						{
							id: 'VAR-2',
							itemVariationData: {
								name: 'Child',
								priceMoney: { amount: 2500n, currency: 'USD' },
							},
						},
					],
				},
			})

			const result = await provider.getPricing('ITEM-1', 'VAR-2')

			expect(result).toEqual({
				id: 'VAR-2',
				name: 'Child',
				priceAmount: 2500,
				priceCurrency: 'USD',
			})
		})

		it('throws when variation is not found', async () => {
			mockCatalog.object.get.mockResolvedValue({
				itemData: {
					variations: [
						{
							id: 'VAR-1',
							itemVariationData: {
								name: 'Adult',
								priceMoney: { amount: 5000n, currency: 'USD' },
							},
						},
					],
				},
			})

			await expect(provider.getPricing('ITEM-1', 'VAR-MISSING')).rejects.toThrow(
				'Variation VAR-MISSING not found on item ITEM-1'
			)
		})
	})
})
