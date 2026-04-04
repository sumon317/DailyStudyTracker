import { registerPlugin } from '@capacitor/core';
import type { NativeAlarmOptions } from '../types';

interface NativeAlarmPlugin {
    scheduleAlarm: (options: NativeAlarmOptions) => Promise<void>;
    cancelAlarm: (options: { id: number }) => Promise<void>;
}

const NativeAlarm = registerPlugin<NativeAlarmPlugin>('NativeAlarm');

export default NativeAlarm;
