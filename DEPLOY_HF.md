# Hướng dẫn Deploy Locket Web miễn phí lên Hugging Face Spaces

Triển khai bằng **Docker Space (CPU Basic miễn phí: 2 vCPU, 16 GB RAM, không cần thẻ tín dụng)** kết hợp **Private Hugging Face Dataset** để lưu bền vững phiên đăng nhập (`sessions/`) và lịch sử khoảnh khắc (`accounts/`), không bị đăng xuất hay mất lịch sử khi Space ngủ hoặc build lại.

---

## Bước 1: Tạo tài khoản & Access Token trên Hugging Face

1. Đăng ký tài khoản miễn phí tại https://huggingface.co/join (không cần thẻ thanh toán).
2. Vào **Settings → Access Tokens**: https://huggingface.co/settings/tokens
3. Bấm **Create new token**:
   - Chọn **Token type**: `Write` (hoặc `Fine-grained` có quyền Read + Write vào repo Dataset của bạn).
   - Đặt tên ví dụ `locket-web-sync` → bấm **Create token**.
   - **Copy và lưu tạm token** dạng `hf_...` (chỉ hiện 1 lần).

---

## Bước 2: Tạo Docker Space

1. Vào https://huggingface.co/new-space
2. Điền thông tin:
   - **Space name**: ví dụ `locket-web`
   - **Select the Space SDK**: chọn **Docker** → chọn template **Blank**
   - **Space hardware**: giữ mặc định **CPU basic · 2 vCPU · 16 GB · FREE**
   - **Visibility**:
     - Chọn **Public** nếu bạn muốn mở trực tiếp trên điện thoại / chia sẻ link cho bạn bè cùng dùng (mỗi người tự đăng nhập bằng tài khoản Locket của mình; dữ liệu của mỗi người tách biệt hoàn toàn).
     - Hoặc chọn **Private** nếu chỉ dùng cá nhân (khi vào từ điện thoại cần đăng nhập Hugging Face trên trình duyệt trước).
3. Bấm **Create Space**.

---

## Bước 3: Cấu hình Secrets để lưu bền vững (quan trọng)

Trên trang Space vừa tạo, vào tab **Settings → Variables and secrets → New secret** và thêm **3 Secret** sau:

| Tên Secret | Giá trị | Ý nghĩa |
| :--- | :--- | :--- |
| `HF_TOKEN` | `hf_xxxxxxxx...` (token bước 1) | Cho phép server đọc/ghi Private Dataset |
| `LOCKET_HF_REPO` | `<username>/locket-data` *(thay `<username>` bằng tên tài khoản HF của bạn)* | Tên Dataset riêng tư lưu phiên & lịch sử. Server sẽ **tự động tạo Dataset ở chế độ Private** nếu chưa có! |
| `LOCKET_BACKUP_KEY` | Chuỗi bí mật dài bất kỳ (vd. 20–30 ký tự ngẫu nhiên) | Mã hóa AES+HMAC (`Fernet`) toàn bộ token & lịch sử trước khi đẩy lên Dataset |

> **Bảo vệ an toàn tích hợp sẵn**:
> - Server chỉ đồng bộ `sessions/` và `accounts/` (nhẹ vài trăm KB); `thumbs/` và `videos/` giữ ở ổ tạm 50 GB của container.
> - Nếu bạn lỡ tạo Dataset là **Public**, server sẽ **tự động từ chối đồng bộ** và báo lỗi trong Logs để không bao giờ rò token Firebase ra ngoài.
> - Không đặt `LOCKET_BACKUP_KEY` vẫn chạy được, nhưng **rất nên đặt** để dữ liệu trên Dataset luôn ở dạng mã hóa `.enc`.

---

## Bước 4: Đẩy mã nguồn dự án lên Space

### Cách 1 (Khuyên dùng — 1 lệnh duy nhất, không cần xử lý Git con)

Mở PowerShell tại thư mục dự án (`d:\TrungHuy\tools\LocketV2`) và chạy:

```powershell
$env:HF_TOKEN="hf_xxxxxxxx..."   # dán token Bước 1
python deploy_hf.py <username>/<space-name>
```

Script `deploy_hf.py` sẽ tự động đẩy đầy đủ mã nguồn (kể cả `vendor/locketlam`) và **tuyệt đối bỏ qua** `backend/data/`, `.env`, `frontend/node_modules/`, `frontend/dist/`, `.git/`.

### Cách 2 (Dùng Git truyền thống)

Nếu bạn muốn push bằng Git thay vì `deploy_hf.py`, **bắt buộc phải xóa thư mục `.git` nằm bên trong `vendor/locketlam`** trước khi `git add .` (nếu không Git sẽ đẩy `vendor/locketlam` thành thư mục rỗng và Docker build sẽ thiếu SDK `locketlam`):

```powershell
Remove-Item -Recurse -Force vendor\locketlam\.git -ErrorAction SilentlyContinue
git init
git branch -M main
git status   # kiểm tra KHÔNG có backend/data hay .env
git add .
git commit -m "Deploy Locket Web to Hugging Face Spaces"
git remote add hf https://huggingface.co/spaces/<username>/<space-name>
git push hf main
```

Sau khi đẩy lên, vào tab **Logs** của Space:
- Quá trình build Docker (tự chạy `npm run build` + cài Python/ffmpeg) mất khoảng **2–4 phút** lần đầu.
- Khi thấy dòng `HF state sync ready (<username>/locket-data, restored ...)` và `Uvicorn running on http://0.0.0.0:7860` là thành công!

---

## Bước 5: Mở ứng dụng đúng URL (Rất quan trọng!)

**KHÔNG dùng app bên trong khung nhúng ở `https://huggingface.co/spaces/...`** vì chính sách bảo mật của Locket Web chặn iframe (`X-Frame-Options: DENY`, cookie `SameSite=Strict`) và trình duyệt điện thoại không cài được PWA qua iframe.

Thay vào đó, hãy mở **trực tiếp URL gốc của Space**:

```
https://<username>-<space-name>.hf.space
```

*(Bạn cũng có thể bấm nút dấu 3 chấm `⋮` góc phải trên trang Space → **Embed this Space** để copy đúng **Direct URL**).*

- Mở URL `.hf.space` trên **iPhone (Safari)** → nút **Chia sẻ → Thêm vào MH chính** để dùng toàn màn hình như app thật.
- Mở trên **Android (Chrome/Edge)** → bấm **Cài đặt ứng dụng**.

---

## Ghi chú vận hành

- **Space ngủ sau 48 giờ không ai truy cập**: lần mở lại đầu tiên mất ~15–30 giây để Space tỉnh dậy, server tự kéo lại `sessions/` và `accounts/` từ Private Dataset nên bạn **không bị đăng xuất và không mất lịch sử**.
- **Khi sửa code muốn cập nhật lên Space**: chỉ cần chạy lại `python deploy_hf.py <username>/<space-name>` (hoặc `git push hf main` nếu dùng Cách 2).
- **Giữ bí mật `LOCKET_BACKUP_KEY`**: nếu bạn đổi khóa này sau khi đã có backup mã hóa trên Dataset, file cũ sẽ không giải mã được bằng khóa mới (cần đăng nhập lại).
