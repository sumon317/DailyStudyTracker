import React from 'react';
import Checklist from '../components/Checklist';
import QualityCheck from '../components/QualityCheck';
import ErrorLog from '../components/ErrorLog';

const ReviewPage = ({
    checklistItems, setChecklistItems,
    qualityChecks, setQualityChecks,
    dayRating, setDayRating,
    errors, setErrors
}) => {
    return (
        <div className="space-y-4 sm:space-y-6">
            <Checklist items={checklistItems} setItems={setChecklistItems} />

            <QualityCheck
                checks={qualityChecks}
                setChecks={setQualityChecks}
                rating={dayRating}
                setRating={setDayRating}
            />

            <ErrorLog errors={errors} setErrors={setErrors} />
        </div>
    );
};

export default ReviewPage;
