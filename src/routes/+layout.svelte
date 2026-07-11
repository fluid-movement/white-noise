<script lang="ts">
	import { onMount } from 'svelte';

	let { children } = $props();

	let needRefresh = $state(false);
	let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

	onMount(async () => {
		if (!('serviceWorker' in navigator)) return;
		const { registerSW } = await import('virtual:pwa-register');
		updateSW = registerSW({
			immediate: true,
			onNeedRefresh() {
				// A new service worker is waiting → offer the update.
				needRefresh = true;
			},
			onRegisteredSW(_swUrl, registration) {
				// Poll so a new deploy is noticed while the app stays open, not
				// only on a cold relaunch.
				if (registration) {
					setInterval(() => registration.update(), 60_000);
				}
			}
		});
	});

	function applyUpdate() {
		needRefresh = false;
		// Activates the waiting worker and reloads to the new version.
		updateSW?.(true);
	}
</script>

{@render children()}

{#if needRefresh}
	<button type="button" class="update-toast" onclick={applyUpdate}>
		Update available · tap to refresh
	</button>
{/if}

<style>
	.update-toast {
		position: fixed;
		top: calc(env(safe-area-inset-top) + 0.75rem);
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		border: none;
		border-radius: 999px;
		padding: 0.6rem 1.15rem;
		background: #caa06a;
		color: #14161f;
		font:
			600 0.8rem/1 system-ui,
			sans-serif;
		letter-spacing: 0.01em;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		cursor: pointer;
	}
</style>
