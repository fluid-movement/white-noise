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

  let ctx: AudioContext | null = null;
  let highpass: BiquadFilterNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let gain: GainNode | null = null;
  // Terminal sink: the graph feeds a MediaStream that a real <audio> element
  // plays. Chrome/Android only keeps a bare AudioContext running in the
  // background when its output drives an actively-playing media element, so
  // this is what keeps the noise alive with the screen locked or the app
  // backgrounded (and it's what surfaces the lock-screen media controls).
  let streamDest: MediaStreamAudioDestinationNode | null = null;
  let audioEl: HTMLAudioElement;
  let mediaSessionReady = false;

  async function ensureAudio() {
    if (ctx) return;
    ctx = new AudioContext();

    // Wire up the media sink and start the <audio> element playing *before* any
    // await, so the first tap's user-gesture activation isn't already spent by
    // the time play() runs. Mobile browsers only exempt a genuinely-playing
    // media element from background / lock-screen throttling. The stream is
    // silent until the graph is connected just below.
    streamDest = ctx.createMediaStreamDestination();
    audioEl.srcObject = streamDest.stream;
    audioEl.play().catch(() => {});

    await ctx.audioWorklet.addModule("/noise-processor.js");
    const noise = new AudioWorkletNode(ctx, "noise-processor");
    highpass = new BiquadFilterNode(ctx, {
      type: "highpass",
      frequency: toHz(low),
    });
    lowpass = new BiquadFilterNode(ctx, {
      type: "lowpass",
      frequency: toHz(high),
    });
    gain = new GainNode(ctx, { gain: 0 });
    noise.connect(highpass).connect(lowpass).connect(gain).connect(streamDest);
  }

  function fadeGain(target: number, duration: number) {
    if (!ctx || !gain) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + duration);
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
    navigator.mediaSession.setActionHandler("play", () => resumePlayback());
    navigator.mediaSession.setActionHandler("pause", () => pausePlayback());
  }

  async function resumePlayback() {
    await ensureAudio();
    if (!ctx || !gain) return;
    if (ctx.state === "suspended") await ctx.resume();
    // Must run inside a user gesture the first time; the MediaSession play
    // handler also counts as an activation on Android.
    await audioEl.play().catch(() => {});
    setupMediaSession();
    fadeGain(1, FADE_IN);
    playing = true;
    setPlaybackState("playing");
  }

  function pausePlayback() {
    if (!ctx || !gain) return;
    // Fade to (near) silence but keep the stream + <audio> element playing so
    // resume is instant and doesn't need a fresh gesture.
    fadeGain(0.0001, FADE_OUT);
    playing = false;
    setPlaybackState("paused");
  }

  function toggle() {
    if (playing) pausePlayback();
    else resumePlayback();
  }

  // Recovery net: if the OS suspended the context / media element while we were
  // backgrounded, resume them when the page becomes visible again. Mainly
  // relevant on iOS, where background suspension is less predictable.
  function recoverPlayback() {
    if (document.visibilityState !== "visible" || !playing || !ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    if (audioEl?.paused) audioEl.play().catch(() => {});
  }

  onMount(() => {
    document.addEventListener("visibilitychange", recoverPlayback);
    window.addEventListener("pageshow", recoverPlayback);
    return () => {
      document.removeEventListener("visibilitychange", recoverPlayback);
      window.removeEventListener("pageshow", recoverPlayback);
    };
  });

  function updateFilters() {
    if (!ctx || !highpass || !lowpass) return;
    const now = ctx.currentTime;
    highpass.frequency.setTargetAtTime(toHz(low), now, 0.01);
    lowpass.frequency.setTargetAtTime(toHz(high), now, 0.01);
  }

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
    updateFilters();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = null;
    persist();
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
