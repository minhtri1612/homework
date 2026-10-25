// Answer page: asks before submitting with questions left blank, prevents
// submitting twice, keeps the chosen answers in this browser until the page is
// submitted (a reload or a phone reopening the tab does not lose them), and
// counts down the time limit, submitting by itself when time is up. Without
// JavaScript the form still works.
export {}; // a module (loaded with type="module"), not a script sharing the page's globals

const form = document.getElementById('answer-form') as HTMLFormElement;
const status = document.getElementById('answer-status') as HTMLElement;
const timer = document.getElementById('timer');
const questions = [...document.querySelectorAll<HTMLFieldSetElement>('[data-question]')];
const draftKey = `answers:${form.dataset.draftKey}`;
let submitting = false;

function unanswered(): number {
  return questions.filter((question) => !question.querySelector('input[type="radio"]:checked')).length;
}

function updateStatus() {
  const left = unanswered();
  status.textContent = left ? `Còn ${left} câu chưa chọn đáp án.` : 'Đã chọn đáp án cho tất cả các câu.';
}

// Storage can be missing or blocked (private window, school computer settings):
// then the page works as before, only without keeping answers over a reload.
function saveDraft() {
  const checked = [...form.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')].map((input) => [input.name, input.value]);
  try {
    localStorage.setItem(draftKey, JSON.stringify(checked));
  } catch {}
}

function restoreDraft() {
  let checked: unknown;
  try {
    checked = JSON.parse(localStorage.getItem(draftKey) ?? '[]');
  } catch {
    return;
  }
  if (!Array.isArray(checked)) return;
  for (const [name, value] of checked) {
    const input = form.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(String(name))}"][value="${CSS.escape(String(value))}"]`);
    if (input) input.checked = true;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(draftKey);
  } catch {}
}

function startSubmitting() {
  submitting = true;
  clearDraft();
  (form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled = true;
}

form.addEventListener('change', () => {
  saveDraft();
  updateStatus();
});

form.addEventListener('submit', (event) => {
  const left = unanswered();
  if (submitting || (left > 0 && !confirm(`Còn ${left} câu chưa chọn đáp án, các câu đó sẽ bị tính là sai. Vẫn nộp bài?`))) {
    event.preventDefault();
    return;
  }
  startSubmitting();
});

// Leaving the page loses the answers: ask first once something is chosen.
window.addEventListener('beforeunload', (event) => {
  if (!submitting && unanswered() < questions.length) event.preventDefault();
});

restoreDraft();
updateStatus();

/** 2405 → "40:05", 4805 → "1:20:05". */
function clock(seconds: number): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// The server sends the seconds left, not the end time, so a wrong clock on
// the student's device does not matter. The server checks the time again.
if (timer) {
  const endsAt = Date.now() + Number(timer.dataset.secondsLeft) * 1000;
  const tick = () => {
    if (submitting) return;
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    timer.textContent = `Còn ${clock(left)}`;
    timer.classList.toggle('low', left <= 5 * 60);
    if (left === 0) {
      clearInterval(interval);
      status.textContent = 'Hết giờ, đang nộp bài…';
      startSubmitting();
      form.submit(); // no "unanswered" question: time is up
    }
  };
  const interval = setInterval(tick, 1000);
  // A phone that slept or a background tab may skip ticks: check at once on return.
  document.addEventListener('visibilitychange', tick);
  tick();
}
