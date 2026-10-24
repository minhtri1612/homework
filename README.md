# Bài tập trắc nghiệm

Website giao bài tập trắc nghiệm **một đáp án đúng** cho giáo viên và học sinh.

- Giáo viên tạo bộ bài tập, nhập câu hỏi bằng **cú pháp** (dán văn bản) hoặc **dạng thẻ**, rồi chia sẻ bằng link hoặc mã.
- Học sinh mở bài, nhập tên, chọn đáp án, nộp bài và được chấm điểm tự động theo thang 10.

> Dự án đang được xây dựng từng bước. Các phần chưa làm được đánh dấu _(sắp có)_.

## Công nghệ

| Thành phần | Lựa chọn |
|---|---|
| Máy chủ | Node.js 24 + Express _(sắp có)_ |
| Giao diện | Trang HTML dựng sẵn trên máy chủ (EJS) + một ít JavaScript thuần _(sắp có)_ |
| Cơ sở dữ liệu | SQLite qua `@libsql/client` — chạy máy cá nhân là một file, khi triển khai dùng Turso _(sắp có)_ |
| Kiểm thử | `node:test` có sẵn trong Node, không cần cài thêm |

## Cài đặt trên WSL (Ubuntu)

### 1. Cài Node.js bằng nvm (chỉ làm một lần)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

Đóng rồi mở lại cửa sổ terminal, sau đó:

```bash
nvm install --lts
node -v   # phải hiện v24.x trở lên
npm -v
```

### 2. Thư mục dự án

Dự án nằm ở `~/homework` (trong hệ thống file của Linux), **không** đặt ở `/mnt/c` hay `/mnt/d`:
trên ổ Windows, `npm install` và tính năng tự tải lại khi sửa file chạy chậm và hay lỗi.

```bash
cd ~/homework
nvm use          # dùng đúng phiên bản Node ghi trong file .nvmrc
```

Mở bằng VS Code trên Windows: cài tiện ích **WSL** cho VS Code, rồi trong terminal gõ `code .`

### 3. Các lệnh thường dùng

```bash
npm install      # cài thư viện (sắp có)
npm test         # chạy kiểm thử
npm run parse -- examples/mau.txt   # thử bộ đọc cú pháp với một file văn bản
npm run dev      # chạy website ở http://localhost:3000 (sắp có)
```

## Cú pháp nhập câu hỏi

Mỗi câu hỏi gồm **nội dung câu hỏi** và **2 đến 6 đáp án**, trong đó **đúng một** đáp án có dấu `==` ở đầu.

### Cách 1 — đáp án không có chữ cái

```
Con cua có mấy càng?
==2
3
4
5
```

Dòng đầu là câu hỏi, các dòng sau là đáp án. Với cách này câu hỏi chỉ được **một dòng**.

### Cách 2 — đáp án có chữ cái A. B. C.

```
Câu 2. Từ nào viết đúng chính tả?
A. sáng xủa
==B. sáng sủa
C. xáng sủa
```

- Chấp nhận `A.` `a)` `(A)` `A:`; dấu `==` đặt trước hoặc sau chữ cái đều được (`==B. sáng sủa` hoặc `B. ==sáng sủa`).
- Chữ cái A. B. sẽ được bỏ đi khi lưu (vì đáp án có thể được xáo trộn).
- Câu hỏi được viết **nhiều dòng**: mọi dòng trước đáp án `A.` đều thuộc câu hỏi.

### Cách 3 — gọn trên một dòng

```
1. A. cat   B. dog   ==C. pencil   D. parrot
5. Thủ đô của Việt Nam là: A. Huế  ==B. Hà Nội  C. Đà Nẵng
```

Cũng có thể để hai đáp án trên một dòng (`A. mèo     B. chó`, xuống dòng `==C. gà     D. vịt`).

### Tách các câu hỏi

Một câu hỏi mới bắt đầu khi gặp:

1. **Dòng trống**, hoặc
2. **Số thứ tự**: `1.` `1)` `Câu 1:` `Câu 1.` `Bài 1 -`, hoặc
3. Với cách 2: một dòng **không có chữ cái** sau các đáp án;
   với cách 1: một dòng **kết thúc bằng `?` hoặc `:`** sau ít nhất 2 đáp án.

Khuyên dùng: để một dòng trống giữa các câu cho chắc chắn.

### Báo lỗi

Không dòng nào bị bỏ qua một cách âm thầm. Câu có vấn đề vẫn hiện ra (thẻ màu đỏ) kèm số dòng và lý do;
phải sửa hết lỗi mới lưu được:

| Lỗi | Ví dụ |
|---|---|
| Chưa đánh dấu đáp án đúng | không có dòng nào bắt đầu bằng `==` |
| Nhiều hơn một đáp án đúng | hai dòng có `==` |
| Ít hơn 2 hoặc nhiều hơn 6 đáp án | |
| Đáp án bị trống | `==B.` mà không có chữ |
| Đáp án trùng nhau | `Hà Nội` và `hà nội` (không phân biệt hoa thường, khoảng trắng) |

Câu chỉ có đáp án mà không có nội dung (như ví dụ `1. A. cat ...`) chỉ là **lưu ý**, vẫn lưu được.

Văn bản dán từ Word, Mac hay Windows đều được chuẩn hoá (Unicode NFC, xuống dòng, dấu cách đặc biệt),
nên chữ tiếng Việt gõ trên máy nào cũng so sánh đúng.

## Cấu trúc thư mục

```
src/
  shared/
    parser.js  bộ đọc cú pháp — dùng chung cho trình duyệt và máy chủ
test/          kiểm thử (npm test)
scripts/       công cụ dòng lệnh (npm run parse)
examples/      văn bản mẫu
data/          file cơ sở dữ liệu khi chạy máy cá nhân (không đưa lên git)
```
