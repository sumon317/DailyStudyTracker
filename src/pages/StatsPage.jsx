import React from 'react';
import StudyCharts from '../components/StudyCharts';
import WeeklyStats from '../components/WeeklyStats';

const StatsPage = ({ subjects, currentDate }) => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 items-start">
            <StudyCharts subjects={subjects} />
            <WeeklyStats currentDate={currentDate} />
        </div>
    );
};

export default StatsPage;
