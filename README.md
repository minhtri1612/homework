# Bài tập trắc nghiệm

Website giao bài tập trắc nghiệm **một đáp án đúng** cho giáo viên và học sinh.

- Giáo viên tạo bộ bài tập, nhập câu hỏi bằng **cú pháp** (dán văn bản) hoặc **dạng thẻ**, rồi chia sẻ bằng link hoặc mã.
- Học sinh mở bài, nhập tên, chọn đáp án, nộp bài và được chấm điểm tự động theo thang 10.

> Dự án đang được xây dựng từng bước. Các phần chưa làm được đánh dấu _(sắp có)_.

## Công nghệ

| Thành phần | Lựa chọn |
|---|---|
| Máy chủ | Node.js 24 + Express 5 |
| Ngôn ngữ | TypeScript — Node 24 chạy thẳng file `.ts` (tự bỏ phần kiểu), `tsc` chỉ dùng để kiểm tra kiểu |
| Giao diện | Trang HTML dựng sẵn trên máy chủ (EJS) + một ít mã cho trình duyệt (TypeScript, dịch sang JavaScript bằng `tsc`) |
| Cơ sở dữ liệu | SQLite — chạy máy cá nhân là một file (`data/local.db`), khi triển khai dùng Turso; truy vấn qua Prisma |
| Kiểm tra dữ liệu form | Zod |
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
npm install      # cài thư viện (chạy lại mỗi khi package.json thay đổi)
npm test         # chạy kiểm thử (trước đó tự kiểm tra kiểu TypeScript và dịch mã trình duyệt)
npm run typecheck # chỉ kiểm tra kiểu TypeScript (tsc), không chạy gì
npm run build:browser # dịch mã trình duyệt (bộ đọc cú pháp, trang soạn bài) sang JavaScript trong dist/
npm run build    # chuẩn bị để triển khai: tạo mã Prisma và dịch mã trình duyệt
npm run parse -- examples/mau.txt   # thử bộ đọc cú pháp với một file văn bản
npm run db:init  # tạo/cập nhật các bảng (chạy các migration chưa chạy; chạy lại bao nhiêu lần cũng được)
npm run db:seed  # thêm dữ liệu mẫu: 1 giáo viên và 2 bộ bài tập
npm run db:reset # XOÁ HẾT dữ liệu rồi tạo lại bảng trống từ các migration (chỉ với file trên máy)
npm run db:migration -- <tên>  # sau khi sửa prisma/schema.prisma: tạo migration mới (xem mục bên dưới)
npm run db:generate            # tạo lại mã Prisma (npm install và npm test cũng tự làm)
npm run dev      # chạy website ở http://localhost:3000, tự khởi động lại khi sửa file (Ctrl+C để dừng)
npm start        # chạy website (không tự khởi động lại) — dùng khi triển khai
```

`npm run dev` tự khởi động lại khi sửa mã máy chủ. Mã chạy trên trình duyệt (`src/shared/parser.ts`,
`src/public/js/*.ts`) phải được dịch lại: sau khi sửa các file này, dừng (Ctrl+C) rồi chạy lại
`npm run dev`. `npm test` sẽ báo lỗi nếu trình duyệt đang nhận bản dịch cũ.

### 4. Cơ sở dữ liệu

Trên máy cá nhân không cần cài gì thêm: dữ liệu nằm trong file `data/local.db` (không đưa lên git).
Lần đầu chạy:

```bash
npm install
npm run db:seed    # tự tạo bảng nếu chưa có
```

Tài khoản mẫu: `giaovien@example.com`, mật khẩu `matkhau123`.

Sau đó chạy `npm run dev`, mở http://localhost:3000 trên trình duyệt (Windows mở được thẳng địa chỉ này)
và đăng nhập bằng tài khoản mẫu, hoặc bấm **Đăng ký** để tạo tài khoản mới.

Muốn thử trên điện thoại cùng mạng Wi-Fi thì phải đợi đến bước triển khai: WSL không tự mở cổng
ra mạng ngoài.

Muốn dùng cơ sở dữ liệu khác (ví dụ Turso khi triển khai), chép `.env.example` thành `.env` rồi điền
`DATABASE_URL` và `DATABASE_AUTH_TOKEN`. Để trống thì dùng file trên máy.

Muốn xem dữ liệu bằng mắt: cài tiện ích **SQLite Viewer** cho VS Code rồi mở file `data/local.db`.

Các bảng (chi tiết trong `prisma/schema.prisma` và `prisma/migrations/`):

| Bảng | Nội dung |
|---|---|
| `teachers` | giáo viên (email, tên, mật khẩu đã mã hoá) |
| `sessions` | phiên đăng nhập của giáo viên |
| `homeworks` | bộ bài tập: tiêu đề, mã chia sẻ, cài đặt hiện đáp án, hạn nộp, xáo câu hỏi |
| `homework_versions` | các phiên bản câu hỏi của một bộ bài tập |
| `questions` | câu hỏi (thuộc một phiên bản), có xáo đáp án hay không |
| `answers` | đáp án, đúng một đáp án đúng mỗi câu |
| `submissions` | bài nộp của học sinh: tên, điểm, số câu đúng |
| `submission_answers` | đáp án học sinh chọn cho từng câu (trống nếu bỏ qua) |

Vì sao có **phiên bản**: nếu giáo viên sửa câu hỏi sau khi đã có học sinh nộp bài, câu hỏi mới được lưu
thành phiên bản mới, còn bài đã nộp vẫn giữ đúng những câu học sinh đã làm.

#### Thay đổi các bảng (migration)

Mỗi lần thay đổi bảng được ghi thành một file SQL trong `prisma/migrations/`. Website tự chạy các file
chưa chạy mỗi khi khởi động (cả trên máy và trên Turso), nên không cần sửa cơ sở dữ liệu bằng tay.

1. Sửa `prisma/schema.prisma`.
2. Chạy `npm run db:migration -- ten_thay_doi` (chữ thường, không dấu, dùng `_`), ví dụ
   `npm run db:migration -- them_lop_hoc`. Lệnh này tạo file `migration.sql` mới nhưng chưa chạy nó.
3. **Đọc lại file đó.** Nếu lệnh báo "tạo lại bảng (RedefineTables)", Prisma đã bỏ mất các quy tắc viết tay
   của bảng đó (CHECK, COLLATE NOCASE, chỉ mục `answers_one_correct`): chép lại chúng từ migration đầu tiên
   (có ghi chú `hand-written`).
4. Chạy `npm run db:init` để áp dụng, rồi `npm test`.

Không sửa một migration đã chạy: website sẽ báo lỗi. Muốn thay đổi tiếp thì tạo migration mới.

## Tài khoản giáo viên

- Ai cũng đăng ký được tài khoản giáo viên bằng email và mật khẩu (ít nhất 8 ký tự).
  Mỗi giáo viên chỉ thấy bài tập của mình.
- Mật khẩu được mã hoá (scrypt) trước khi lưu; không ai đọc lại được mật khẩu gốc, kể cả người quản trị.
- Đăng nhập được giữ 30 ngày bằng cookie. Đăng xuất là phiên bị xoá luôn trên máy chủ.
- Học sinh không cần tài khoản: chỉ cần link hoặc mã bài tập (xem mục **Chia sẻ bài tập**).

## Soạn bài tập

Sau khi đăng nhập, bấm **+ Tạo bài tập mới**. Bấm vào tên một bài tập để sửa.

- **Thẻ “Cú pháp”**: dán văn bản câu hỏi (xem cú pháp ở mục dưới). Ngay bên dưới hiện số câu và các lỗi kèm số dòng.
  Bấm **Chuyển sang dạng thẻ** để xem từng câu thành một thẻ.
- **Thẻ “Dạng thẻ”**: mỗi câu một thẻ. Bấm vào chữ cái (A, B, C…) để chọn đáp án đúng; thêm/xoá đáp án
  (2 đến 6), đổi thứ tự, xoá câu, bật “Xáo trộn đáp án”. Câu có lỗi hiện **màu đỏ**; còn câu đỏ thì chưa lưu được.
- Chuyển qua lại giữa hai thẻ thoải mái: nội dung luôn được giữ, thẻ nào đang mở cũng lưu được.
- Cài đặt: khi nào học sinh được xem đáp án đúng (ngay sau khi nộp — mặc định / sau hạn nộp / không cho xem),
  hạn nộp theo **giờ Việt Nam**, và xáo trộn thứ tự câu hỏi.
- Máy chủ kiểm tra lại mọi thứ khi lưu, nên dù trình duyệt có lỗi cũng không lưu được bài tập sai.
- **Sửa bài tập đã có học sinh nộp**: nếu đổi câu hỏi, bài tập được lưu thành **phiên bản mới**; bài đã nộp vẫn
  giữ câu hỏi và điểm cũ. Chỉ đổi tiêu đề, hạn nộp hay cài đặt thì không tạo phiên bản mới.

Giới hạn: tối đa 200 câu, mỗi câu hỏi 2000 ký tự, mỗi đáp án 500 ký tự.

## Chia sẻ bài tập

Mỗi bài tập có một **mã 6 ký tự** (ví dụ `ABC234`), không dùng các ký tự dễ nhầm `0 O 1 I L`.

- Ở trang **Bài tập của tôi** và trang sửa bài tập có ô chứa link đầy đủ (`.../h/ABC234`), nút
  **Sao chép link** và liên kết **Xem trang học sinh**. Gửi link này qua Zalo, Messenger…
- Hoặc đọc / viết mã lên bảng: học sinh mở trang chủ, gõ mã vào ô **nhập mã bài tập** rồi bấm **Mở bài tập**.
  Gõ chữ thường, có dấu cách hay dấu gạch (`abc 234`, `ABC-234`) đều được; dán cả link vào ô cũng được.
- Trang của học sinh hiện tiêu đề, tên giáo viên, số câu hỏi và hạn nộp (giờ Việt Nam), hoặc báo
  **đã hết hạn nộp bài**. Trang này không chứa câu hỏi hay đáp án. Phần làm bài và nộp bài _(sắp có)_.
- Sửa bài tập không làm đổi mã hay link.

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

### Tiêu đề bài tập

Nếu **dòng đầu tiên** được theo sau bởi **một dòng trống**, dòng đó là **tiêu đề** của bộ bài tập, không phải câu hỏi:

```
BÀI TẬP TIẾNG VIỆT – LỚP 3

Câu 1: Con cua có mấy càng?
==2
3
```

(Dòng đáp án như `==2` hay `A. mèo` thì không bao giờ được coi là tiêu đề.)

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
    parser.ts     bộ đọc cú pháp — dùng chung cho trình duyệt (sau khi dịch) và máy chủ
  config/
    client.ts     kết nối tới cơ sở dữ liệu (file trên máy hoặc Turso), qua Prisma hoặc trực tiếp
    migrate.ts    tạo/cập nhật các bảng bằng các file trong prisma/migrations/
  routes/
    web.ts        danh sách mọi trang: địa chỉ → kiểm tra đăng nhập → controller
    status.ts     trang "không tìm thấy" (404) và trang lỗi (500)
  middleware/
    auth.ts       đọc cookie đăng nhập, chặn trang cần đăng nhập
    same-origin.ts chặn form gửi từ trang web khác
  controllers/    đọc yêu cầu, gọi kiểm tra dữ liệu và services, trả về trang
    home.controller.ts     trang chủ
    auth.controller.ts     đăng ký, đăng nhập, đăng xuất
    homework.controller.ts trang của giáo viên: danh sách và soạn bài tập
    share.controller.ts    trang của học sinh: mở bài tập bằng mã (/h/MÃ, ô nhập mã)
  validation/     kiểm tra và làm sạch dữ liệu từ form (Zod), thông báo lỗi tiếng Việt
  services/
    teacher.service.ts    lưu giáo viên
    homework.service.ts   lưu và đọc bộ bài tập (kiểm tra lại câu hỏi trước khi lưu)
    session.service.ts    phiên đăng nhập
    share-code.service.ts tạo và đọc mã chia sẻ
    password.service.ts   mã hoá và kiểm tra mật khẩu
  generated/      mã Prisma tự sinh (npm run db:generate, không đưa lên git)
  views/          giao diện (EJS); partials/ là phần đầu và cuối dùng chung
  public/         CSS và mã chạy trên trình duyệt
    js/editor.ts  trang soạn bài tập (hai thẻ Cú pháp / Dạng thẻ)
    js/copy.ts    nút “Sao chép link”
  types/          khai báo kiểu thêm cho Express (req.teacher, req.prisma…)
  app.ts          ghép các phần thành website
  server.ts       khởi động website (npm run dev)
  load-env.ts     đọc file .env nếu có
  grading.ts      tính điểm thang 10 (làm tròn đến 0,25)
  vietnam-time.ts đổi giờ Việt Nam ↔ giờ UTC lưu trong cơ sở dữ liệu
prisma/           các bảng của cơ sở dữ liệu (schema.prisma) và các migration
prisma.config.js  cài đặt cho lệnh prisma (website không dùng file này)
test/             kiểm thử (npm test)
scripts/          công cụ dòng lệnh (npm run parse, db:init, db:seed, db:reset, db:migration)
examples/         văn bản mẫu
data/             file cơ sở dữ liệu khi chạy máy cá nhân (không đưa lên git)
dist/             mã JavaScript cho trình duyệt do npm run build:browser tạo ra (không đưa lên git)
tsconfig.json     cài đặt kiểm tra kiểu TypeScript cho máy chủ, script và kiểm thử
tsconfig.browser.json cài đặt dịch mã trình duyệt
```
