import { expect, it } from 'vitest';
import { findPageMatches, indexSearchPage, searchText } from './pdfSearch';
const item = (str: string, x = 30, y = 700, hasEOL = false) => ({ str, transform: [10,0,0,10,x,y], width: str.length * 5, height: 10, dir: 'ltr', fontName: 'test', hasEOL });
it('finds every occurrence across font runs and maps offsets to original glyphs', () => {
 const index = indexSearchPage([item('A '), item('mod',40), item('el ',55),item('and model',70)]);
 const found = findPageMatches(index, 'MODEL', 2);
 expect(found).toHaveLength(2); expect(found[0].parts).toEqual([{item:1,start:0,end:3},{item:2,start:0,end:2}]);
 expect(found[1].parts).toEqual([{item:3,start:4,end:9}]); expect(found[1].pageNumber).toBe(2);
});
it('matches wrapped words, compatibility ligatures and whitespace without losing source offsets', () => {
 const index = indexSearchPage([item('An efﬁcient inter-',30,700,true), item('national model.',30,685)]);
 expect(findPageMatches(index,'efficient international',1)[0].parts).toEqual([{item:0,start:3,end:18},{item:1,start:0,end:8}]);
 expect(searchText('A\t  B\nC').text).toBe('a b c');
 expect(findPageMatches(index, ' ',1)).toEqual([]);
});
it('uses positional gaps between separate words, but keeps inline subscripts contiguous', () => {
 const index = indexSearchPage([item('Two',30),item('words',60),item(' x',90),item('1',100,698)]);
 expect(findPageMatches(index,'two words',1)).toHaveLength(1);
 expect(findPageMatches(index,'x1',1)).toHaveLength(1);
});
