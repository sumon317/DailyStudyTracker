import CountdownTimer from '../components/focus/CountdownTimer';
import InbuiltAlarm from '../components/focus/InbuiltAlarm';
import type { FocusPageProps } from '../types';

const FocusPage = ({ globalAlarmSource, stopGlobalAlarm }: FocusPageProps) => {
    return (
        <section className="space-y-6" aria-labelledby="focus-page-title">
            <h1 id="focus-page-title" className="sr-only">
                Focus
            </h1>
            <div className="w-full">
                <CountdownTimer globalAlarmSource={globalAlarmSource} stopGlobalAlarm={stopGlobalAlarm} />
            </div>

            <div className="w-full">
                <InbuiltAlarm />
            </div>
        </section>
    );
};

export default FocusPage;
