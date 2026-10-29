// @vitest-environment node
// The rules behind the link question, and the labels in the properties and attachments.

import { describe, expect, it } from 'vitest';
import { attachmentName, fileSizeLabel, linkKind, pageSizeLabel } from './dialogs';

describe('links', () => {
  it('offers to open only web pages and email addresses', () => {
    expect(linkKind('https://example.com/a?b=c#d')).toBe('web');
    expect(linkKind('http://example.com')).toBe('web');
    expect(linkKind('mailto:someone@example.com')).toBe('mail');
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'ms-settings:privacy',
      'data:text/html,<b>x</b>',
      'https://',
      'mailto:',
      'https://example.com/a b',
      'https://example.com/"quoted"',
      `https://example.com/${'x'.repeat(2050)}`,
      'not a link',
    ]) {
      expect(linkKind(url), url).toBeNull();
    }
  });
});

describe('labels', () => {
  it('names common paper sizes, either way round', () => {
    expect(pageSizeLabel({ width: 612, height: 792 })).toBe('Letter, 8.5 × 11 in (216 × 279 mm)');
    expect(pageSizeLabel({ width: 842, height: 595 })).toBe('A4, 11.69 × 8.26 in (297 × 210 mm)');
    expect(pageSizeLabel({ width: 500, height: 500 })).toBe('6.94 × 6.94 in (176 × 176 mm)');
  });

  it('gives file sizes in bytes, KB or MB', () => {
    expect(fileSizeLabel(1)).toBe('1 byte');
    expect(fileSizeLabel(900)).toBe('900 bytes');
    expect(fileSizeLabel(2048)).toBe('2 KB');
    expect(fileSizeLabel(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(fileSizeLabel(undefined)).toBe('');
  });

  it('keeps attachment names to a plain file name', () => {
    expect(attachmentName('notes.txt')).toBe('notes.txt');
    expect(attachmentName('..\\..\\Windows\\evil.exe')).toBe('evil.exe');
    expect(attachmentName('folder/report.pdf')).toBe('report.pdf');
    expect(attachmentName('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(attachmentName('trailing dots...')).toBe('trailing dots');
    expect(attachmentName('   ')).toBe('attachment');
  });
});
