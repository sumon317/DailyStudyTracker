import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import ErrorBoundary from '../components/shared/ErrorBoundary';
import DataProvider from '../providers/DataProvider';
import ThemeProvider from '../providers/ThemeProvider';
import { ToastProvider } from '../providers/ToastProvider';
import App from './App';
import './index.css';
import MotionConfig from './MotionConfig';

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Root element not found');
}

createRoot(rootElement).render(
    <StrictMode>
        <MotionConfig>
            <BrowserRouter>
                <ErrorBoundary>
                    <ThemeProvider>
                        <ToastProvider>
                            <DataProvider>
                                <Suspense
                                    fallback={
                                        <div
                                            className="flex min-h-screen items-center justify-center bg-app-bg"
                                            role="status"
                                            aria-live="polite"
                                        >
                                            <div className="flex flex-col items-center gap-4">
                                                <div
                                                    className="h-12 w-12 animate-spin rounded-full border-4 border-app-primary border-t-transparent"
                                                    aria-hidden="true"
                                                />
                                                <p className="text-sm text-app-text-muted">Loading...</p>
                                            </div>
                                        </div>
                                    }
                                >
                                    <App />
                                </Suspense>
                            </DataProvider>
                        </ToastProvider>
                    </ThemeProvider>
                </ErrorBoundary>
            </BrowserRouter>
        </MotionConfig>
    </StrictMode>,
);
