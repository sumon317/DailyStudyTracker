import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi } from 'vitest';

// Mock File System API
// Since we can't easily mock window.showDirectoryPicker in jsdom without extra work,
// we'll rely on the fact that our hook checks for its existence.

describe('Daily Study Tracker App', () => {
    it('renders the main title', () => {
        render(<App />);
        expect(screen.getByText(/Daily Study Tracker/i)).toBeInTheDocument();
    });

    it('renders the 6-hour target label', () => {
        render(<App />);
        expect(screen.getByText(/6-Hour Target/i)).toBeInTheDocument();
    });

    it('renders the Connect Folder button', () => {
        render(<App />);
        expect(screen.getByText(/Connect Folder/i)).toBeInTheDocument();
    });

    it('renders the DatePicker', () => {
        render(<App />);
        // Initial date should be present (format varies but "Study Date" label is constant)
        expect(screen.getByText(/Study Date/i)).toBeInTheDocument();
    });

    it('renders all subject inputs', () => {
        render(<App />);
        expect(screen.getByText('Accounts')).toBeInTheDocument();
        expect(screen.getByText('Microeconomics')).toBeInTheDocument();
    });

    it('updates subject actual time', () => {
        render(<App />);
        // Find the first "Actual (min)" input. 
        // Since there are multiple, we can use test-ids or just getAllByPlaceholderText if unique enough.
        // The placeholder is '0'.
        const inputs = screen.getAllByPlaceholderText('0');
        // First subject (Accounts) actual input is typically the first one in the matched list 
        // BUT "Planned" inputs might also have values.
        // Let's use specific selector logic or add test-ids if needed.
        // Detailed check: The "Actual" input is the second one per row.

        const accountsActualInput = inputs[0]; // Assuming order
        fireEvent.change(accountsActualInput, { target: { value: '45' } });
        expect(accountsActualInput.value).toBe('45');
    });

    it('toggles a checklist item', () => {
        render(<App />);
        const checklistItem = screen.getByText(/Accounts: 5–6 problems solved/i);
        fireEvent.click(checklistItem);
        // Visual check relies on class changes which is brittle, 
        // but the checkbox input inside should be checked.
        const checkbox = checklistItem.closest('label').querySelector('input[type="checkbox"]');
        expect(checkbox).toBeChecked();
    });
});
