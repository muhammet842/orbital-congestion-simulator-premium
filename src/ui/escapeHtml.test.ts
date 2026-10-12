// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { escapeHtml, safeHttpUrl } from './escapeHtml';

describe('escapeHtml', () => {
  it('neutralises markup and both quote styles', () => {
    const out = escapeHtml(`<img src=x onerror="alert(1)"> & 'x'`);
    expect(out).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;x&#39;');
    expect(out).not.toMatch(/[<>"']/);
  });

  it('leaves plain catalog names untouched', () => {
    expect(escapeHtml('STARLINK-1234')).toBe('STARLINK-1234');
  });

  it('is safe for attribute and innerHTML round-trips', () => {
    const el = document.createElement('div');
    el.innerHTML = `<span title='${escapeHtml(`' onmouseover='x`)}'>${escapeHtml('<b>x</b>')}</span>`;
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('span')?.getAttribute('onmouseover')).toBeNull();
    expect(el.textContent).toBe('<b>x</b>');
  });
});

describe('safeHttpUrl', () => {
  it('allows http(s) URLs', () => {
    expect(safeHttpUrl('https://www.amsat.org/x')).toBe('https://www.amsat.org/x');
    expect(safeHttpUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects script and data schemes, and garbage', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBe('#');
    expect(safeHttpUrl('data:text/html,<script>1</script>')).toBe('#');
    expect(safeHttpUrl('not a url')).toBe('#');
  });
});
