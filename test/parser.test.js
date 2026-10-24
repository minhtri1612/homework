import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize, validateQuestion, normalizeText } from '../src/shared/parser.js';

// Compact view of parsed questions: text + answers, "==" marking the correct one.
function simple(result) {
  return result.questions.map((q) => ({
    text: q.text,
    answers: q.answers.map((a) => (a.correct ? `==${a.text}` : a.text)),
  }));
}

function codes(result) {
  return result.errors.map((e) => e.code);
}

describe('plain format (answers without letters)', () => {
  test('example from the spec', () => {
    const result = parse('Con cua có mấy càng?\n==2\n3\n4\n5');
    assert.deepEqual(simple(result), [
      { text: 'Con cua có mấy càng?', answers: ['==2', '3', '4', '5'] },
    ]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  test('correct answer does not have to come first', () => {
    const result = parse('Con cua có mấy càng?\n3\n4\n==2\n5');
    assert.deepEqual(simple(result)[0].answers, ['3', '4', '==2', '5']);
  });

  test('questions separated by blank lines', () => {
    const result = parse('Câu hỏi một?\n==a\nb\n\n\nCâu hỏi hai?\nc\n==d');
    assert.deepEqual(simple(result), [
      { text: 'Câu hỏi một?', answers: ['==a', 'b'] },
      { text: 'Câu hỏi hai?', answers: ['c', '==d'] },
    ]);
  });

  test('without blank lines, a line ending in "?" or ":" starts a new question', () => {
    const result = parse('1 + 1 = ?\n==2\n3\nThủ đô của Việt Nam là:\n==Hà Nội\nHuế\nAi viết Truyện Kiều?\n==Nguyễn Du\nNguyễn Trãi');
    assert.deepEqual(simple(result), [
      { text: '1 + 1 = ?', answers: ['==2', '3'] },
      { text: 'Thủ đô của Việt Nam là:', answers: ['==Hà Nội', 'Huế'] },
      { text: 'Ai viết Truyện Kiều?', answers: ['==Nguyễn Du', 'Nguyễn Trãi'] },
    ]);
  });

  test('"== " with a space is accepted', () => {
    const result = parse('Q?\n== 2\n3');
    assert.deepEqual(simple(result)[0].answers, ['==2', '3']);
  });
});

describe('lettered format (A. B. C. on separate lines)', () => {
  test('== before or after the letter, all prefix styles', () => {
    const variants = [
      'Q?\nA. mèo\n==B. chó\nC. gà',
      'Q?\nA. mèo\nB. ==chó\nC. gà',
      'Q?\na) mèo\n==b) chó\nc) gà',
      'Q?\n(A) mèo\n== (B) chó\n(C) gà',
      'Q?\nA: mèo\nB:==chó\nC: gà',
      'Q?\nA.mèo\n==B.chó\nC.gà',
    ];
    for (const text of variants) {
      assert.deepEqual(simple(parse(text)), [{ text: 'Q?', answers: ['mèo', '==chó', 'gà'] }], text);
    }
  });

  test('question text can span several lines', () => {
    const result = parse('Đọc đoạn thơ sau:\n"Trăm năm trong cõi người ta"\nĐây là câu thơ của ai?\nA. Hồ Xuân Hương\n==B. Nguyễn Du');
    assert.equal(result.questions[0].text, 'Đọc đoạn thơ sau:\n"Trăm năm trong cõi người ta"\nĐây là câu thơ của ai?');
    assert.deepEqual(simple(result)[0].answers, ['Hồ Xuân Hương', '==Nguyễn Du']);
  });

  test('a line without a letter after the answers starts a new question', () => {
    const result = parse('Q1\nA. x\n==B. y\nQ2\n==A. z\nB. w');
    assert.deepEqual(simple(result), [
      { text: 'Q1', answers: ['x', '==y'] },
      { text: 'Q2', answers: ['==z', 'w'] },
    ]);
  });

  test('up to 6 answers is fine', () => {
    const result = parse('Q?\nA. 1\nB. 2\nC. 3\nD. 4\nE. 5\n==F. 6');
    assert.equal(result.questions[0].answers.length, 6);
    assert.deepEqual(result.errors, []);
  });
});

describe('numbered questions', () => {
  test('"1." / "2)" / "Câu 3:" / "CÂU 4." / "Bài 5 -" all start a question', () => {
    const result = parse([
      '1. Một?', '==a', 'b',
      '2) Hai?', 'c', '==d',
      'Câu 3: Ba?', '==e', 'f',
      'CÂU 4. Bốn?', '==g', 'h',
      'Bài 5 - Năm?', '==i', 'k',
    ].join('\n'));
    assert.deepEqual(simple(result).map((q) => q.text), ['Một?', 'Hai?', 'Ba?', 'Bốn?', 'Năm?']);
    assert.deepEqual(result.errors, []);
  });

  test('numbered questions need no "?" or blank line to be separated', () => {
    const result = parse('1. Chọn số chẵn\n==2\n3\n2. Chọn số lẻ\n4\n==5');
    assert.deepEqual(simple(result), [
      { text: 'Chọn số chẵn', answers: ['==2', '3'] },
      { text: 'Chọn số lẻ', answers: ['4', '==5'] },
    ]);
  });

  test('"Câu 1:" alone on a line, question text on the next line', () => {
    const result = parse('Câu 1:\nCon cua có mấy càng?\n==2\n3');
    assert.deepEqual(simple(result), [{ text: 'Con cua có mấy càng?', answers: ['==2', '3'] }]);
  });

  test('things that only look like numbering are left alone', () => {
    const result = parse('Câu 5 trong bài thơ nói về gì?\n==3.5\n4.5\n10 con');
    assert.deepEqual(simple(result), [
      { text: 'Câu 5 trong bài thơ nói về gì?', answers: ['==3.5', '4.5', '10 con'] },
    ]);
  });
});

describe('compact one-line format', () => {
  test('example from the spec (no question text → warning, not error)', () => {
    const result = parse('1. A. cat   B. dog   ==C. pencil   D. parrot');
    assert.deepEqual(simple(result), [{ text: '', answers: ['cat', 'dog', '==pencil', 'parrot'] }]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings.map((w) => w.code), ['EMPTY_QUESTION']);
  });

  test('question and answers on one line', () => {
    const result = parse('1. Con nào không phải con vật? A. mèo  B. chó  ==C. bút chì  D. vẹt');
    assert.deepEqual(simple(result), [
      { text: 'Con nào không phải con vật?', answers: ['mèo', 'chó', '==bút chì', 'vẹt'] },
    ]);
  });

  test('question on the line above', () => {
    const result = parse('Con nào không phải con vật?\nA. mèo\tB. chó\t==C. bút chì\tD. vẹt');
    assert.deepEqual(simple(result)[0].text, 'Con nào không phải con vật?');
    assert.equal(result.questions[0].answers.length, 4);
  });

  test('two answers per line', () => {
    const result = parse('Q?\nA. mèo      B. chó\n==C. gà     D. vịt');
    assert.deepEqual(simple(result), [{ text: 'Q?', answers: ['mèo', 'chó', '==gà', 'vịt'] }]);
  });

  test('"C. ==text", lowercase and (A) markers', () => {
    assert.deepEqual(simple(parse('Q? a. x b. ==y c. z'))[0].answers, ['x', '==y', 'z']);
    assert.deepEqual(simple(parse('Q? (A) x ==(B) y (C) z'))[0].answers, ['x', '==y', 'z']);
  });

  test('a letter in the question text does not break detection', () => {
    const result = parse('Thiếu vitamin A. Bệnh gì? A. quáng gà ==B. còi xương');
    // ("quáng gà" is actually right, but the teacher marked B — we keep what was written)
    assert.deepEqual(simple(result), [
      { text: 'Thiếu vitamin A. Bệnh gì?', answers: ['quáng gà', '==còi xương'] },
    ]);
  });

  test('consecutive compact lines become separate questions', () => {
    const result = parse('1. A. cat B. dog ==C. pen\n2. ==A. red B. run C. blue');
    assert.equal(result.questions.length, 2);
    assert.deepEqual(simple(result)[1].answers, ['==red', 'run', 'blue']);
  });

  test('a repeated "A." without numbering starts a new question', () => {
    const result = parse('A. cat B. dog ==C. pen\nA. red ==B. run');
    assert.equal(result.questions.length, 2);
  });
});

describe('errors (never drop input silently)', () => {
  test('no correct answer', () => {
    const result = parse('Q?\n2\n3');
    assert.deepEqual(codes(result), ['NO_CORRECT']);
    assert.match(result.errors[0].message, /==/);
    assert.equal(result.errors[0].question, 1);
    assert.equal(result.errors[0].line, 1);
  });

  test('more than one correct answer', () => {
    const result = parse('Q?\n==A. 2\n==B. 3\nC. 4');
    assert.deepEqual(codes(result), ['MULTIPLE_CORRECT']);
    assert.match(result.errors[0].message, /A, B/);
  });

  test('only one answer / no answers', () => {
    assert.deepEqual(codes(parse('Q?\n==2')), ['TOO_FEW_ANSWERS']);
    assert.deepEqual(codes(parse('Bài kiểm tra 15 phút')), ['NO_ANSWERS']);
  });

  test('a stray line in the middle becomes its own (invalid) question, the rest still parses', () => {
    const result = parse('Q1?\n==a\nb\n\nBÀI KIỂM TRA 15 PHÚT\n\nQ2?\n==2\n3');
    assert.equal(result.questions.length, 3);
    assert.deepEqual(result.questions[1].errors.map((e) => e.code), ['NO_ANSWERS']);
    assert.deepEqual(result.questions[2].errors, []);
  });

  test('more than 6 answers', () => {
    const result = parse('Q?\nA. 1\nB. 2\nC. 3\nD. 4\nE. 5\nF. 6\n==G. 7');
    assert.deepEqual(codes(result), ['TOO_MANY_ANSWERS']);
  });

  test('empty answer, pointing at its own line', () => {
    const result = parse('Q?\nA. x\n==B.\nC. y');
    assert.deepEqual(codes(result), ['EMPTY_ANSWER']);
    assert.equal(result.errors[0].line, 3);
    assert.match(result.errors[0].message, /Đáp án B/);
  });

  test('duplicate answers, ignoring case, spacing and Unicode form', () => {
    const result = parse(`Thủ đô?\n==Hà Nội\n${'hà   nội'.normalize('NFD')}\nHuế`);
    assert.deepEqual(codes(result), ['DUPLICATE_ANSWER']);
    assert.equal(result.errors[0].line, 3);
    assert.match(result.errors[0].message, /B trùng với đáp án A/);
  });

  test('empty input', () => {
    assert.deepEqual(codes(parse('')), ['EMPTY_INPUT']);
    assert.deepEqual(codes(parse('  \n\n \t ')), ['EMPTY_INPUT']);
  });

  test('errors carry the question number and line', () => {
    const result = parse('Q1?\n==a\nb\n\nQ2?\nc\nd');
    assert.deepEqual(result.errors, [
      { code: 'NO_CORRECT', message: result.errors[0].message, line: 5, question: 2 },
    ]);
  });
});

describe('homework title', () => {
  test('first line followed by a blank line is the title, not a question', () => {
    const result = parse('\n  BÀI KIỂM TRA   15 PHÚT \n\nQ?\n==2\n3');
    assert.equal(result.title, 'BÀI KIỂM TRA 15 PHÚT');
    assert.deepEqual(simple(result), [{ text: 'Q?', answers: ['==2', '3'] }]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.questions[0].line, 4);
  });

  test('numbered first line can be a title ("Bài 1: …")', () => {
    const result = parse('Bài 1: Ôn tập chương 2\n\nQ?\n==2\n3');
    assert.equal(result.title, 'Bài 1: Ôn tập chương 2');
    assert.equal(result.questions.length, 1);
  });

  test('no title when the first line is directly followed by more text', () => {
    const result = parse('Con cua có mấy càng?\n==2\n3');
    assert.equal(result.title, null);
    assert.equal(result.questions.length, 1);
  });

  test('no title when the text is a single line', () => {
    const result = parse('Bài kiểm tra 15 phút');
    assert.equal(result.title, null);
    assert.deepEqual(codes(result), ['NO_ANSWERS']);
  });

  test('an answer line is never a title', () => {
    assert.equal(parse('==A. x\n\nQ?\n==2\n3').title, null);
    assert.equal(parse('1. A. cat   ==B. dog\n\nQ?\n==2\n3').title, null);
  });

  test('only a title: EMPTY_INPUT', () => {
    const result = parse('BÀI KIỂM TRA\n\n');
    assert.equal(result.title, 'BÀI KIỂM TRA');
    assert.deepEqual(codes(result), ['EMPTY_INPUT']);
  });
});

describe('Unicode and messy input', () => {
  test('Vietnamese typed in decomposed form (NFD, common on macOS) becomes NFC', () => {
    const nfd = 'Con cua có mấy càng?\n==Hai\nBa'.normalize('NFD');
    const result = parse(nfd);
    assert.equal(result.questions[0].text, 'Con cua có mấy càng?'.normalize('NFC'));
    assert.equal(result.questions[0].text.length, 'Con cua có mấy càng?'.length);
  });

  test('Windows / old Mac line endings, BOM, tabs and non-breaking spaces', () => {
    const result = parse('\uFEFFQ1?\r\n==\u00A0a\r\nb\r\n\r\nQ2?\r==c\rd\t\t');
    assert.deepEqual(simple(result), [
      { text: 'Q1?', answers: ['==a', 'b'] },
      { text: 'Q2?', answers: ['==c', 'd'] },
    ]);
  });

  test('line numbers survive normalisation', () => {
    assert.equal(normalizeText('a\r\nb\rc\u2028d').split('\n').length, 4);
    const result = parse('\r\n\r\nQ?\r\n2\r\n3');
    assert.equal(result.errors[0].line, 3);
  });

  test('full-width equals signs (some Vietnamese keyboards) works as ==', () => {
    assert.deepEqual(simple(parse('Q?\n\uFF1D\uFF1D2\n3'))[0].answers, ['==2', '3']);
  });
});

describe('validateQuestion (form cards)', () => {
  test('valid card', () => {
    const card = { text: 'Q?', answers: [{ text: 'a', correct: true }, { text: 'b', correct: false }] };
    assert.deepEqual(validateQuestion(card), { errors: [], warnings: [] });
  });

  test('card errors have no line numbers and no syntax hints', () => {
    const card = { text: 'Q?', answers: [{ text: 'a', correct: false }, { text: '', correct: false }] };
    const { errors } = validateQuestion(card);
    assert.deepEqual(errors.map((e) => e.code), ['NO_CORRECT', 'EMPTY_ANSWER']);
    assert.ok(errors.every((e) => !('line' in e)));
    assert.doesNotMatch(errors[0].message, /==/);
  });
});

describe('serialize', () => {
  const questions = [
    { text: 'Con cua có mấy càng?', answers: [{ text: '2', correct: true }, { text: '3', correct: false }] },
    { text: 'Đọc đoạn sau:\nTrăm năm trong cõi người ta\nCủa ai?', answers: [{ text: 'Nguyễn Trãi', correct: false }, { text: 'Nguyễn Du', correct: true }] },
    { text: '', answers: [{ text: 'cat', correct: false }, { text: 'pencil', correct: true }] },
  ];

  test('output format', () => {
    assert.equal(
      serialize(questions.slice(0, 1)),
      '1. Con cua có mấy càng?\n==A. 2\nB. 3',
    );
  });

  test('parse(serialize(x)) gives x back', () => {
    const result = parse(serialize(questions));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.questions.map(({ text, answers }) => ({
        text,
        answers: answers.map(({ text, correct }) => ({ text, correct })),
      })),
      questions,
    );
  });

  test('with a title', () => {
    const text = serialize(questions.slice(0, 1), 'Bài 1: Ôn tập');
    assert.equal(text, 'Bài 1: Ôn tập\n\n1. Con cua có mấy càng?\n==A. 2\nB. 3');
    const result = parse(text);
    assert.equal(result.title, 'Bài 1: Ôn tập');
    assert.equal(result.questions.length, 1);
  });

  test('serialize(parse(x)) is stable for messy input', () => {
    const messy = 'Câu 1: Q?   A. x   ==B. y\n\n\nQ2?\n==z\nw';
    const once = serialize(parse(messy).questions);
    assert.equal(serialize(parse(once).questions), once);
  });
});
