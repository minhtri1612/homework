// "Sao chép link" buttons: copy the link in the box next to the button. The
// buttons stay hidden without JavaScript; the box can still be selected by hand.
const LABEL = 'Sao chép link';

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  const input = button.parentElement!.querySelector('input')!;
  button.hidden = false;
  input.addEventListener('focus', () => input.select());
  button.addEventListener('click', async () => {
    input.select();
    try {
      // Not available on plain http pages other than localhost.
      await navigator.clipboard.writeText(input.value);
      button.textContent = 'Đã sao chép';
    } catch {
      button.textContent = 'Đã chọn link, hãy sao chép';
    }
    setTimeout(() => (button.textContent = LABEL), 2500);
  });
}
