/**
 * Single source of truth for the looping alarm tone played by the web build.
 *
 * `public/alarm_loop.mp3` is the only alarm asset the web app ships. The Android
 * build resolves `NotificationService.NOTIFICATION_SOUND` ('alarm_loop.mp3')
 * and `AlarmActivity` (`R.raw.alarm_loop`) from `android/app/src/main/res/raw/`
 * instead, so that name is a native resource name rather than a web URL and the
 * two must not be conflated.
 *
 * The asset is precached by the service worker (see the `mp3` entry in
 * `vite.config.ts` -> workbox `globPatterns`) so the alarm still sounds with no
 * network, which is the only case where it matters.
 */
export const ALARM_AUDIO_SRC = '/alarm_loop.mp3';

const ALARM_AUDIO_GAIN = 1.5;

export interface AlarmAudioController {
    /** Start (or restart from the beginning) the looping tone. */
    play(): Promise<void>;
    /** Pause and rewind without tearing down the audio graph. */
    stop(): void;
    /** Release the media element and close the audio context. */
    dispose(): void;
}

export interface AlarmAudioOptions {
    /**
     * Build the media element up front instead of on the first `play()`.
     * Only the app-level alarm wants the element ready before the user is
     * notified; opening a page must not start fetching a ~1.4 MiB asset.
     */
    eager?: boolean;
}

const createMediaElement = (): HTMLAudioElement => {
    const element = new Audio(ALARM_AUDIO_SRC);
    element.loop = true;
    // Required for `createMediaElementSource` to see a CORS-clean resource.
    element.crossOrigin = 'anonymous';
    return element;
};

const resolveAudioContext = (): typeof AudioContext =>
    window.AudioContext ?? (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;

/**
 * The alarm tone was previously built twice - once in `App` and once in
 * `CountdownTimer` - with identical gain, cross-origin and resume handling. Both
 * copies had to be kept in step by hand, and they had already drifted apart in
 * when the media element was created. Each caller owns its own controller (they
 * must not share one, because each stops independently); this module owns the
 * wiring so there is only one implementation left to reason about.
 */
export const createAlarmAudio = ({ eager = false }: AlarmAudioOptions = {}): AlarmAudioController => {
    let element: HTMLAudioElement | null = null;
    let context: AudioContext | null = null;
    let gainNode: GainNode | null = null;
    let sourceNode: MediaElementAudioSourceNode | null = null;

    const ensureElement = (): HTMLAudioElement => {
        if (!element) {
            element = createMediaElement();
        }
        return element;
    };

    const ensureGraph = (media: HTMLAudioElement): void => {
        if (context) {
            return;
        }
        const AudioContextConstructor = resolveAudioContext();
        context = new AudioContextConstructor();
        gainNode = context.createGain();
        gainNode.gain.value = ALARM_AUDIO_GAIN;
        gainNode.connect(context.destination);
        sourceNode = context.createMediaElementSource(media);
        sourceNode.connect(gainNode);
    };

    const play = async (): Promise<void> => {
        const media = ensureElement();
        try {
            ensureGraph(media);
            if (context?.state === 'suspended') {
                await context.resume();
            }
            media.currentTime = 0;
            await media.play();
        } catch {
            // Autoplay can be refused, or the audio graph can be unavailable
            // (no WebAudio in this browser). A plain play() is the last resort.
            void media.play().catch(() => undefined);
        }
    };

    const stop = (): void => {
        if (!element) {
            return;
        }
        element.pause();
        element.currentTime = 0;
    };

    const dispose = (): void => {
        stop();
        void context?.close().catch(() => undefined);
        element = null;
        context = null;
        gainNode = null;
        sourceNode = null;
    };

    if (eager) {
        ensureElement();
    }

    return { play, stop, dispose };
};
