// Answer page: asks before submitting with questions left blank, and prevents
// submitting twice. Without JavaScript the form still works.
export {}; // a module (loaded with type="module"), not a script sharing the page's globals

const form = document.getElementById('answer-form') as HTMLFormElement;
const status = document.getElementById('answer-status') as HTMLElement;
const questions = [...document.querySelectorAll<HTMLFieldSetElement>('[data-question]')];
let submitting = false;

function unanswered(): number {
  return questions.filter((question) => !question.querySelector('input[type="radio"]:checked')).length;
}

function updateStatus() {
  const left = unanswered();
  status.textContent = left ? `Còn ${left} câu chưa chọn đáp án.` : 'Đã chọn đáp án cho tất cả các câu.';
}

form.addEventListener('change', updateStatus);

form.addEventListener('submit', (event) => {
  const left = unanswered();
  if (submitting || (left > 0 && !confirm(`Còn ${left} câu chưa chọn đáp án, các câu đó sẽ bị tính là sai. Vẫn nộp bài?`))) {
    event.preventDefault();
    return;
  }
  submitting = true;
  (form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled = true;
});

// Leaving the page loses the answers: ask first once something is chosen.
window.addEventListener('beforeunload', (event) => {
  if (!submitting && unanswered() < questions.length) event.preventDefault();
});

updateStatus();
