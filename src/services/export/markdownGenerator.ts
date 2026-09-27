import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { ExportData } from '../../types';
import { sanitizeForMarkdown, sanitizeForMarkdownTableCell, sanitizeText } from '../../utils/sanitize';

const cell = (value: unknown): string =>
    sanitizeForMarkdownTableCell(typeof value === 'string' ? value : String(value ?? ''));

const numberCell = (value: string | undefined): string => {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? String(parsed) : '0';
};

export const buildMarkdown = (data: ExportData): string => {
    const { date, subjects, checklistItems, qualityChecks, dayRating, errors, todos } = data;

    let md = `# Daily Study Tracker\n\n`;
    md += `**Date:** ${sanitizeText(date)}\n\n`;

    md += `| Subject | Planned (min) | Actual (min) | KPI Done (Y/N) |\n`;
    md += `|---------|---------------|--------------|----------------|\n`;

    let totalPlanned = 0;
    let totalActual = 0;

    subjects.forEach((subject) => {
        md += `| ${cell(subject.name)} | ${cell(numberCell(subject.planned))} | ${cell(numberCell(subject.actual))} | ${cell(subject.kpi)} |\n`;
        totalPlanned += Number.parseFloat(subject.planned) || 0;
        totalActual += Number.parseFloat(subject.actual) || 0;
    });

    md += `| **Total** | **${totalPlanned}** | **${totalActual}** | |\n\n`;

    md += `## Output Checklist\n`;
    if (checklistItems.length === 0) {
        md += `- [ ] No checklist items recorded.\n`;
    }
    checklistItems.forEach((item) => {
        md += `- [${item.checked ? 'x' : ' '}] ${sanitizeForMarkdown(item.label)}\n`;
    });
    md += `\n`;

    md += `## Quality Check\n`;
    if (qualityChecks.length === 0) {
        md += `- [ ] No quality checks recorded.\n`;
    }
    qualityChecks.forEach((check) => {
        md += `- [${check.checked ? 'x' : ' '}] ${sanitizeForMarkdown(check.label)}\n`;
    });
    md += `\n`;

    md += `## Day Rating\n`;
    md += `**Rating:** ${sanitizeText(dayRating || 'Not rated')}\n\n`;

    md += `## To-Do List\n`;
    if (todos.length === 0) {
        md += `No to-do items.\n`;
    } else {
        todos.forEach((todo) => {
            const time = sanitizeForMarkdown(todo.time);
            md += `- [${todo.completed ? 'x' : ' '}] ${sanitizeForMarkdown(todo.text)}${time ? ` _(${time})_` : ''}\n`;
        });
    }
    md += `\n`;

    md += `## Error Log\n`;
    if (errors.length > 0) {
        md += `| Question | Mistake | Correct Logic |\n`;
        md += `|----------|---------|---------------|\n`;
        errors.forEach((err) => {
            const q = cell(err.question);
            const m = cell(err.mistake);
            const c = cell(err.correctLogic);
            if (q || m || c) {
                md += `| ${q} | ${m} | ${c} |\n`;
            }
        });
    } else {
        md += `No errors logged.\n`;
    }

    return md;
};

export const generateMarkdown = async (data: ExportData) => {
    const md = buildMarkdown(data);
    const fileName = `Study_Tracker_${data.date}.md`;

    if (Capacitor.isNativePlatform()) {
        await Filesystem.writeFile({
            path: fileName,
            data: md,
            directory: Directory.External,
            encoding: Encoding.UTF8,
        });
    } else {
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        URL.revokeObjectURL(url);
    }
};
