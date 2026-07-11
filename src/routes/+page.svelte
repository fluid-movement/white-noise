<script lang="ts">
  import { onMount } from "svelte";

  const MIN_HZ = 50;
  const MAX_HZ = 1500;
  const MIN_GAP = 0.05;
  const FADE_IN = 1.5;
  const FADE_OUT = 0.15;
  const STORAGE_KEY = "noise-band";

  function toHz(value: number) {
    return MIN_HZ * (MAX_HZ / MIN_HZ) ** value;
  }

  function displayHz(value: number) {
    const hz = toHz(value);
    return hz >= 1000 ? `${(hz / 1000).toFixed(1)}kHz` : `${Math.round(hz)}Hz`;
  }

  function loadStored(): { low: number; high: number } {
    if (typeof localStorage === "undefined") return { low: 0, high: 0.6 };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (typeof parsed?.low === "number" && typeof parsed?.high === "number")
        return parsed;
    } catch {
      // ignore malformed storage
    }
    return { low: 0, high: 0.6 };
  }

  const stored = loadStored();

  let playing = $state(false);
  let low = $state(stored.low);
  let high = $state(stored.high);
  let dragging: "low" | "high" | null = $state(null);

  let track: HTMLDivElement;
  let audioEl: HTMLAudioElement;

  // A bare AudioContext (or Web-Audio MediaStream) is throttled in the
  // background on Chrome/Android and never surfaces a media session. The only
  // thing the OS keeps alive with the screen locked — and shows lock-screen
  // controls for — is a genuine <audio> element playing a real resource. So we
  // render the filtered noise offline into a looping WAV blob and play *that*.
  let currentUrl: string | null = null;
  let renderToken = 0;
  let fadeHandle = 0;
  let mediaSessionReady = false;

  // Encode an AudioBuffer to a 16-bit PCM WAV so a plain <audio> element can
  // loop it as an ordinary media resource.
  function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const frames = buffer.length;
    const blockAlign = numCh * 2;
    const dataSize = frames * blockAlign;
    const out = new ArrayBuffer(44 + dataSize);
    const view = new DataView(out);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch));
    let offset = 44;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return out;
  }

  // Render `dur` seconds of white noise through the highpass/lowpass band at the
  // given cutoffs. A hard loop point in filtered noise is imperceptible, so no
  // crossfade is needed. OfflineAudioContext needs no user gesture.
  async function renderLoop(lowV: number, highV: number): Promise<Blob> {
    const sr = 44100;
    const dur = 15;
    const frames = sr * dur;
    const oac = new OfflineAudioContext(2, frames, sr);
    const noiseBuf = oac.createBuffer(2, frames, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = noiseBuf.getChannelData(ch);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = oac.createBufferSource();
    src.buffer = noiseBuf;
    const hp = new BiquadFilterNode(oac, {
      type: "highpass",
      frequency: toHz(lowV),
    });
    const lp = new BiquadFilterNode(oac, {
      type: "lowpass",
      frequency: toHz(highV),
    });
    src.connect(hp).connect(lp).connect(oac.destination);
    src.start(0);
    const rendered = await oac.startRendering();
    return new Blob([audioBufferToWav(rendered)], { type: "audio/wav" });
  }

  // Render the loop for the current band and hand it to the <audio> element.
  // Pre-rendered on mount so the first play() can run synchronously inside the
  // tap gesture. `renderToken` discards a render that a newer one superseded.
  async function setLoop(lowV: number, highV: number) {
    const token = ++renderToken;
    const blob = await renderLoop(lowV, highV);
    if (token !== renderToken) return;
    const url = URL.createObjectURL(blob);
    audioEl.src = url;
    audioEl.loop = true;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = url;
    if (playing) {
      audioEl.volume = 0;
      try {
        await audioEl.play();
      } catch {
        // ignore
      }
      rampVolume(1, 0.2);
    }
  }

  // iOS ignores media-element volume, so this is a no-op there (instant start),
  // which is acceptable. On Android/desktop it gives the gentle fade.
  function rampVolume(target: number, duration: number, done?: () => void) {
    cancelAnimationFrame(fadeHandle);
    const start = audioEl.volume;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = duration <= 0 ? 1 : Math.min(1, (now - t0) / (duration * 1000));
      audioEl.volume = start + (target - start) * p;
      if (p < 1) fadeHandle = requestAnimationFrame(step);
      else done?.();
    };
    fadeHandle = requestAnimationFrame(step);
  }

  function setPlaybackState(state: MediaSessionPlaybackState) {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state;
  }

  function setupMediaSession() {
    if (mediaSessionReady || !("mediaSession" in navigator)) return;
    mediaSessionReady = true;
    if (typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "White Noise",
        artist: "Noise",
        artwork: [
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    }
    navigator.mediaSession.setActionHandler("play", () => startPlayback());
    navigator.mediaSession.setActionHandler("pause", () => pausePlayback());
  }

  async function startPlayback() {
    // src is normally pre-rendered on mount; guard in case it isn't ready yet.
    if (!audioEl.src) await setLoop(low, high);
    audioEl.loop = true;
    audioEl.volume = 0;
    try {
      await audioEl.play();
    } catch {
      return;
    }
    rampVolume(1, FADE_IN);
    playing = true;
    setupMediaSession();
    setPlaybackState("playing");
  }

  function pausePlayback() {
    rampVolume(0, FADE_OUT, () => audioEl.pause());
    playing = false;
    setPlaybackState("paused");
  }

  function toggle() {
    if (playing) pausePlayback();
    else startPlayback();
  }

  onMount(() => {
    // Pre-render the stored band so the first tap plays instantly and in-gesture.
    setLoop(low, high);
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  });

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ low, high }));
  }

  function fractionFromPointer(clientX: number) {
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function startDrag(handle: "low" | "high", event: PointerEvent) {
    dragging = handle;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const value = fractionFromPointer(event.clientX);
    if (dragging === "low") {
      low = Math.min(value, high - MIN_GAP);
    } else {
      high = Math.max(value, low + MIN_GAP);
    }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = null;
    persist();
    // Re-render the loop for the new band (and hot-swap it if playing).
    setLoop(low, high);
  }
</script>

<audio bind:this={audioEl} playsinline hidden></audio>

<main>
  <button
    type="button"
    class="toggle"
    class:playing
    onclick={toggle}
    aria-label={playing ? "Mute" : "Play white noise"}
  >
    {#if playing}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" stroke-linejoin="round" />
        <path d="M16.5 8.5a5 5 0 0 1 0 7" stroke-linecap="round" />
        <path d="M19.5 6a9 9 0 0 1 0 12" stroke-linecap="round" />
      </svg>
    {:else}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" stroke-linejoin="round" />
        <path d="M16 9l6 6M22 9l-6 6" stroke-linecap="round" />
      </svg>
    {/if}
  </button>

  <div class="band">
    <span class="label">muffled</span>
    <div class="track" bind:this={track}>
      <span class="value-label below" style="left:{low * 100}%"
        >{displayHz(low)}</span
      >
      <span class="value-label above" style="left:{high * 100}%"
        >{displayHz(high)}</span
      >
      <div
        class="fill"
        style="left:{low * 100}%; right:{100 - high * 100}%"
      ></div>
      <button
        type="button"
        class="thumb"
        style="left:{low * 100}%"
        onpointerdown={(e) => startDrag("low", e)}
        onpointermove={onPointerMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        aria-label="Low cutoff, {displayHz(low)}"
      ></button>
      <button
        type="button"
        class="thumb"
        style="left:{high * 100}%"
        onpointerdown={(e) => startDrag("high", e)}
        onpointermove={onPointerMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        aria-label="High cutoff, {displayHz(high)}"
      ></button>
    </div>
    <span class="label">bright</span>
  </div>

  <span class="version">v2 · file-loop</span>
</main>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    height: 100%;
    background: #0a0a0c;
    overscroll-behavior: none;
    -webkit-tap-highlight-color: transparent;
  }

  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4rem;
    min-height: 100dvh;
    padding: 2rem env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
    box-sizing: border-box;
    user-select: none;
    touch-action: none;
  }

  /* Temporary build marker so the installed PWA can be confirmed updated on
     device; remove once background playback is verified. */
  .version {
    position: fixed;
    bottom: calc(env(safe-area-inset-bottom) + 0.5rem);
    right: 0.75rem;
    font: 500 0.65rem/1 system-ui, sans-serif;
    color: #33363f;
    letter-spacing: 0.03em;
    pointer-events: none;
  }

  .toggle {
    width: 9rem;
    height: 9rem;
    border-radius: 50%;
    border: none;
    background: #1c1e28;
    color: #8a8fa3;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 0.2s,
      color 0.2s,
      box-shadow 0.2s;
  }

  .toggle svg {
    width: 3.25rem;
    height: 3.25rem;
  }

  .toggle.playing {
    background: #caa06a;
    color: #14161f;
    box-shadow: 0 0 0 10px rgba(202, 160, 106, 0.12);
  }

  .band {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: min(85vw, 380px);
  }

  .label {
    font:
      500 0.75rem/1 system-ui,
      sans-serif;
    color: #5c6070;
    letter-spacing: 0.02em;
  }

  .track {
    position: relative;
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: #1c1e28;
  }

  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 999px;
    background: #caa06a;
  }

  .value-label {
    position: absolute;
    transform: translateX(-50%);
    font:
      600 0.8rem/1 system-ui,
      sans-serif;
    color: #e0573f;
    white-space: nowrap;
    pointer-events: none;
  }

  .value-label.below {
    top: calc(100% + 1rem);
  }

  .value-label.above {
    bottom: calc(100% + 1rem);
  }

  .thumb {
    position: absolute;
    top: 50%;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    background: #e8d9c5;
    border: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    transform: translate(-50%, -50%);
    touch-action: none;
  }
</style>
