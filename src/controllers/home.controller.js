export function getHomePage(req, res) {
  res.render('home', { title: 'Bài tập trắc nghiệm', codeInput: '', codeError: null });
}
