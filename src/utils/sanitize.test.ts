import { describe, expect, it } from 'vitest';
import { sanitizeForMarkdown, sanitizeForMarkdownTableCell, sanitizePlainText, sanitizeText } from './sanitize';

describe('sanitize', () => {
    describe('sanitizeText', () => {
        it('should return empty string for empty input', () => {
            expect(sanitizeText('')).toBe('');
        });

        it('should escape HTML entities', () => {
            expect(sanitizeText('<script>alert("xss")</script>')).toBe(
                '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;',
            );
        });

        it('should escape ampersands', () => {
            expect(sanitizeText('A & B')).toBe('A &amp; B');
        });

        it('should escape quotes', () => {
            expect(sanitizeText('He said "hello"')).toBe('He said &quot;hello&quot;');
        });

        it('should pass through plain text', () => {
            expect(sanitizeText('Hello World')).toBe('Hello World');
        });

        it('should handle special characters', () => {
            expect(sanitizeText('<>&"\'\\')).toBe('&lt;&gt;&amp;&quot;&#x27;\\');
        });

        it('should escape backticks', () => {
            expect(sanitizeText('`code`')).toBe('&#96;code&#96;');
        });

        it('should escape equals signs', () => {
            expect(sanitizeText('a=b')).toBe('a&#61;b');
        });

        it('should escape forward slashes', () => {
            expect(sanitizeText('a/b')).toBe('a&#x2F;b');
        });
    });

    describe('sanitizeForMarkdown', () => {
        it('should escape backticks', () => {
            expect(sanitizeForMarkdown('`code`')).toBe('\\`code\\`');
        });

        it('should escape asterisks', () => {
            expect(sanitizeForMarkdown('*bold*')).toBe('\\*bold\\*');
        });

        it('should escape underscores', () => {
            expect(sanitizeForMarkdown('_italic_')).toBe('\\_italic\\_');
        });

        it('should escape brackets', () => {
            expect(sanitizeForMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)');
        });

        it('should escape parentheses', () => {
            expect(sanitizeForMarkdown('(parens)')).toBe('\\(parens\\)');
        });

        it('should escape hashes', () => {
            expect(sanitizeForMarkdown('# Header')).toBe('\\# Header');
        });

        it('should escape plus signs', () => {
            expect(sanitizeForMarkdown('+ item')).toBe('\\+ item');
        });

        it('should escape dashes', () => {
            expect(sanitizeForMarkdown('- item')).toBe('\\- item');
        });

        it('should escape dots', () => {
            expect(sanitizeForMarkdown('...')).toBe('\\.\\.\\.');
        });

        it('should escape exclamation marks', () => {
            expect(sanitizeForMarkdown('!note')).toBe('\\!note');
        });

        it('should pass through plain text', () => {
            expect(sanitizeForMarkdown('Hello World')).toBe('Hello World');
        });

        it('should collapse newlines and tabs so a label cannot break out of its list item', () => {
            expect(sanitizeForMarkdown('first\n- [x] injected')).toBe('first \\- \\[x\\] injected');
            expect(sanitizeForMarkdown('a\r\nb\tc')).toBe('a b c');
        });

        it('should strip control characters', () => {
            expect(sanitizeForMarkdown('a\u0000b\u0007c')).toBe('abc');
            expect(sanitizeText('a\u0000b\u007fc')).toBe('abc');
        });
    });

    describe('sanitizeForMarkdownTableCell', () => {
        it('should escape pipes so a cell cannot add table columns', () => {
            expect(sanitizeForMarkdownTableCell('Accounts | Economics')).toBe('Accounts \\| Economics');
        });

        it('should collapse newlines so a cell cannot add table rows', () => {
            expect(sanitizeForMarkdownTableCell('a\n| **Total** | 1 | 1 |')).toBe(
                'a \\| \\*\\*Total\\*\\* \\| 1 \\| 1 \\|',
            );
        });

        it('should neutralise markdown emphasis and links inside a cell', () => {
            expect(sanitizeForMarkdownTableCell('[x](javascript:alert(1))')).toBe(
                '\\[x\\]\\(javascript:alert\\(1\\)\\)',
            );
            expect(sanitizeForMarkdownTableCell('`code`')).toBe('\\`code\\`');
            expect(sanitizeForMarkdownTableCell('a\\b')).toBe('a\\\\b');
        });

        it('should pass through plain text', () => {
            expect(sanitizeForMarkdownTableCell('Business Studies')).toBe('Business Studies');
        });
    });

    describe('shared character stripping', () => {
        const everySanitizer = [
            ['sanitizeText', sanitizeText],
            ['sanitizePlainText', sanitizePlainText],
            ['sanitizeForMarkdown', sanitizeForMarkdown],
            ['sanitizeForMarkdownTableCell', sanitizeForMarkdownTableCell],
        ] as const;

        it.each(everySanitizer)('%s removes C0 and C1 control characters', (_name, sanitize) => {
            expect(sanitize('a\u0000b\u0001c\u0007d\u001be\u007ff\u009fg')).toBe('abcdefg');
        });

        it.each([
            ['sanitizeText', sanitizeText],
            ['sanitizePlainText', sanitizePlainText],
        ] as const)('%s keeps tab and newline as layout, for the caller to interpret', (_name, sanitize) => {
            // These three are ordinary text layout, not corruption, so they are
            // deliberately left alone: only the Markdown writers fold them.
            expect(sanitize('a\tb\nc\rd')).toBe('a\tb\nc\rd');
        });

        it.each([
            ['sanitizeForMarkdown', sanitizeForMarkdown],
            ['sanitizeForMarkdownTableCell', sanitizeForMarkdownTableCell],
        ] as const)('%s folds tab and newline into a space', (_name, sanitize) => {
            expect(sanitize('a\tb\nc\rd')).toBe('a b c d');
        });

        it.each(everySanitizer)('%s removes invisible formatting characters', (_name, sanitize) => {
            // Bidi overrides survive a round trip through storage and render as
            // nothing, so a name can be made to read differently from what is
            // actually stored.
            expect(sanitize('Maths\u202e')).toBe('Maths');
            expect(sanitize('\u202dSubjects\u202c')).toBe('Subjects');
            expect(sanitize('a\u200bb\u2060c\ufeffd')).toBe('abcd');
            expect(sanitize('a\u200eb\u200fc\u2066d\u2069e')).toBe('abcde');
        });

        it.each(everySanitizer)('%s keeps the zero-width joiners emoji and scripts need', (_name, sanitize) => {
            // ZWJ/ZWNJ are load-bearing for emoji sequences and for Indic and
            // Arabic script, so stripping them would corrupt real subjects.
            expect(sanitize('👨‍👩‍👧')).toBe('👨‍👩‍👧');
            expect(sanitize('नि\u200cत')).toBe('नि\u200cत');
            expect(sanitize('a\u200db')).toBe('a\u200db');
        });

        it.each(everySanitizer)('%s keeps the variation selectors that spell emoji', (_name, sanitize) => {
            // U+FE0F is what makes U+2764 render as an emoji rather than as text
            // glyph, and a family emoji is spelled as a tag sequence, so the
            // same reasoning as ZWJ applies to both.
            expect(sanitize('❤️')).toBe('❤️');
            expect(sanitize('❤️')).toBe('❤️');
            expect(sanitize('🏴󠁧󠁢󠁥󠁮󠁧󠁿')).toBe('🏴󠁧󠁢󠁥󠁮󠁧󠁿');
        });

        it.each(everySanitizer)('%s removes the remaining glyph-less marks', (_name, sanitize) => {
            // The rest of the same class: a soft hyphen, a bare combining
            // grapheme joiner, the Arabic letter mark, and the invisible math
            // operators all render as nothing, so a name can be padded out to
            // look longer or shorter than the text that is actually stored.
            expect(sanitize('Maths\u00ad')).toBe('Maths');
            expect(sanitize('a\u034fb')).toBe('ab');
            expect(sanitize('a\u061cb')).toBe('ab');
            expect(sanitize('a\u2061b\u2062c\u2063d\u2064e')).toBe('abcde');
        });

        it.each(everySanitizer)('%s coerces a non-string to empty rather than throwing', (_name, sanitize) => {
            const call = sanitize as (value: unknown) => string;
            expect(call(undefined)).toBe('');
            expect(call(null)).toBe('');
            expect(call(42)).toBe('');
            expect(call({})).toBe('');
            expect(call(['a'])).toBe('');
        });
    });

    describe('sanitizePlainText', () => {
        it('leaves markup characters readable for a consumer that prints them verbatim', () => {
            // A PDF text run and a Markdown file are not HTML, so inventing
            // entities here would print `&amp;` into the exported document.
            expect(sanitizePlainText('Tom & Jerry <best> "quoted"')).toBe('Tom & Jerry <best> "quoted"');
            expect(sanitizePlainText('a/b`c=d')).toBe('a/b`c=d');
            expect(sanitizePlainText('')).toBe('');
        });

        it('still strips the characters a verbatim consumer cannot render', () => {
            expect(sanitizePlainText('a\u0000b\u202ec')).toBe('abc');
        });
    });

    describe('sanitizeForMarkdown line separators', () => {
        it('flattens the Unicode line and paragraph separators too', () => {
            // A raw U+2028 renders as a line break in HTML output but is not a
            // newline to a Markdown parser, so it would slip past a check for
            // `\n` alone.
            expect(sanitizeForMarkdown('first\u2028- injected')).toBe('first \\- injected');
            expect(sanitizeForMarkdown('first\u2029- injected')).toBe('first \\- injected');
            expect(sanitizeForMarkdownTableCell('a\u2028| b')).toBe('a \\| b');
        });
    });

    describe('markdown round trip', () => {
        it('neutralises raw inline HTML rather than letting a tag execute', () => {
            // Every Markdown renderer this export can land in allows raw inline
            // HTML, so an unescaped tag would run instead of printing. `=` and
            // `;` carry no meaning in Markdown, so they are left as typed.
            expect(sanitizeForMarkdown('<img src=x onerror=alert(1)>')).toBe('\\<img src=x onerror=alert\\(1\\)\\>');
            // `/` and `=` and `;` are inert in Markdown, so only the angle
            // brackets that could open a tag are escaped.
            expect(sanitizeForMarkdownTableCell('<script>alert(1)</script>')).toBe(
                '\\<script\\>alert\\(1\\)\\</script\\>',
            );
            expect(sanitizeForMarkdown('<!-- comment -->')).toBe('\\<\\!\\-\\- comment \\-\\-\\>');
        });

        it('neutralises entity smuggling into a Markdown document', () => {
            // `&` is escaped, so a stored entity cannot re-enter as markup.
            expect(sanitizeForMarkdown('&NewLine;<b>')).toBe('\\&NewLine;\\<b\\>');
            expect(sanitizeText('&amp;')).toBe('&amp;amp;');
        });
    });
});
