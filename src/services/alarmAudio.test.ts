import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALARM_AUDIO_SRC, createAlarmAudio } from './alarmAudio';

class MockAudio {
    static instances: MockAudio[] = [];
    loop = false;
    crossOrigin = '';
    currentTime = 0;
    src: string;
    pause = vi.fn();
    play = vi.fn().mockResolvedValue(undefined);
    constructor(src = '') {
        this.src = src;
        MockAudio.instances.push(this);
    }
}

class MockAudioContext {
    static instances: MockAudioContext[] = [];
    state = 'running';
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    destination = {};
    createGain = vi.fn().mockReturnValue({ gain: { value: 1 }, connect: vi.fn() });
    createMediaElementSource = vi.fn().mockReturnValue({ connect: vi.fn() });
    constructor() {
        MockAudioContext.instances.push(this);
    }
}

const stubAudioContext = (value: unknown) => {
    vi.stubGlobal('AudioContext', value);
    vi.stubGlobal('webkitAudioContext', value);
};

describe('alarmAudio', () => {
    beforeEach(() => {
        MockAudio.instances = [];
        MockAudioContext.instances = [];
        vi.stubGlobal('Audio', MockAudio);
        stubAudioContext(MockAudioContext);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('points at the single canonical precached alarm asset', () => {
        expect(ALARM_AUDIO_SRC).toBe('/alarm_loop.mp3');
    });

    it('does not build a media element until the first play by default', async () => {
        const audio = createAlarmAudio();
        expect(MockAudio.instances).toHaveLength(0);

        await audio.play();

        expect(MockAudio.instances).toHaveLength(1);
        expect(MockAudio.instances[0]?.src).toBe(ALARM_AUDIO_SRC);
        expect(MockAudio.instances[0]?.loop).toBe(true);
        expect(MockAudio.instances[0]?.crossOrigin).toBe('anonymous');
    });

    it('reuses one media element and one audio graph across repeated plays', async () => {
        const audio = createAlarmAudio();

        await audio.play();
        await audio.play();

        expect(MockAudio.instances).toHaveLength(1);
        expect(MockAudioContext.instances).toHaveLength(1);
        expect(MockAudio.instances[0]?.play).toHaveBeenCalledTimes(2);
    });

    it('builds the media element up front when eager, but not the audio graph', () => {
        createAlarmAudio({ eager: true });

        expect(MockAudio.instances).toHaveLength(1);
        expect(MockAudio.instances[0]?.src).toBe(ALARM_AUDIO_SRC);
        expect(MockAudioContext.instances).toHaveLength(0);
    });

    it('rewinds and pauses on stop, and is a no-op before the element exists', async () => {
        const audio = createAlarmAudio();
        audio.stop();
        expect(MockAudio.instances).toHaveLength(0);

        await audio.play();
        if (MockAudio.instances[0]) {
            MockAudio.instances[0].currentTime = 12;
        }
        audio.stop();

        expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
        expect(MockAudio.instances[0]?.currentTime).toBe(0);
    });

    it('resumes a suspended context before playing', async () => {
        class SuspendedAudioContext extends MockAudioContext {
            override state = 'suspended';
        }
        stubAudioContext(SuspendedAudioContext);

        const audio = createAlarmAudio();
        await audio.play();

        expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
        expect(SuspendedAudioContext.instances[0]?.resume).toHaveBeenCalled();
    });

    it('still attempts playback when no audio graph constructor exists', async () => {
        stubAudioContext(undefined);
        const audio = createAlarmAudio();

        await expect(audio.play()).resolves.toBeUndefined();

        expect(MockAudioContext.instances).toHaveLength(0);
        expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });

    it('releases the element and the context on dispose, and rebuilds on a later play', async () => {
        const audio = createAlarmAudio();
        await audio.play();
        const context = MockAudioContext.instances[0];

        audio.dispose();

        expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
        expect(context?.close).toHaveBeenCalled();

        await audio.play();
        expect(MockAudio.instances).toHaveLength(2);
    });

    it('tolerates dispose being called before anything was ever played', () => {
        const audio = createAlarmAudio();
        expect(() => audio.dispose()).not.toThrow();
    });
});
