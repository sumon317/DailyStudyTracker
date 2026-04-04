import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { ChecklistItem, ErrorLogEntry, QualityCheckItem, Subject, Todo } from '../types';
import { sanitizeForMarkdown, sanitizeText } from './sanitize';

interface ExportData {
    date: string;
    subjects: Subject[];
    checklistItems: ChecklistItem[];
    qualityChecks: QualityCheckItem[];
    dayRating: string;
    errors: ErrorLogEntry[];
    todos: Todo[];
}

export const generateMarkdown = async (data: ExportData) => {
    const { date, subjects, checklistItems, qualityChecks, dayRating, errors } = data;

    let md = `# Daily Study Tracker\n\n`;
    md += `**Date:** ${date}\n\n`;

    md += `| Subject | Planned (min) | Actual (min) | KPI Done (Y/N) |\n`;
    md += `|---------|---------------|--------------|----------------|\n`;

    let totalPlanned = 0;
    let totalActual = 0;

    subjects.forEach((subject) => {
        md += `| ${sanitizeText(subject.name)} | ${subject.planned || '0'} | ${subject.actual || '0'} | ${sanitizeText(subject.kpi)} |\n`;
        totalPlanned += parseFloat(subject.planned) || 0;
        totalActual += parseFloat(subject.actual) || 0;
    });

    md += `| **Total** | **${totalPlanned}** | **${totalActual}** | |\n\n`;

    md += `## Output Checklist\n`;
    checklistItems.forEach((item) => {
        md += `- [${item.checked ? 'x' : ' '}] ${sanitizeForMarkdown(item.label)}\n`;
    });
    md += `\n`;

    md += `## Quality Check\n`;
    qualityChecks.forEach((check) => {
        md += `- [${check.checked ? 'x' : ' '}] ${sanitizeForMarkdown(check.label)}\n`;
    });
    md += `\n`;

    md += `## Day Rating\n`;
    md += `**Rating:** ${sanitizeText(dayRating || 'Not rated')}\n\n`;

    md += `## Error Log\n`;
    if (errors.length > 0) {
        md += `| Question | Mistake | Correct Logic |\n`;
        md += `|----------|---------|---------------|\n`;
        errors.forEach((err) => {
            const q = sanitizeForMarkdown((err.question || '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
            const m = sanitizeForMarkdown((err.mistake || '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
            const c = sanitizeForMarkdown((err.correctLogic || '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
            if (q || m || c) {
                md += `| ${q} | ${m} | ${c} |\n`;
            }
        });
    } else {
        md += `No errors logged.\n`;
    }

    const fileName = `Study_Tracker_${date}.md`;

    if (Capacitor.isNativePlatform()) {
        try {
            await Filesystem.writeFile({
                path: fileName,
                data: md,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            alert(`✅ Markdown Saved to Documents folder as ${fileName}`);
        } catch (_e) {
            alert('❌ Failed to save Markdown to device storage.');
        }
    } else {
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
