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
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the intent
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const LINE_BREAKS = /\r\n|\r|\n|\u2028|\u2029|\t/g;
// Bidi overrides, isolates and invisible markers. They survive a round trip
// through storage and render as nothing at all, so a subject name can be made
// to read differently from the text that is actually stored. ZWJ/ZWNJ (U+200D /
// U+200C) are deliberately kept: they are load-bearing for emoji sequences and
// for Indic and Arabic scripts. The variation selectors (U+FE00-U+FE0F,
// U+E0100-U+E01EF) are kept for the same reason - dropping U+FE0F turns a
// heart into a text glyph - and the tag characters (U+E0001, U+E0020-E007F)
// are kept because they are also how valid emoji tag sequences are spelled.
const INVISIBLE_FORMATTING_CHARS = /[\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
// The combining grapheme joiner is a combining *mark* rather than a formatting
// character - it attaches to the character before it and blocks any canonical
// reordering of what follows - so it is stripped on its own pass instead of
// sharing a character class with the invisible formatting characters.
const COMBINING_GRAPHEME_JOINER = /\u034f/g;
// `<`, `>` and `&` belong here as well: every Markdown renderer this export can
// land in (GitHub, VS Code, Obsidian, a docs site) allows raw inline HTML, so an
// unescaped tag would execute instead of printing. Backslash escapes are used
// rather than entities because the file is read as text, where `&amp;` would
// show up literally.
const MARKDOWN_SPECIAL_CHARS = /([\\`*_{}[\]()#+\-.!~<>&])/g;
const MARKDOWN_TABLE_CHARS = /([\\`*_{}[\]()|<>&])/g;

const asText = (input: string): string => (typeof input === 'string' ? input : '');

const stripUnsafeCharacters = (input: string): string =>
    asText(input)
        .replace(CONTROL_CHARS, '')
        .replace(INVISIBLE_FORMATTING_CHARS, '')
        .replace(COMBINING_GRAPHEME_JOINER, '');

/**
 * HTML-encodes a value for insertion into markup.
 *
 * Note that only HTML consumers decode these entities. Anything that writes the
 * string verbatim (a PDF text run, a Markdown file) must use
 * {@link sanitizePlainText} instead or it will print the escape sequences.
 */
export function sanitizeText(input: string): string {
    return stripUnsafeCharacters(input).replace(HTML_ENTITY_REGEX, (char) => HTML_ENTITY_MAP[char] ?? char);
}

/**
 * Cleans a value for consumers that render it verbatim rather than as markup,
 * without inventing entities the consumer will never decode.
 */
export function sanitizePlainText(input: string): string {
    return stripUnsafeCharacters(input);
}

export function sanitizeForMarkdown(input: string): string {
    return stripUnsafeCharacters(input).replace(LINE_BREAKS, ' ').replace(MARKDOWN_SPECIAL_CHARS, '\\$1');
}

export function sanitizeForMarkdownTableCell(input: string): string {
    return stripUnsafeCharacters(input).replace(LINE_BREAKS, ' ').replace(MARKDOWN_TABLE_CHARS, '\\$1');
}
