/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                app: {
                    bg: 'rgb(var(--color-app-bg) / <alpha-value>)',
                    surface: 'rgb(var(--color-app-surface) / <alpha-value>)',
                    text: {
                        main: 'rgb(var(--color-app-text-main) / <alpha-value>)',
                        muted: 'rgb(var(--color-app-text-muted) / <alpha-value>)',
                    },
                    border: 'rgb(var(--color-app-border) / <alpha-value>)',
                    primary: {
                        DEFAULT: 'rgb(var(--color-app-primary) / <alpha-value>)',
                        hover: 'rgb(var(--color-app-primary-hover) / <alpha-value>)',
                        fg: 'rgb(var(--color-app-primary-fg) / <alpha-value>)',
                    },
                    accent: {
                        success: 'rgb(var(--color-app-accent-success) / <alpha-value>)',
                        warning: 'rgb(var(--color-app-accent-warning) / <alpha-value>)',
                        error: 'rgb(var(--color-app-accent-error) / <alpha-value>)',
                    }
                }
            }
        },
    },
    plugins: [],
}
