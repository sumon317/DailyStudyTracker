import { describe, expect, it } from 'vitest';
import { sanitizeForMarkdown, sanitizeText } from './sanitize';

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
    });
});
