import { expect, it } from 'vitest';
import { paperContext } from './paperContext';
it('keeps all text and page citations for an ordinary paper', () => {
  const text = paperContext([{ page: 1, text: 'Introduction.' }, { page: 2, text: 'Evidence.' }], '내용', 1);
  expect(text).toContain('[p. 1;'); expect(text).toContain('[p. 2;'); expect(text).toContain('선택 가능한 전체');
});
it('bounds long context while prioritizing relevant passages and disclosing omissions', () => {
  const pages = Array.from({ length: 80 }, (_, i) => ({ page: i + 1, text: i === 65 ? 'specialmethod '.repeat(220) : 'ordinary '.repeat(350) }));
  const text = paperContext(pages, 'specialmethod', 70, 12000);
  expect(text).toContain('[p. 66;'); expect(text).toContain('[p. 70;'); expect(text).toContain('생략'); expect(text.length).toBeLessThan(12100);
});

it('budgets UTF-8 bytes before ranking so multilingual evidence and its page labels stay together', () => {
  const pages = Array.from({ length: 80 }, (_, i) => ({ page: i + 1, text: i === 40 ? 'specificdefinition '.repeat(220) : '한글 논문 내용 '.repeat(350) }));
  const text = paperContext(pages, 'specificdefinition', 50);
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(80000);
  expect(text).toContain('[p. 41;'); expect(text).toContain('[p. 50;');
  expect(text).toContain('생략된 부분');
});
