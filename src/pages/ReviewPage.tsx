import Checklist from '../components/review/Checklist';
import ErrorLog from '../components/review/ErrorLog';
import QualityCheck from '../components/review/QualityCheck';
import type { ReviewPageProps } from '../types';

const ReviewPage = ({
    checklistItems,
    setChecklistItems,
    qualityChecks,
    setQualityChecks,
    dayRating,
    setDayRating,
    errors,
    setErrors,
}: ReviewPageProps) => {
    return (
        <section className="space-y-4 sm:space-y-6" aria-labelledby="review-page-title">
            <h1 id="review-page-title" className="sr-only">
                Review
            </h1>
            <Checklist items={checklistItems} setItems={setChecklistItems} />

            <QualityCheck
                checks={qualityChecks}
                setChecks={setQualityChecks}
                rating={dayRating}
                setRating={setDayRating}
            />

            <ErrorLog errors={errors} setErrors={setErrors} />
        </section>
    );
};

export default ReviewPage;
