/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
		extend: {},
	},
	plugins: [require('daisyui')],
	daisyui: {
		themes: [
			{
				homegrown: {
					"primary": "#7c3aed",
					"primary-content": "#ffffff",
					"secondary": "#db2777",
					"secondary-content": "#ffffff",
					"accent": "#f59e0b",
					"neutral": "#1f2937",
					"base-100": "#ffffff",
					"base-200": "#f3f4f6",
					"base-300": "#e5e7eb",
					"info": "#3b82f6",
					"success": "#10b981",
					"warning": "#f59e0b",
					"error": "#ef4444",
				},
			},
		],
	},
}
