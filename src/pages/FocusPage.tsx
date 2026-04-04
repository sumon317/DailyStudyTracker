import CountdownTimer from '../components/CountdownTimer';
import InbuiltAlarm from '../components/InbuiltAlarm';
import type { FocusPageProps } from '../types';

const FocusPage = ({ globalAlarmSource, stopGlobalAlarm }: FocusPageProps) => {
    return (
        <div className="space-y-6 pb-20">
            <div className="w-full">
                <CountdownTimer globalAlarmSource={globalAlarmSource} stopGlobalAlarm={stopGlobalAlarm} />
            </div>

            <div className="w-full">
                <InbuiltAlarm globalAlarmSource={globalAlarmSource} stopGlobalAlarm={stopGlobalAlarm} />
            </div>
        </div>
    );
};

export default FocusPage;
