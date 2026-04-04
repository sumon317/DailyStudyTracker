import type { ReactNode } from 'react';
import { StrictMode, Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import DataProvider from './providers/DataProvider';
import ThemeProvider from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';

interface TestWrapperProps {
    children: ReactNode;
}

export function TestWrapper({ children }: TestWrapperProps) {
    return (
        <StrictMode>
            <MemoryRouter>
                <ThemeProvider>
                    <ToastProvider>
                        <DataProvider>
                            <Suspense fallback={<div data-testid="loading">Loading...</div>}>{children}</Suspense>
                        </DataProvider>
                    </ToastProvider>
                </ThemeProvider>
            </MemoryRouter>
        </StrictMode>
    );
}
