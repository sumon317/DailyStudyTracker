import jsPDF from 'jspdf';
import 'jspdf-autotable';

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ExportData } from '../../types';
import { sanitizePlainText } from '../../utils/sanitize';

const PAGE_BOTTOM = 280;
const PAGE_TOP = 20;

type PdfDoc = jsPDF & {
    autoTable?: (options: Record<string, unknown>) => void;
    lastAutoTable?: { finalY: number };
};

/**
 * Cleans a value for a PDF text run.
 *
 * `doc.text` writes the string verbatim - there is no markup to escape it out
 * of - so the HTML-entity encoder printed its own escape sequences into the
 * document: a subject called `A & B` came out as `A &amp; B`. Only the
 * character-level cleanup applies here; the entity mapping exists for markup
 * consumers that would decode it, and this is not one.
 */
const text = (value: unknown): string => sanitizePlainText(typeof value === 'string' ? value : String(value ?? ''));

export const buildPdf = (data: ExportData, doc: jsPDF): jsPDF => {
    const { date, subjects, checklistItems, qualityChecks, dayRating, errors, todos } = data;

    let finalY = 40;

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Daily Study Tracker', 14, 22);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${text(date)}`, 14, 32);

    const tableHead = [['Subject', 'Planned (min)', 'Actual (min)', 'KPI Done (Y/N)']];
    const tableBody = subjects.map((s) => [
        text(s.name),
        String(s.planned || '0'),
        String(s.actual || '0'),
        text(s.kpi),
    ]);

    const totalPlanned = subjects.reduce((acc, curr) => acc + (Number.parseFloat(curr.planned) || 0), 0);
    const totalActual = subjects.reduce((acc, curr) => acc + (Number.parseFloat(curr.actual) || 0), 0);
    tableBody.push(['Total', String(totalPlanned), String(totalActual), '']);

    const typedDoc = doc as PdfDoc;
    if (typedDoc.autoTable) {
        typedDoc.autoTable({
            startY: 40,
            head: tableHead,
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 220, 220], textColor: 20, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 50 },
                1: { cellWidth: 40, halign: 'center' },
                2: { cellWidth: 40, halign: 'center' },
                3: { cellWidth: 40, halign: 'center' },
            },
        });
        finalY = (typedDoc.lastAutoTable?.finalY ?? 40) + 10;
    }

    const writeHeading = (label: string): void => {
        if (finalY > PAGE_BOTTOM) {
            doc.addPage();
            finalY = PAGE_TOP;
        }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(label, 14, finalY);
        finalY += 8;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
    };

    writeHeading('Output Checklist');
    if (checklistItems.length === 0) {
        doc.text('[ ] No checklist items recorded.', 14, finalY);
        finalY += 6;
    }
    checklistItems.forEach((item) => {
        if (finalY > PAGE_BOTTOM) {
            doc.addPage();
            finalY = PAGE_TOP;
        }
        const symbol = item.checked ? '[x]' : '[ ]';
        doc.text(`${symbol} ${text(item.label)}`, 14, finalY);
        finalY += 6;
    });

    finalY += 6;
    writeHeading('Quality Check');
    if (qualityChecks.length === 0) {
        doc.text('[ ] No quality checks recorded.', 14, finalY);
        finalY += 6;
    }
    qualityChecks.forEach((check) => {
        if (finalY > PAGE_BOTTOM) {
            doc.addPage();
            finalY = PAGE_TOP;
        }
        const symbol = check.checked ? '[x]' : '[ ]';
        doc.text(`${symbol} ${text(check.label)}`, 14, finalY);
        finalY += 6;
    });

    finalY += 6;
    writeHeading('Day Rating');
    const ratingText = dayRating ? text(dayRating) : 'Not rated';
    doc.text(`Rating: ${ratingText}`, 14, finalY);
    finalY += 10;

    writeHeading('To-Do List');
    if (todos.length === 0) {
        doc.text('No to-do items.', 14, finalY);
        finalY += 6;
    }
    todos.forEach((todo) => {
        if (finalY > PAGE_BOTTOM) {
            doc.addPage();
            finalY = PAGE_TOP;
        }
        const symbol = todo.completed ? '[x]' : '[ ]';
        const time = todo.time ? ` (${text(todo.time)})` : '';
        doc.text(`${symbol} ${text(todo.text)}${time}`, 14, finalY);
        finalY += 6;
    });

    finalY += 6;
    if (finalY > PAGE_BOTTOM) {
        doc.addPage();
        finalY = PAGE_TOP;
    }
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Error Log', 14, finalY);
    finalY += 5;

    const errorHead = [['Question', 'Mistake', 'Correct Logic']];
    const errorBody = errors
        .filter((e) => e.question || e.mistake || e.correctLogic)
        .map((e) => [text(e.question), text(e.mistake), text(e.correctLogic)]);

    if (errorBody.length === 0) {
        errorBody.push(['', '', ''], ['', '', ''], ['', '', '']);
    }

    if (typedDoc.autoTable) {
        typedDoc.autoTable({
            startY: finalY,
            head: errorHead,
            body: errorBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 220, 220], textColor: 20, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 3, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 60 },
                2: { cellWidth: 60 },
            },
        });
    }

    return doc;
};

const extractBase64 = (doc: jsPDF): string => {
    const dataUri = doc.output('datauristring');
    const separator = typeof dataUri === 'string' ? dataUri.indexOf(',') : -1;
    const base64 = separator >= 0 ? dataUri.slice(separator + 1) : '';
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 16) {
        throw new Error('PDF export produced no usable document data.');
    }
    return base64;
};

export const generatePDF = async (data: ExportData) => {
    const fileName = `Study_Tracker_${data.date}.pdf`;
    const doc = buildPdf(data, new jsPDF());

    if (Capacitor.isNativePlatform()) {
        await Filesystem.writeFile({
            path: fileName,
            data: extractBase64(doc),
            directory: Directory.External,
        });
    } else {
        doc.save(fileName);
    }
};
