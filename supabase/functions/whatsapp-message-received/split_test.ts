import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { splitMessage } from './split.ts';

Deno.test('defaults split on newlines only', () => {
  assertEquals(splitMessage('milk, bread\neggs'), ['milk, bread', 'eggs']);
});

Deno.test('comma delimiter', () => {
  assertEquals(
    splitMessage('milk, bread , eggs', { delimiters: ',' }),
    ['milk', 'bread', 'eggs'],
  );
});

Deno.test('space splitting', () => {
  assertEquals(
    splitMessage('milk bread eggs', { splitOnSpace: true }),
    ['milk', 'bread', 'eggs'],
  );
});

Deno.test('custom characters, whitespace in field ignored', () => {
  assertEquals(
    splitMessage('milk / bread | eggs', { splitOnNewline: false, delimiters: '/ |' }),
    ['milk', 'bread', 'eggs'],
  );
});

Deno.test('no rules keeps whole message as one item', () => {
  assertEquals(
    splitMessage('milk\nbread', { splitOnNewline: false }),
    ['milk\nbread'],
  );
});

Deno.test('minimum length drops short fragments', () => {
  assertEquals(
    splitMessage('milk,a,bread', { delimiters: ',', minFragmentLength: 2 }),
    ['milk', 'bread'],
  );
});

Deno.test('regex-special delimiters are escaped', () => {
  assertEquals(
    splitMessage('milk-bread]eggs', { splitOnNewline: false, delimiters: '-]' }),
    ['milk', 'bread', 'eggs'],
  );
});
