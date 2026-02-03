export const generateMarkdown = (data) => {
    const { date, subjects, checklistItems, qualityChecks, dayRating, errors } = data;

    let md = `# 6-Hour Daily Study Tracker\n\n`;
    md += `**Date:** ${date}\n\n`;

    // Table
    md += `| Subject | Planned (min) | Actual (min) | KPI Done (Y/N) |\n`;
    md += `|---------|---------------|--------------|----------------|\n`;

    let totalPlanned = 0;
    let totalActual = 0;

    subjects.forEach(subject => {
        md += `| ${subject.name} | ${subject.planned || '0'} | ${subject.actual || '0'} | ${subject.kpi || ''} |\n`;
        totalPlanned += parseFloat(subject.planned) || 0;
        totalActual += parseFloat(subject.actual) || 0;
    });

    md += `| **Total** | **${totalPlanned}** | **${totalActual}** | |\n\n`;

    // Checklist
    md += `## Output Checklist\n`;
    checklistItems.forEach(item => {
        md += `- [${item.checked ? 'x' : ' '}] ${item.label}\n`;
    });
    md += `\n`;

    // Quality Check
    md += `## Quality Check\n`;
    qualityChecks.forEach(check => {
        md += `- [${check.checked ? 'x' : ' '}] ${check.label}\n`;
    });
    md += `\n`;

    // Day Rating
    md += `## Day Rating\n`;
    md += `**Rating:** ${dayRating || 'Not rated'}\n\n`;

    // Error Log
    md += `## Error Log\n`;
    if (errors.length > 0) {
        md += `| Question | Mistake | Correct Logic |\n`;
        md += `|----------|---------|---------------|\n`;
        errors.forEach(err => {
            // Simple sanitization for markdown table
            const q = (err.question || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
            const m = (err.mistake || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
            const c = (err.correctLogic || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
            if (q || m || c) {
                md += `| ${q} | ${m} | ${c} |\n`;
            }
        });
    } else {
        md += `No errors logged.\n`;
    }

    // Trigger Download
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Study_Tracker_${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
