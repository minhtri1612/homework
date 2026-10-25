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
npm run smoke    # kiểm tra cơ sở dữ liệu Turso ghi trong .env (chạy thử một vòng rồi tự dọn dữ liệu)
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
| `homeworks` | bộ bài tập: tiêu đề, mã chia sẻ, cài đặt hiện đáp án, hạn nộp, xáo câu hỏi, thời gian làm bài |
| `homework_versions` | các phiên bản câu hỏi của một bộ bài tập |
| `questions` | câu hỏi (thuộc một phiên bản), có xáo đáp án hay không |
| `answers` | đáp án, đúng một đáp án đúng mỗi câu |
| `submissions` | bài nộp của học sinh: tên, điểm, số câu đúng |
| `submission_answers` | đáp án học sinh chọn cho từng câu (trống nếu bỏ qua) |
| `attempts` | giờ học sinh bấm “Bắt đầu làm bài”, số lần và thời gian rời trang (chỉ với bài có thời gian làm bài) |

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
  hạn nộp theo **giờ Việt Nam**, xáo trộn thứ tự câu hỏi, và **thời gian làm bài** (số phút từ 1 đến 600,
  để trống nếu không giới hạn).
- Máy chủ kiểm tra lại mọi thứ khi lưu, nên dù trình duyệt có lỗi cũng không lưu được bài tập sai.
- **Sửa bài tập đã có học sinh nộp**: nếu đổi câu hỏi, bài tập được lưu thành **phiên bản mới**; bài đã nộp vẫn
  giữ câu hỏi và điểm cũ. Chỉ đổi tiêu đề, hạn nộp hay cài đặt thì không tạo phiên bản mới.

Giới hạn: tối đa 200 câu, mỗi câu hỏi 2000 ký tự, mỗi đáp án 500 ký tự.

## Xem kết quả

Bấm **kết quả** cạnh bài tập ở trang **Bài tập của tôi** (hoặc **Xem kết quả** ở trang sửa bài).

- Bảng bài nộp: họ tên, điểm, số câu đúng, giờ nộp (cũ nhất trước), cùng số bài nộp và điểm trung bình.
- **Từng câu hỏi**: bao nhiêu học sinh làm đúng (câu dưới 50% hiện màu đỏ), mỗi đáp án được bao nhiêu
  em chọn, bao nhiêu em bỏ trống.
- Bài tập có nhiều **phiên bản**: chọn **Tất cả** hoặc một phiên bản. Thống kê từng câu chỉ hiện khi
  chọn một phiên bản, vì các phiên bản có câu hỏi khác nhau.
- **Tải bảng điểm (CSV)**: mở được bằng Google Sheets hoặc Excel (dấu phẩy ngăn cột, điểm viết `7.25`,
  giờ Việt Nam). Nếu Excel cài tiếng Việt hiện tất cả trong một cột, hãy mở bằng
  *Data → From Text/CSV* và chọn dấu phẩy. Tên bắt đầu bằng `=`, `+`, `-`, `@` được thêm dấu `'` ở đầu
  để bảng tính không chạy nó như công thức.
- **Xoá bài nộp** (nút *Xoá* ở mỗi dòng, có trang xác nhận): ví dụ học sinh gõ sai tên hoặc được làm lại.
  Sau khi xoá, tên đó nộp lại được.
- **Rời trang** (chỉ với bài có thời gian làm bài): mỗi lần học sinh chuyển sang tab, ứng dụng hoặc cửa sổ
  khác trong lúc làm bài, trang báo về máy chủ ngay. Bảng bài nộp có thêm cột **Rời trang**, ví dụ
  “⚠ Rời trang 4 lần, tổng 3 phút 20 giây”; file CSV có thêm hai cột *Rời trang (lần)* và
  *Thời gian rời trang (giây)*. Học sinh được báo trước ở trang bắt đầu, và thấy dòng nhắc mỗi khi quay lại.
  Đây là **dấu hiệu để để ý, không phải bằng chứng**: cuộc gọi đến, màn hình tự khoá hay tải lại trang
  cũng được tính, còn tra cứu trên một máy khác hoặc chia đôi màn hình thì không phát hiện được.
- **Đã bắt đầu nhưng chưa nộp**: học sinh đã bấm *Bắt đầu làm bài* mà chưa nộp, với trạng thái
  (*đang làm, còn N phút* / *hết giờ, chưa nộp*) và số lần rời trang. Nút **Cho làm lại** (có trang xác
  nhận) xoá giờ bắt đầu của em đó để em bắt đầu lại với đồng hồ mới.

## Xoá bài tập

Ở cuối trang sửa bài tập có **Xoá bài tập này…**. Trang xác nhận cho biết số phiên bản và số bài nộp;
nếu đã có bài nộp thì phải đánh dấu ô *“Tôi hiểu rằng … bài nộp của học sinh cũng bị xoá”*. Xoá là
**vĩnh viễn**: câu hỏi, các phiên bản và bài nộp đều mất, link và mã bài tập ngừng hoạt động.

## Chia sẻ bài tập

Mỗi bài tập có một **mã 6 ký tự** (ví dụ `ABC234`), không dùng các ký tự dễ nhầm `0 O 1 I L`.

- Ở trang **Bài tập của tôi** và trang sửa bài tập có ô chứa link đầy đủ (`.../h/ABC234`), nút
  **Sao chép link** và liên kết **Xem trang học sinh**. Gửi link này qua Zalo, Messenger…
- Hoặc đọc / viết mã lên bảng: học sinh mở trang chủ, gõ mã vào ô **nhập mã bài tập** rồi bấm **Mở bài tập**.
  Gõ chữ thường, có dấu cách hay dấu gạch (`abc 234`, `ABC-234`) đều được; dán cả link vào ô cũng được.
- Trang của học sinh hiện tiêu đề, tên giáo viên, số câu hỏi và hạn nộp (giờ Việt Nam), hoặc báo
  **đã hết hạn nộp bài**.
- Sửa bài tập không làm đổi mã hay link.

## Học sinh làm bài

1. Mở link (hoặc nhập mã), gõ **họ và tên**, bấm **Bắt đầu làm bài**. Học sinh không cần tài khoản.
2. Chọn một đáp án cho mỗi câu rồi bấm **Nộp bài**. Câu bỏ trống bị tính là sai; trang sẽ hỏi lại nếu
   còn câu chưa chọn. Trang làm bài không chứa đáp án đúng.
3. Máy chủ chấm điểm theo thang 10, làm tròn đến 0,25 điểm gần nhất (ví dụ 7,1 → 7; 7,13 → 7,25).
4. Trang **kết quả** có một link riêng: học sinh lưu lại để xem sau. Trên cùng máy đó, mở lại link bài tập
   cũng thấy “… đã nộp bài. Xem kết quả”, và học sinh khác vẫn làm bài được (máy dùng chung ở trường).

Quy tắc:

- **Mỗi tên chỉ nộp một lần** (không phân biệt chữ hoa chữ thường và dấu cách thừa). Hai bạn trùng tên
  thì ghi thêm họ hoặc tên lớp.
- **Hết hạn nộp** thì không làm bài được nữa. Bài gửi tới máy chủ trễ quá 1 phút sau hạn không được ghi nhận
  (1 phút để bù mạng chậm).
- **Thời gian làm bài** (nếu giáo viên đặt, ví dụ 40 phút): đồng hồ bắt đầu khi học sinh bấm
  **Bắt đầu làm bài**, máy chủ ghi lại giờ bắt đầu. Tải lại trang, đổi máy hay bấm bắt đầu lại đều đếm tiếp,
  không quay về từ đầu. Trang làm bài đếm ngược (chữ đỏ khi còn 5 phút) và **tự nộp bài khi hết giờ**,
  với những câu đã chọn. Bài tới máy chủ trễ quá 1 phút sau khi hết giờ thì không được ghi nhận. Nếu hạn nộp
  tới trước, đồng hồ dừng ở hạn nộp. Đáp án đã chọn được giữ trong trình duyệt nên tải lại trang không mất.
  Xoá bài nộp của một học sinh thì học sinh đó làm lại được, với đồng hồ mới.
- **Xáo trộn**: nếu giáo viên bật, mỗi học sinh thấy thứ tự câu hỏi / đáp án khác nhau, và tải lại trang
  vẫn giữ nguyên thứ tự của mình.
- **Xem đáp án** theo cài đặt của bài: *ngay sau khi nộp* (mỗi câu hiện đáp án em chọn và đáp án đúng),
  *sau hạn nộp* (trước hạn chỉ thấy điểm), hoặc *không cho xem* (chỉ thấy điểm).
- Nếu giáo viên sửa câu hỏi đúng lúc học sinh đang làm bài (khi chưa ai nộp), bài làm đó không chấm được
  và trang sẽ báo học sinh làm lại.

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

## Triển khai (Render + Turso)

Website chạy trên **Render** (gói miễn phí), dữ liệu nằm ở **Turso** (gói miễn phí). Không cần thẻ tín dụng.

- **Turso**: cơ sở dữ liệu `homework`. Địa chỉ `libsql://…` và token lấy bằng lệnh `turso` trong WSL
  (`turso db show homework --url`, `turso db tokens create homework`). **Không bao giờ** dán token vào
  chat, commit hay ảnh chụp màn hình.
- **Render**: Web Service `homework-minhtri`, vùng Singapore, gói Free.
  - Build Command: `npm ci --include=dev && npm run build`
  - Start Command: `node src/server.ts`
  - Health Check Path: `/healthz`
  - Biến môi trường: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `INVITE_CODE`.
- **Mã mời** (`INVITE_CODE`, ít nhất 12 ký tự): ai đăng ký tài khoản giáo viên cũng phải nhập đúng mã này.
  Gửi mã riêng cho từng giáo viên được mời. Đổi mã: sửa biến trên Render (website tự khởi động lại).
- Thiếu một cài đặt nào thì website **không khởi động** và nhật ký (Logs) trên Render ghi rõ thiếu gì.
- Mỗi lần đẩy code lên nhánh `main` trên GitHub, Render tự triển khai bản mới.
- Gói miễn phí **ngủ sau 15 phút** không ai vào; lần mở đầu tiên sau đó chờ khoảng 1 phút. Trước giờ học
  hãy mở trang trước một chút.
- Sao lưu: Turso giữ lịch sử 1 ngày để khôi phục. Sau mỗi bài tập nên tải bảng điểm CSV về máy.
- Trước khi triển khai lần đầu (hoặc khi đổi cơ sở dữ liệu), ghi địa chỉ và token của một cơ sở dữ liệu
  **thử** vào `.env` rồi chạy `npm run smoke`.

## Cấu trúc thư mục

```
src/
  shared/
    parser.ts     bộ đọc cú pháp — dùng chung cho trình duyệt (sau khi dịch) và máy chủ
  config/
    client.ts     kết nối tới cơ sở dữ liệu (file trên máy hoặc Turso), qua Prisma hoặc trực tiếp
    migrate.ts    tạo/cập nhật các bảng bằng các file trong prisma/migrations/
    production.ts kiểm tra cài đặt bắt buộc khi chạy trên Render
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
    results.controller.ts  trang kết quả, tải CSV, xoá bài nộp và bài tập
    share.controller.ts    trang của học sinh: mở bài bằng mã, làm bài, nộp bài, kết quả
  validation/     kiểm tra và làm sạch dữ liệu từ form (Zod), thông báo lỗi tiếng Việt
  services/
    teacher.service.ts    lưu giáo viên
    homework.service.ts   lưu và đọc bộ bài tập (kiểm tra lại câu hỏi trước khi lưu)
    session.service.ts    phiên đăng nhập
    share-code.service.ts tạo và đọc mã chia sẻ
    results.service.ts    kết quả cho giáo viên, thống kê, file CSV, xoá
    submission.service.ts học sinh làm bài, chấm điểm, trang kết quả
    shuffle.service.ts    xáo trộn cố định theo từng học sinh
    password.service.ts   mã hoá và kiểm tra mật khẩu
  generated/      mã Prisma tự sinh (npm run db:generate, không đưa lên git)
  views/          giao diện (EJS); partials/ là phần đầu và cuối dùng chung
  public/         CSS và mã chạy trên trình duyệt
    js/editor.ts  trang soạn bài tập (hai thẻ Cú pháp / Dạng thẻ)
    js/copy.ts    nút “Sao chép link”
    js/answer.ts  trang làm bài (hỏi lại khi còn câu bỏ trống)
  types/          khai báo kiểu thêm cho Express (req.teacher, req.prisma…)
  app.ts          ghép các phần thành website
  server.ts       khởi động website (npm run dev)
  load-env.ts     đọc file .env nếu có
  grading.ts      tính điểm thang 10 (làm tròn đến 0,25)
  vietnam-time.ts đổi giờ Việt Nam ↔ giờ UTC lưu trong cơ sở dữ liệu
prisma/           các bảng của cơ sở dữ liệu (schema.prisma) và các migration
prisma.config.js  cài đặt cho lệnh prisma (website không dùng file này)
test/             kiểm thử (npm test)
scripts/          công cụ dòng lệnh (npm run parse, db:init, db:seed, db:reset, db:migration, smoke)
examples/         văn bản mẫu
data/             file cơ sở dữ liệu khi chạy máy cá nhân (không đưa lên git)
dist/             mã JavaScript cho trình duyệt do npm run build:browser tạo ra (không đưa lên git)
tsconfig.json     cài đặt kiểm tra kiểu TypeScript cho máy chủ, script và kiểm thử
tsconfig.browser.json cài đặt dịch mã trình duyệt
```
