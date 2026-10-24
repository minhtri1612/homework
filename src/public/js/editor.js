// Homework editor: "Cú pháp" (syntax text) and "Dạng thẻ" (one card per
// question). The cards are the source of truth: switching to the syntax tab
// writes the cards out as text, switching back (or "Chuyển sang dạng thẻ")
// reads the text into cards. The same parser checks everything on the server.
import { parse, serialize, validateQuestion, MAX_ANSWERS } from '/shared/parser.js';

const LETTERS = 'ABCDEFGH';

const form = document.getElementById('editor');
const titleInput = document.getElementById('title');
const syntax = document.getElementById('syntax');
const syntaxStatus = document.getElementById('syntax-status');
const syntaxProblems = document.getElementById('syntax-problems');
const cardsList = document.getElementById('cards');
const cardsEmpty = document.getElementById('cards-empty');
const shuffleAll = document.getElementById('shuffle-all');
const shuffleAllLabel = document.getElementById('shuffle-all-label');
const titleNote = document.getElementById('title-note');
const saveStatus = document.getElementById('save-status');
const questionsJson = document.getElementById('questions-json');

// Each card: { text, answers: [{ text, correct }], shuffleAnswers, fresh }.
// "fresh" hides the errors of a card just added until the teacher types in it.
let cards = JSON.parse(document.getElementById('initial-questions').textContent);
let activeTab = null;
// The syntax text as last synced with the cards; if the teacher has not
// changed it since, switching tabs does not need to re-read it.
let syncedText = null;
let dirty = false;

/** Creates an element: h('button', { type: 'button', class: 'x' }, 'text', child…). */
function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    element.setAttribute(name, value === true ? '' : value);
  }
  element.append(...children);
  return element;
}

function letter(index) {
  return LETTERS[index] ?? String(index + 1);
}

function emptyCard() {
  return { text: '', answers: [{ text: '', correct: false }, { text: '', correct: false }], shuffleAnswers: false, fresh: true };
}

function problemsOf(card) {
  const { errors, warnings } = validateQuestion(card);
  return { errors: card.fresh ? [] : errors, warnings: card.fresh ? [] : warnings, blocking: errors.length > 0 };
}

function markDirty() {
  dirty = true;
  saveStatus.textContent = '';
}

// ---- Tabs -----------------------------------------------------------------

function showTab(name) {
  if (name === activeTab) return;
  if (name === 'form' && activeTab === 'syntax') readSyntax();
  if (name === 'syntax') {
    syncedText = serialize(cards.filter((card) => !isBlank(card)));
    syntax.value = syncedText;
    updateSyntaxStatus();
  }
  activeTab = name;
  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.classList.toggle('active', selected);
    document.getElementById(`tab-${tab.dataset.tab}`).hidden = !selected;
  }
  if (name === 'form') renderCards();
}

function isBlank(card) {
  return !card.text.trim() && card.answers.every((answer) => !answer.text.trim());
}

/**
 * Reads the syntax text into cards. No need to ask before replacing them: the
 * text was written from the cards when the teacher opened this tab.
 */
function readSyntax() {
  if (syntax.value === syncedText) return;
  const result = parse(syntax.value);
  cards = result.questions.map(({ text, answers }) => ({
    text,
    answers: answers.map(({ text: answerText, correct }) => ({ text: answerText, correct })),
    shuffleAnswers: false,
    fresh: false,
  }));
  syncedText = syntax.value;
  showTitleNote(result.title);
  markDirty();
}

function showTitleNote(title) {
  titleNote.replaceChildren();
  titleNote.hidden = true;
  if (!title || title === titleInput.value.trim()) return;
  if (!titleInput.value.trim()) {
    titleInput.value = title;
    titleNote.append('Đã lấy dòng đầu “', h('strong', {}, title), '” làm tiêu đề bài tập.');
  } else {
    const use = h('button', { type: 'button', class: 'link' }, 'Dùng làm tiêu đề');
    use.addEventListener('click', () => {
      titleInput.value = title;
      titleNote.hidden = true;
      markDirty();
    });
    titleNote.append('Dòng đầu “', h('strong', {}, title), '” khác tiêu đề hiện tại. ', use);
  }
  titleNote.hidden = false;
}

// ---- Syntax tab -------------------------------------------------------------

let statusTimer;
function updateSyntaxStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (!syntax.value.trim()) {
      syntaxStatus.textContent = '';
      syntaxProblems.replaceChildren();
      return;
    }
    const result = parse(syntax.value);
    const parts = [`${result.questions.length} câu hỏi`];
    if (result.title) parts.unshift(`Tiêu đề: ${result.title}`);
    parts.push(result.errors.length ? `${result.errors.length} lỗi` : 'không có lỗi');
    if (result.warnings.length) parts.push(`${result.warnings.length} lưu ý`);
    syntaxStatus.textContent = parts.join(' · ');
    syntaxProblems.replaceChildren(
      ...result.errors.map((error) => {
        const where = [error.line && `Dòng ${error.line}`, error.question && `câu ${error.question}`].filter(Boolean).join(', ');
        return h('li', { class: 'error' }, where ? `${where}: ${error.message}` : error.message);
      }),
      ...result.warnings.map((warning) => h('li', { class: 'warning' }, `Câu ${warning.question}: ${warning.message}`)),
    );
  }, 150);
}

// ---- Form tab ---------------------------------------------------------------

function renderCards() {
  cardsList.replaceChildren(...cards.map(renderCard));
  cardsEmpty.hidden = cards.length > 0;
  shuffleAllLabel.hidden = cards.length === 0;
  updateShuffleAll();
}

function renderCard(card, index) {
  const answers = h('ol', { class: 'answers' });
  card.answers.forEach((answer, j) => {
    answers.append(
      h(
        'li',
        { class: answer.correct ? 'answer correct' : 'answer' },
        h(
          'button',
          {
            type: 'button',
            class: 'letter',
            'data-action': 'mark',
            'data-answer': j,
            'aria-pressed': String(answer.correct),
            title: 'Bấm để chọn đây là đáp án đúng',
          },
          letter(j),
        ),
        h('input', {
          class: 'answer-text',
          'data-answer': j,
          value: answer.text,
          placeholder: `Đáp án ${letter(j)}`,
          'aria-label': `Câu ${index + 1}, đáp án ${letter(j)}`,
          maxlength: 500,
        }),
        h(
          'button',
          { type: 'button', class: 'icon', 'data-action': 'remove-answer', 'data-answer': j, 'aria-label': `Xoá đáp án ${letter(j)}`, title: 'Xoá đáp án' },
          '×',
        ),
      ),
    );
  });

  const element = h(
    'li',
    { class: 'card question', 'data-index': index },
    h(
      'div',
      { class: 'question-head' },
      h('strong', {}, `Câu ${index + 1}`),
      h(
        'span',
        { class: 'question-actions' },
        h('button', { type: 'button', class: 'small secondary', 'data-action': 'up', disabled: index === 0, 'aria-label': `Đưa câu ${index + 1} lên` }, '↑'),
        h('button', { type: 'button', class: 'small secondary', 'data-action': 'down', disabled: index === cards.length - 1, 'aria-label': `Đưa câu ${index + 1} xuống` }, '↓'),
        h('button', { type: 'button', class: 'small danger', 'data-action': 'delete' }, 'Xoá câu'),
      ),
    ),
    h('textarea', { class: 'question-text', rows: 2, placeholder: 'Nội dung câu hỏi', 'aria-label': `Nội dung câu ${index + 1}`, maxlength: 2000 }, card.text),
    answers,
    h(
      'div',
      { class: 'question-foot' },
      h('button', { type: 'button', class: 'small secondary', 'data-action': 'add-answer', disabled: card.answers.length >= MAX_ANSWERS }, '+ Thêm đáp án'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', class: 'shuffle-answers', checked: card.shuffleAnswers }), ' Xáo trộn đáp án'),
    ),
    h('ul', { class: 'problems' }),
  );
  updateProblems(element, card);
  return element;
}

function updateProblems(element, card) {
  const { errors, warnings } = problemsOf(card);
  element.classList.toggle('invalid', errors.length > 0);
  element.querySelector('.problems').replaceChildren(
    ...errors.map((error) => h('li', { class: 'error' }, error.message)),
    ...warnings.map((warning) => h('li', { class: 'warning' }, warning.message)),
  );
}

function updateShuffleAll() {
  const on = cards.filter((card) => card.shuffleAnswers).length;
  shuffleAll.checked = cards.length > 0 && on === cards.length;
  shuffleAll.indeterminate = on > 0 && on < cards.length;
}

/** Re-renders after a change of structure and puts the cursor back. */
function rerender(focusSelector) {
  renderCards();
  markDirty();
  if (focusSelector) cardsList.querySelector(focusSelector)?.focus();
}

cardsList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.closest('.question').dataset.index);
  const card = cards[index];
  const answer = Number(button.dataset.answer);
  card.fresh = false;

  switch (button.dataset.action) {
    case 'mark':
      card.answers.forEach((a, j) => (a.correct = j === answer));
      return rerender(`[data-index="${index}"] .letter[data-answer="${answer}"]`);
    case 'remove-answer':
      card.answers.splice(answer, 1);
      return rerender(`[data-index="${index}"] .answer-text[data-answer="${Math.max(0, answer - 1)}"]`);
    case 'add-answer':
      card.answers.push({ text: '', correct: false });
      return rerender(`[data-index="${index}"] .answer-text[data-answer="${card.answers.length - 1}"]`);
    case 'up':
    case 'down': {
      const target = button.dataset.action === 'up' ? index - 1 : index + 1;
      [cards[index], cards[target]] = [cards[target], cards[index]];
      return rerender(`[data-index="${target}"] [data-action="${button.dataset.action}"]`);
    }
    case 'delete':
      if (!isBlank(card) && !confirm(`Xoá câu ${index + 1}?`)) return;
      cards.splice(index, 1);
      return rerender(null);
  }
});

cardsList.addEventListener('input', (event) => {
  const element = event.target.closest('.question');
  if (!element) return;
  const card = cards[Number(element.dataset.index)];
  if (event.target.classList.contains('question-text')) card.text = event.target.value;
  else if (event.target.classList.contains('answer-text')) card.answers[Number(event.target.dataset.answer)].text = event.target.value;
  else return;
  card.fresh = false;
  updateProblems(element, card);
  markDirty();
});

cardsList.addEventListener('change', (event) => {
  if (!event.target.classList.contains('shuffle-answers')) return;
  cards[Number(event.target.closest('.question').dataset.index)].shuffleAnswers = event.target.checked;
  updateShuffleAll();
  markDirty();
});

shuffleAll.addEventListener('change', () => {
  for (const card of cards) card.shuffleAnswers = shuffleAll.checked;
  rerender(null);
});

document.getElementById('add-question').addEventListener('click', () => {
  cards.push(emptyCard());
  rerender(`[data-index="${cards.length - 1}"] .question-text`);
});

// ---- Save -------------------------------------------------------------------

form.addEventListener('submit', (event) => {
  if (activeTab === 'syntax') showTab('form');
  // Cards left completely empty are dropped instead of blocking the save.
  cards = cards.filter((card) => !isBlank(card));
  for (const card of cards) card.fresh = false;
  renderCards();

  const invalid = cards.filter((card) => problemsOf(card).blocking).length;
  if (cards.length === 0 || invalid > 0) {
    event.preventDefault();
    saveStatus.textContent = cards.length === 0 ? 'Chưa có câu hỏi nào.' : `Còn ${invalid} câu có lỗi (thẻ màu đỏ). Sửa xong mới lưu được.`;
    cardsList.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  questionsJson.value = JSON.stringify(cards.map(({ text, answers, shuffleAnswers }) => ({ text, answers, shuffleAnswers })));
  dirty = false;
});

// ---- Start --------------------------------------------------------------------

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}
document.getElementById('convert').addEventListener('click', () => showTab('form'));
syntax.addEventListener('input', () => {
  markDirty();
  updateSyntaxStatus();
});
for (const input of form.querySelectorAll('[name]')) input.addEventListener('input', markDirty);
window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

showTab(form.dataset.startTab);
