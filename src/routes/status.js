// The last handlers: a page that does not exist, and errors.

export function notFound(req, res) {
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang này không tồn tại.' });
}

// Express 5 sends errors thrown in async controllers here.
export function serverError(error, req, res, next) {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).render('error', { title: 'Có lỗi', message: 'Máy chủ gặp lỗi. Hãy thử lại sau ít phút.' });
}
