<script lang="ts">
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

  function loadStored(): { low: number; high: number; stereo: boolean } {
    const fallback = { low: 0, high: 0.6, stereo: true };
    if (typeof localStorage === "undefined") return fallback;
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (typeof parsed?.low === "number" && typeof parsed?.high === "number")
        return {
          low: parsed.low,
          high: parsed.high,
          stereo: parsed.stereo ?? true,
        };
    } catch {
      // ignore malformed storage
    }
    return fallback;
  }

  const stored = loadStored();

  let playing = $state(false);
  let low = $state(stored.low);
  let high = $state(stored.high);
  let stereo = $state(stored.stereo);
  let dragging: "low" | "high" | null = $state(null);

  let track: HTMLDivElement;
  let audioEl: HTMLAudioElement;

  // The noise is a real looping <audio> file (static/noise.wav) played *through*
  // live Web Audio filters. A genuine media element is what Android keeps alive
  // in the background and shows lock-screen controls for; routing it through the
  // graph keeps the band filter (and mute) fully live — no re-rendering.
  let ctx: AudioContext | null = null;
  let highpass: BiquadFilterNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let gain: GainNode | null = null;
  let monoGain: GainNode | null = null;
  let mediaSessionReady = false;

  function ensureAudio() {
    if (ctx) return;
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audioEl);
    highpass = new BiquadFilterNode(ctx, {
      type: "highpass",
      frequency: toHz(low),
    });
    lowpass = new BiquadFilterNode(ctx, {
      type: "lowpass",
      frequency: toHz(high),
    });
    gain = new GainNode(ctx, { gain: 0 });
    // Downmix stereo → mono (0.5·L + 0.5·R), then up-mix back to both speakers.
    monoGain = ctx.createGain();
    monoGain.channelCount = 1;
    monoGain.channelCountMode = "explicit";
    monoGain.channelInterpretation = "speakers";
    monoGain.connect(ctx.destination);
    source.connect(highpass).connect(lowpass).connect(gain);
    applyRouting();
  }

  // Route the wet signal either straight to the speakers (stereo) or through the
  // mono downmix (mono). Called on setup and whenever the mode toggles.
  function applyRouting() {
    if (!ctx || !gain || !monoGain) return;
    gain.disconnect();
    gain.connect(stereo ? ctx.destination : monoGain);
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
    navigator.mediaSession.setActionHandler("play", () => startPlayback());
    navigator.mediaSession.setActionHandler("pause", () => mute());
  }

  async function startPlayback() {
    ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
    await audioEl.play().catch(() => {});
    fadeGain(1, FADE_IN);
    playing = true;
    setupMediaSession();
    setPlaybackState("playing");
  }

  // Mute is just a gain fade — the element keeps playing, so unmuting is instant
  // and there are no play/pause or src-swap races.
  function mute() {
    fadeGain(0, FADE_OUT);
    playing = false;
    setPlaybackState("paused");
  }

  function toggle() {
    if (playing) mute();
    else startPlayback();
  }

  function updateFilters() {
    if (!ctx || !highpass || !lowpass) return;
    const now = ctx.currentTime;
    highpass.frequency.setTargetAtTime(toHz(low), now, 0.01);
    lowpass.frequency.setTargetAtTime(toHz(high), now, 0.01);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ low, high, stereo }));
  }

  function toggleStereo() {
    stereo = !stereo;
    persist();
    applyRouting();
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

<audio
  bind:this={audioEl}
  src="/noise.wav"
  loop
  preload="auto"
  playsinline
  hidden
></audio>

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

  <button
    type="button"
    class="mode"
    aria-pressed={stereo}
    aria-label={stereo ? "Stereo mode, tap for mono" : "Mono mode, tap for stereo"}
    onclick={toggleStereo}
  >
    <span class="mode-label" class:active={!stereo}>mono</span>
    <svg class="venn" class:on={stereo} viewBox="0 0 60 34" aria-hidden="true">
      <circle class="ring left" cx="24" cy="17" r="12" />
      <circle class="ring right" cx="36" cy="17" r="12" />
    </svg>
    <span class="mode-label" class:active={stereo}>stereo</span>
  </button>

  <span class="version">v3 · live</span>
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

  .mode {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: none;
    border: none;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    touch-action: manipulation;
  }

  .mode-label {
    font: 500 0.8rem/1 system-ui, sans-serif;
    color: #5c6070;
    letter-spacing: 0.02em;
    transition: color 0.28s ease;
  }

  .mode-label.active {
    color: #d7cbb8;
    font-weight: 700;
  }

  .venn {
    width: 3.75rem;
    height: 2.125rem;
    overflow: visible;
  }

  .ring {
    fill: none;
    stroke: #43474f;
    stroke-width: 2.2;
    transition:
      stroke 0.28s ease,
      transform 0.28s ease;
  }

  /* Left channel is always on; the right circle lights up and slides inward
     (interlocked) in stereo, and dims + pulls apart in mono. */
  .ring.left {
    stroke: #d7cbb8;
  }

  .ring.right {
    transform: translateX(9px);
  }

  .venn.on .ring.right {
    stroke: #d7cbb8;
    transform: translateX(0);
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
