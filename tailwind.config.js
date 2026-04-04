/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                app: {
                    bg: 'rgb(var(--color-app-bg) / <alpha-value>)',
                    surface: 'rgb(var(--color-app-surface) / <alpha-value>)',
                    'surface-variant': 'rgb(var(--color-app-surface-variant) / <alpha-value>)',
                    text: {
                        main: 'rgb(var(--color-app-text-main) / <alpha-value>)',
                        muted: 'rgb(var(--color-app-text-muted) / <alpha-value>)',
                    },
                    border: 'rgb(var(--color-app-border) / <alpha-value>)',
                    primary: {
                        DEFAULT: 'rgb(var(--color-app-primary) / <alpha-value>)',
                        hover: 'rgb(var(--color-app-primary-hover) / <alpha-value>)',
                        fg: 'rgb(var(--color-app-primary-fg) / <alpha-value>)',
                        container: 'rgb(var(--color-app-primary-container) / <alpha-value>)',
                        'container-text': 'rgb(var(--color-app-primary-container-text) / <alpha-value>)',
                    },
                    'on-surface-variant': 'rgb(var(--color-app-on-surface-variant) / <alpha-value>)',
                    outline: 'rgb(var(--color-app-outline) / <alpha-value>)',
                    'outline-variant': 'rgb(var(--color-app-outline-variant) / <alpha-value>)',
                    'inverse-surface': 'rgb(var(--color-app-inverse-surface) / <alpha-value>)',
                    'inverse-text': 'rgb(var(--color-app-inverse-text) / <alpha-value>)',
                    accent: {
                        success: 'rgb(var(--color-app-accent-success) / <alpha-value>)',
                        warning: 'rgb(var(--color-app-accent-warning) / <alpha-value>)',
                        error: 'rgb(var(--color-app-accent-error) / <alpha-value>)',
                    },
                    scrim: 'rgb(var(--color-app-scrim) / <alpha-value>)',
                },
            },
            borderRadius: {
                'md-lg': '16px',
                'md-xl': '28px',
            },
        },
    },
    plugins: [],
};
