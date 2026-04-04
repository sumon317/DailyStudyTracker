import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import DataProvider from './providers/DataProvider';
import ThemeProvider from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .then((registration) => {
                // biome-ignore lint/suspicious/noConsole: SW registration logging is useful in production
                console.log('SW registered:', registration.scope);
            })
            .catch((error) => {
                // biome-ignore lint/suspicious/noConsole: SW registration error logging is useful
                console.log('SW registration failed:', error);
            });
    });
}

createRoot(rootElement).render(
    <StrictMode>
        <BrowserRouter>
            <ErrorBoundary>
                <ThemeProvider>
                    <ToastProvider>
                        <DataProvider>
                            <Suspense
                                fallback={
                                    <div className="min-h-screen flex items-center justify-center bg-app-bg">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="w-12 h-12 border-4 border-app-primary border-t-transparent rounded-full animate-spin" />
                                            <p className="text-app-text-muted text-sm">Loading...</p>
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
    </StrictMode>,
);
