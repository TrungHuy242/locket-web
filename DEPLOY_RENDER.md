# Hướng dẫn Deploy Locket Web miễn phí lên Render (Docker) + Lưu dữ liệu bền vững

Do Hugging Face Spaces hiện đã chuyển **Docker SDK sang gói Paid** với tài khoản mới, giải pháp **miễn phí 100% không cần thẻ tín dụng** tốt nhất là:
- **Render Free (Docker Web Service, region Singapore)**: chạy web app + HTTPS chuẩn + WebSocket + Camera + cài PWA trực tiếp (không bị bọc trong iframe).
- **Private Hugging Face Dataset** *(vẫn miễn phí 100% trên tài khoản Hugging Face bạn vừa tạo)*: tự động lưu bền vững `sessions/` và `accounts/moments.json` có mã hóa để **không bị đăng xuất hay mất lịch sử** khi Render ngủ sau 15 phút.

---

## Bước 1: Lấy HF Token trên tài khoản Hugging Face

1. Vào https://huggingface.co/settings/tokens → **Create new token**.
2. Chọn quyền **Write** (để server tự tạo và đồng bộ vào Private Dataset), đặt tên `locket-web-sync` → copy token `hf_...`.

---

## Bước 2: Đẩy mã nguồn lên GitHub (nên để Private repo)

1. Tạo một repository **Private** mới trên https://github.com/new (ví dụ tên `locket-web`, để trống không tick thêm README/.gitignore).
2. Mở PowerShell tại thư mục dự án (`d:\TrungHuy\tools\LocketV2`) và chạy:

```powershell
# Bắt buộc xóa .git lồng bên trong vendor/locketlam để Git đẩy đủ code SDK lên GitHub
Remove-Item -Recurse -Force vendor\locketlam\.git -ErrorAction SilentlyContinue

git init
git branch -M main

# Kiểm tra chắc chắn KHÔNG có backend/data hay .env trong danh sách
git status

git add .
git commit -m "Initial deploy Locket Web"
git remote add origin https://github.com/<github-username>/locket-web.git
git push -u origin main
```

---

## Bước 3: Deploy miễn phí trên Render (không cần thẻ tín dụng)

1. Đăng ký / đăng nhập https://render.com bằng tài khoản **GitHub** (không cần nhập thẻ).
2. Chọn **New + → Blueprint** (hoặc **New + → Web Service** → chọn repo `locket-web` vừa tạo).
3. Nếu dùng **Blueprint**, Render sẽ tự đọc file `render.yaml` (Docker, gói **Free**, máy chủ **Singapore** cho tốc độ nhanh tại Việt Nam, health check `/api/health`) và hỏi bạn điền **3 biến bí mật**:

| Tên biến | Giá trị | Ý nghĩa |
| :--- | :--- | :--- |
| `HF_TOKEN` | `hf_xxxxxxxx...` (token bước 1) | Quyền đọc/ghi Private Dataset |
| `LOCKET_HF_REPO` | `<hf-username>/locket-data` | Tên Dataset riêng tư (server **tự tạo Private Dataset** nếu chưa có) |
| `LOCKET_BACKUP_KEY` | Chuỗi mật khẩu dài bất kỳ (20–30 ký tự) | Mã hóa AES+HMAC toàn bộ token & lịch sử trước khi sao lưu |

4. Bấm **Apply / Create Web Service** và đợi **3–5 phút** để Render build Docker image lần đầu.
5. Khi thấy trạng thái **Live** và dòng log `HF state sync ready (...)`, mở link **`https://<ten-service>.onrender.com`** trên điện thoại hoặc máy tính!

---

## Bước 4: Chống ngủ 24/7 miễn phí (cron-job.org)

Render Free tặng **750 giờ/tháng** (trong khi 1 tháng 31 ngày chỉ có **744 giờ** → đủ chạy 24/7 cho đúng 1 Web Service). Để server không bị đóng ngủ sau 15 phút và giữ ấm cache ảnh/RAM:

1. Đăng ký tài khoản miễn phí tại https://console.cron-job.org (không cần thẻ tín dụng).
2. Chọn **Create cronjob**:
   - **Title**: `Locket Web Keep-Alive`
   - **URL**: `https://<ten-service>.onrender.com/api/health`
   - **Execution schedule**: chọn **Every 10 minutes** (hoặc **Every 12 minutes**)
   - **Request method**: `GET` (mặc định)
3. Bấm **Create** → xong! Render sẽ nhận ping nhẹ `/api/health` (`{"ok":true}`) đều đặn, không còn cảnh chờ 30–50s cold-start nữa.

---

## Lưu ý khi dùng Render Free

- **Giới hạn 750 giờ/tháng**: nếu bạn chỉ chạy 1 Web Service này trên tài khoản Render, bật cron-job.org 24/7 vẫn nằm gọn trong hạn mức miễn phí (744h ≤ 750h). Nếu chạy 2 Web Service cùng lúc, nên giới hạn lịch ping chỉ chạy ban ngày (ví dụ 6h–24h).
- **RAM 512 MB**: `render.yaml` đã đặt sẵn `LOCKET_FFMPEG_THREADS=1` và stream upload video ra đĩa để hạn chế tốn RAM tối đa khi chuyển mã video. Nếu đăng video dung lượng quá nặng (ví dụ 4K dài từ thư viện), nên chọn clip gọn để tránh vượt 512 MB RAM.
- **Cập nhật code sau này**: chỉ cần `git add . && git commit -m "Update" && git push`, Render sẽ tự build và deploy bản mới.
