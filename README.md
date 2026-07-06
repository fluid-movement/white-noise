# noise

A single-page white noise generator for babies, built for mobile. Web Audio (via an `AudioWorklet`) generates continuous noise that you shape with a dual-handle band-pass slider, and a mute button fades the sound in gently and out quickly. It's a static, client-only SvelteKit app with no backend.

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
