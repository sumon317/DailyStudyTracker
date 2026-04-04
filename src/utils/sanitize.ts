const HTML_ENTITY_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#96;',
    '=': '&#61;',
};

const HTML_ENTITY_REGEX = /[&<>"'`/=/]/g;

export function sanitizeText(input: string): string {
    return input.replace(HTML_ENTITY_REGEX, (char) => HTML_ENTITY_MAP[char] ?? char);
}

const MARKDOWN_SPECIAL_CHARS = /([\\`*_{}[\]()#+\-.!~])/g;

export function sanitizeForMarkdown(input: string): string {
    return input.replace(MARKDOWN_SPECIAL_CHARS, '\\$1');
}
