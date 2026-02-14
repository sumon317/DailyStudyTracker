import React from 'react';
import TrackerForm from '../components/TrackerForm';
import Clock from '../components/Clock';
import Stopwatch from '../components/Stopwatch';
import DatePicker from '../components/DatePicker';

const TrackerPage = ({ date, setDate, subjects, setSubjects }) => {
    return (
        <div className="space-y-4 sm:space-y-6">
            {/* Desktop: full-size date + clock + stopwatch */}
            <div className="hidden sm:flex flex-row items-center gap-4">
                <DatePicker date={date} setDate={setDate} />
                <div className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm flex items-center justify-center gap-4 h-[90px] min-w-[280px]">
                    <Clock />
                    <div className="w-px h-12 bg-app-border" />
                    <Stopwatch />
                </div>
            </div>

            <TrackerForm subjects={subjects} setSubjects={setSubjects} />
        </div>
    );
};

export default TrackerPage;
