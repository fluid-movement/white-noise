import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The whole app is client-only (ssr = false in +layout.ts) and prerendered
			// to a static index.html, so it deploys as plain static files.
			adapter: adapter()
		}),
		SvelteKitPWA({
			// Prompt (not autoUpdate): a new deploy surfaces an in-app "update
			// available" pill instead of silently reloading, so an update never
			// interrupts noise that's playing. Registration + polling live in
			// +layout.svelte.
			registerType: 'prompt',
			injectRegister: false,
			manifest: {
				name: 'White Noise',
				short_name: 'Noise',
				start_url: '/',
				display: 'standalone',
				background_color: '#0a0a0c',
				theme_color: '#0a0a0c',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{
						src: '/icons/icon-512-maskable.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			// The plugin's SvelteKit-aware Workbox defaults (prerendered/** + client/**)
			// handle precaching; no custom globPatterns needed.
			//
			// The service worker only builds for production (`vite build` / `preview`);
			// keeping it off during `vite dev` avoids noisy empty-precache warnings.
			// Test the installed PWA against the build or the deployed site.
			devOptions: {
				enabled: false
			}
		})
	]
});
