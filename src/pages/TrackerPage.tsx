import Stopwatch from '../components/focus/Stopwatch';
import Clock from '../components/shared/Clock';
import DatePicker from '../components/shared/DatePicker';
import TrackerForm from '../components/tracker/TrackerForm';
import type { TrackerPageProps } from '../types';

const TrackerPage = ({ date, setDate, subjects, setSubjects }: TrackerPageProps) => {
    return (
        <section className="space-y-4 sm:space-y-6" aria-labelledby="tracker-page-title">
            <h1 id="tracker-page-title" className="sr-only">
                Study tracker
            </h1>
            <div className="hidden sm:flex flex-row items-center gap-4">
                <DatePicker date={date} setDate={setDate} />
                <div className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm flex items-center justify-center gap-4 h-[90px] min-w-[280px]">
                    <Clock />
                    <div className="w-px h-12 bg-app-border" />
                    <Stopwatch />
                </div>
            </div>

            <TrackerForm subjects={subjects} setSubjects={setSubjects} />
        </section>
    );
};

export default TrackerPage;
