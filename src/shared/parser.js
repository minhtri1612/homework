// Parser for the "syntax" question format. Plain ES module with no
// dependencies, so the same file runs in the browser (live preview) and in
// Node (validation before saving).

export const MIN_ANSWERS = 2;
export const MAX_ANSWERS = 6;

// Letters recognised as answer prefixes. G and H are accepted so that a 7th or
// 8th answer is reported as "too many answers" instead of being misread.
const LETTERS = 'ABCDEFGH';

const NUMBERED = /^(\d{1,3})[.)](?:\s+(.*))?$/u;
const NUMBERED_WORD = /^(?:câu|cau|bài|bai)\s*(\d{1,3})\s*(?:[.:)\-–]\s*(.*))?$/iu;
const LETTER_PREFIX = /^(?:\(([A-Ha-h])\)|([A-Ha-h])\s*[.):])\s*/u;
const INLINE_MARKER = /(^|\s)(==\s*)?(?:\(([A-Ha-h])\)|([A-Ha-h])[.):])/gu;
const CORRECT_MARK = /^==\s*/u;

const SYNTAX_HINTS = {
  NO_CORRECT: 'Thêm == vào đầu đáp án đúng.',
  MULTIPLE_CORRECT: 'Chỉ giữ == ở một đáp án.',
};

/**
 * Normalises pasted text without changing its line count, so line numbers in
 * error messages still match what the teacher sees.
 */
export function normalizeText(input) {
  return String(input ?? '')
    .normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, '')
    .replace(/[\t\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\uFF1D/g, '=');
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function letterAt(index) {
  return LETTERS[index] ?? String(index + 1);
}

/** Returns the text after "1." / "Câu 1:" (possibly ''), or null if not numbered. */
function matchNumbering(line) {
  const match = line.match(NUMBERED_WORD) ?? line.match(NUMBERED);
  return match ? (match[2] ?? '') : null;
}

/** Splits "==B. text" / "B. ==text" / "==text" / "text" into its parts. */
function parseAnswerLine(line) {
  let rest = line;
  let correct = false;
  let letter = null;

  if (CORRECT_MARK.test(rest)) {
    correct = true;
    rest = rest.replace(CORRECT_MARK, '');
  }
  const prefix = rest.match(LETTER_PREFIX);
  if (prefix) {
    letter = (prefix[1] ?? prefix[2]).toUpperCase();
    rest = rest.slice(prefix[0].length);
    if (!correct && CORRECT_MARK.test(rest)) {
      correct = true;
      rest = rest.replace(CORRECT_MARK, '');
    }
  }
  return { letter, correct, text: collapse(rest) };
}

/**
 * Finds several answers written on one line, e.g.
 * "Câu hỏi? A. cat   B. dog   ==C. pencil   D. parrot".
 * Markers must form a run of consecutive letters starting at A (or at any
 * letter if it begins the line, for "C. x   D. y" continuation lines).
 * Returns null when the line holds fewer than two answers.
 */
function findInlineAnswers(line) {
  const markers = [];
  for (const match of line.matchAll(INLINE_MARKER)) {
    markers.push({
      start: match.index + match[1].length,
      end: match.index + match[0].length,
      letter: (match[3] ?? match[4]).toUpperCase(),
      correct: Boolean(match[2]),
    });
  }

  // Longest run wins; on a tie the later one, so "vitamin A." in the
  // question text does not swallow the real answers.
  let best = null;
  let run = null;
  for (const marker of markers) {
    const index = LETTERS.indexOf(marker.letter);
    if (index === 0 || marker.start === 0) {
      run = [marker];
    } else if (run && index === LETTERS.indexOf(run.at(-1).letter) + 1) {
      run.push(marker);
    } else {
      continue;
    }
    if (run.length >= 2 && (!best || run.length >= best.length)) best = run;
  }
  if (!best) return null;

  const answers = best.map((marker, i) => {
    const next = best[i + 1];
    let text = line.slice(marker.end, next ? next.start : line.length).trim();
    let correct = marker.correct;
    if (CORRECT_MARK.test(text)) {
      correct = true;
      text = text.replace(CORRECT_MARK, '');
    }
    return { letter: marker.letter, correct, text: collapse(text) };
  });
  return { prefix: collapse(line.slice(0, best[0].start)), answers };
}

/**
 * Checks one question (from the parser or from a form card).
 * Question shape: { text, answers: [{ text, correct }], line? }.
 */
export function validateQuestion(question) {
  const errors = [];
  const warnings = [];
  const answers = question.answers ?? [];
  const add = (list, code, message, line = question.line) => {
    list.push({ code, message, ...(line !== undefined && { line }) });
  };

  if (!question.text?.trim()) {
    add(warnings, 'EMPTY_QUESTION', 'Câu hỏi chưa có nội dung, chỉ có đáp án.');
  }

  if (answers.length === 0) {
    add(errors, 'NO_ANSWERS', 'Chưa có đáp án nào.');
  } else if (answers.length < MIN_ANSWERS) {
    add(errors, 'TOO_FEW_ANSWERS', `Cần ít nhất ${MIN_ANSWERS} đáp án (hiện có ${answers.length}).`);
  } else if (answers.length > MAX_ANSWERS) {
    add(errors, 'TOO_MANY_ANSWERS', `Tối đa ${MAX_ANSWERS} đáp án (hiện có ${answers.length}).`);
  }

  const correctLetters = answers.flatMap((answer, i) => (answer.correct ? [letterAt(i)] : []));
  if (answers.length > 0 && correctLetters.length === 0) {
    add(errors, 'NO_CORRECT', 'Chưa đánh dấu đáp án đúng.');
  } else if (correctLetters.length > 1) {
    add(
      errors,
      'MULTIPLE_CORRECT',
      `Có ${correctLetters.length} đáp án được đánh dấu đúng (${correctLetters.join(', ')}). Chỉ được có một.`,
    );
  }

  const seen = new Map();
  answers.forEach((answer, i) => {
    const text = collapse(String(answer.text ?? '').normalize('NFC'));
    if (!text) {
      add(errors, 'EMPTY_ANSWER', `Đáp án ${letterAt(i)} bị trống.`, answer.line ?? question.line);
      return;
    }
    const key = text.toLocaleLowerCase('vi');
    if (seen.has(key)) {
      add(
        errors,
        'DUPLICATE_ANSWER',
        `Đáp án ${letterAt(i)} trùng với đáp án ${letterAt(seen.get(key))}.`,
        answer.line ?? question.line,
      );
    } else {
      seen.set(key, i);
    }
  });

  return { errors, warnings };
}

/**
 * The first non-empty line is the homework title when a blank line follows it
 * and it is not an answer line. Returns { text, index } or null.
 */
function findTitle(lines) {
  const index = lines.findIndex((raw) => collapse(raw) !== '');
  if (index === -1 || index + 1 >= lines.length || collapse(lines[index + 1]) !== '') return null;
  const text = collapse(lines[index]);
  const answer = parseAnswerLine(text);
  if (answer.letter !== null || answer.correct || findInlineAnswers(text)) return null;
  return { text, index };
}

/**
 * Parses syntax-mode text into questions.
 *
 * Returns { title, questions, errors, warnings }. title is the first line when
 * a blank line follows it (see findTitle), otherwise null. Every other
 * non-empty line ends up in some question: nothing is dropped silently. Each
 * question carries its own errors/warnings (for red cards); the top-level
 * lists repeat them with the question number added, plus EMPTY_INPUT when
 * there are no questions at all.
 */
export function parse(input) {
  const lines = normalizeText(input).split('\n');
  const title = findTitle(lines);
  if (title) lines[title.index] = '';
  const blocks = [];
  let block = null;

  // mode: null = no answer marker seen yet, 'lettered' = answers use A. B. …,
  // 'plain' = answers have no letters (the correct one only has ==).
  const close = () => {
    if (block) blocks.push(block);
    block = null;
  };
  const open = (line) => {
    close();
    block = { line, head: [], answers: [], mode: null };
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    let text = collapse(raw);
    if (!text) {
      close();
      return;
    }

    const numbered = matchNumbering(text);
    if (numbered !== null) {
      open(line);
      text = numbered;
      if (!text) return;
    }

    const inline = findInlineAnswers(text);
    if (inline) {
      const startsNewQuestion =
        block?.answers.length > 0 && (inline.prefix !== '' || inline.answers[0].letter === 'A');
      if (!block || startsNewQuestion) open(line);
      if (inline.prefix) block.head.push({ text: inline.prefix, line });
      block.mode ??= 'lettered';
      block.answers.push(...inline.answers.map((answer) => ({ ...answer, line })));
      return;
    }

    const answer = { ...parseAnswerLine(text), line };
    const isAnswer = answer.letter !== null || answer.correct;

    if (!block) {
      open(line);
    }

    if (block.answers.length === 0) {
      if (!isAnswer) {
        block.head.push({ text, line });
        return;
      }
      if (answer.letter) {
        block.mode = 'lettered';
      } else {
        // Plain format: only the first line is the question, the lines
        // between it and the == answer are answers too.
        block.mode = 'plain';
        block.answers = block.head.splice(1).map((h) => ({ letter: null, correct: false, ...h }));
      }
      block.answers.push(answer);
      return;
    }

    if (block.mode === 'lettered') {
      if (!isAnswer || answer.letter === 'A') {
        // A line without a letter, or a second "A.", starts the next question.
        open(line);
        if (!isAnswer) {
          block.head.push({ text, line });
          return;
        }
        block.mode = 'lettered';
      }
      block.answers.push(answer);
      return;
    }

    // Plain mode: a line ending in "?" or ":" after enough answers is
    // taken as the next question even without a blank line.
    if (!isAnswer && /[?:]$/u.test(text) && block.answers.length >= MIN_ANSWERS) {
      open(line);
      block.head.push({ text, line });
      return;
    }
    block.answers.push(answer);
  });
  close();

  const questions = blocks.map((b) => {
    let head = b.head;
    let answers = b.answers;
    if (b.mode === null && head.length > 1) {
      answers = head.slice(1).map((h) => ({ correct: false, ...h }));
      head = head.slice(0, 1);
    }
    const question = {
      text: head.map((h) => h.text).join('\n'),
      answers: answers.map(({ text, correct, line }) => ({ text, correct, line })),
      line: b.line,
    };
    const { errors, warnings } = validateQuestion(question);
    for (const error of errors) {
      if (SYNTAX_HINTS[error.code]) error.message += ` ${SYNTAX_HINTS[error.code]}`;
    }
    return { ...question, errors, warnings };
  });

  const flatten = (key) =>
    questions.flatMap((q, i) => q[key].map((item) => ({ ...item, question: i + 1 })));
  const errors = flatten('errors');
  if (questions.length === 0) {
    errors.push({ code: 'EMPTY_INPUT', message: 'Chưa có câu hỏi nào.' });
  }

  return { title: title?.text ?? null, questions, errors, warnings: flatten('warnings') };
}

/**
 * Turns questions (e.g. form cards) back into syntax text that parse() reads
 * back. An optional title goes on the first line, followed by a blank line.
 */
export function serialize(questions, title = '') {
  const heading = collapse(String(title ?? ''));
  const body = questions
    .map((question, i) => {
      const [first = '', ...rest] = String(question.text ?? '').split('\n');
      const lines = [collapse(`${i + 1}. ${first}`), ...rest.map(collapse).filter(Boolean)];
      question.answers.forEach((answer, j) => {
        lines.push(`${answer.correct ? '==' : ''}${letterAt(j)}. ${collapse(String(answer.text ?? ''))}`);
      });
      return lines.join('\n');
    })
    .join('\n\n');
  return heading ? `${heading}\n\n${body}` : body;
}
