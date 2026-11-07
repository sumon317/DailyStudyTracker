import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { tokenizeRichText } from '../../services/notesService';

interface RichTextRendererProps {
    text: string;
    highlightQuery?: string;
    className?: string;
}

const highlightText = (content: string, query?: string): ReactNode => {
    const trimmed = query?.trim();
    if (!trimmed) {
        return content;
    }
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = content.split(new RegExp(`(${escaped})`, 'gi'));
    if (parts.length <= 1) {
        return content;
    }
    return parts.map((part, index) => {
        const key = `${index}-${part.slice(0, 8)}`;
        if (part.toLowerCase() === trimmed.toLowerCase()) {
            return (
                <mark key={key} className="rounded bg-amber-400/40 px-0.5 text-app-text-main">
                    {part}
                </mark>
            );
        }
        return part;
    });
};

export default function RichTextRenderer({ text, highlightQuery, className = '' }: RichTextRendererProps) {
    const lines = text.split('\n');

    return (
        <div className={`space-y-1.5 break-words [overflow-wrap:anywhere] ${className}`}>
            {lines.map((line, lineIndex) => {
                const lineKey = `line-${lineIndex}`;
                if (line.length === 0) {
                    return <div key={lineKey} className="h-3" aria-hidden="true" />;
                }
                const spans = tokenizeRichText(line);
                return (
                    <p
                        key={lineKey}
                        className="leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-wrap"
                    >
                        {spans.map((span, spanIndex) => {
                            const spanKey = `${lineKey}-span-${spanIndex}`;
                            switch (span.type) {
                                case 'bold':
                                    return (
                                        <strong
                                            key={spanKey}
                                            className="font-bold text-app-text-main break-words [overflow-wrap:anywhere]"
                                        >
                                            {highlightText(span.content, highlightQuery)}
                                        </strong>
                                    );
                                case 'italic':
                                    return (
                                        <em key={spanKey} className="italic break-words [overflow-wrap:anywhere]">
                                            {highlightText(span.content, highlightQuery)}
                                        </em>
                                    );
                                case 'strikethrough':
                                    return (
                                        <span
                                            key={spanKey}
                                            className="line-through opacity-75 break-words [overflow-wrap:anywhere]"
                                        >
                                            {highlightText(span.content, highlightQuery)}
                                        </span>
                                    );
                                case 'code':
                                    return (
                                        <code
                                            key={spanKey}
                                            className="rounded border border-app-border bg-app-bg/70 px-1.5 py-0.5 font-mono text-[0.85em] text-app-primary break-all"
                                        >
                                            {highlightText(span.content, highlightQuery)}
                                        </code>
                                    );
                                case 'link':
                                    return (
                                        <a
                                            key={spanKey}
                                            href={span.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(event) => event.stopPropagation()}
                                            className="inline-flex max-w-full items-center gap-1 font-medium text-app-primary underline decoration-app-primary/60 underline-offset-2 hover:decoration-app-primary break-all"
                                        >
                                            <span className="break-all">
                                                {highlightText(span.label, highlightQuery)}
                                            </span>
                                            <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
                                        </a>
                                    );
                                default:
                                    return (
                                        <span key={spanKey} className="break-words [overflow-wrap:anywhere]">
                                            {highlightText(span.content, highlightQuery)}
                                        </span>
                                    );
                            }
                        })}
                    </p>
                );
            })}
        </div>
    );
}
