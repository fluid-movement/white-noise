import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The whole page is client-only (ssr = false in +page.ts), so build it as a
			// static SPA shell: no server/runtime needed at all, just static files.
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
