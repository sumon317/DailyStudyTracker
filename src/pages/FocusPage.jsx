import React from 'react';
import CountdownTimer from '../components/CountdownTimer';
import InbuiltAlarm from '../components/InbuiltAlarm';

const FocusPage = ({ globalAlarmSource, stopGlobalAlarm }) => {
    return (
        <div className="space-y-6 pb-20">
            <div className="w-full">
                <CountdownTimer
                    globalAlarmSource={globalAlarmSource}
                    stopGlobalAlarm={stopGlobalAlarm}
                />
            </div>

            <div className="w-full">
                <InbuiltAlarm
                    globalAlarmSource={globalAlarmSource}
                    stopGlobalAlarm={stopGlobalAlarm}
                />
            </div>
        </div>
    );
};

export default FocusPage;
