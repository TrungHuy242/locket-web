# Locket Web

Web app dùng dữ liệu Locket thật, xây trên Python SDK không chính thức
[`locketlam`](https://github.com/leanhminh2104/locketlam) (clone trong `vendor/locketlam`).
Không có chế độ demo, không có dữ liệu mẫu: mọi thứ hiển thị đều đến từ tài khoản Locket đã đăng nhập.

> Dự án cá nhân, không liên kết với Locket Labs. `locketlam` gọi API nội bộ của Locket bằng cách giả lập ứng dụng iOS,
> nên tài khoản có rủi ro bị Locket hạn chế. Hãy cân nhắc trước khi dùng tài khoản chính.

## Chạy

```bash
pip install -r backend/requirements.txt
```

Giao diện là React + Vite, cần build một lần (và sau mỗi lần sửa `frontend/src`):

```bash
cd frontend && npm install && npm run build
```

```bash
python run.py
```

Mở http://localhost:8000 và đăng nhập bằng email/mật khẩu Locket.

Mở từ điện thoại cùng Wi‑Fi (camera chỉ hoạt động qua HTTPS hoặc localhost):

```bash
python run.py --lan --https
```

Khi phát triển giao diện: chạy `python run.py` rồi `npm --prefix frontend run dev`, mở http://localhost:5173
(Vite tự chuyển `/api` sang backend cổng 8000, sửa code là thấy ngay).

Giao diện responsive, không có khung điện thoại giả lập:

- **Desktop (≥ 1100px)**: thanh điều hướng bên trái, camera/khoảnh khắc ở giữa, panel "Lịch sử" bên phải; Chat hai cột.
- **769–1099px**: thanh điều hướng thu gọn thành icon.
- **Điện thoại (≤ 768px)**: toàn màn hình như ứng dụng Locket, có thể "Thêm vào màn hình chính".

## Bảng tin lấy dữ liệu thế nào

API Locket mà SDK dùng (`getLatestMomentV2`) **chỉ trả về một khoảnh khắc: cái mới nhất** trong số những người không bị
loại trừ. Không có tham số phân trang lùi về quá khứ (đã thử `sync_token`, `limit`, `before`…), và kho lịch sử trên
Firestore từ chối quyền đọc. Vì vậy backend ghép bảng tin từ bốn nguồn thật:

1. **Ảnh mới nhất của từng người** — gọi song song, mỗi lần loại trừ tất cả người khác (kể cả người không còn trong
   danh sách bạn bè nhưng vẫn còn ảnh xem được). Có ngày giờ, chú thích, video chính xác.
2. **Khoảnh khắc được nhắc tới trong tin nhắn** — mọi tin nhắn Locket đều trỏ tới một khoảnh khắc; backend quét toàn bộ
   hội thoại (có phân trang) để lấy các khoảnh khắc cũ. Loại này chỉ có ảnh; thời gian là thời điểm tin nhắn sớm nhất
   nhắc tới nó nên được đánh dấu `≈` trên giao diện.
3. **Kho lưu trữ (Firebase Storage) — chỉ với khoảnh khắc của chính bạn.** Video và thumbnail của một khoảnh khắc dùng
   chung tên file (`thumbnails/<id>.webp` ↔ `videos/<id>.mp4`). Storage cho tài khoản đọc metadata **file của chính mình**,
   nên backend lấy được thời điểm tải lên chính xác và phát hiện khoảnh khắc nào thực ra là video (kèm token tải video gốc).
   Nhờ vậy 31 video cũ của bạn không còn bị hiện thành ảnh. File của bạn bè: Storage trả `403`, không đọc được.
4. **Lịch sử đã đồng bộ** — mọi khoảnh khắc từng thấy được lưu ở `backend/data/accounts/<hash>/moments.json`, nên lịch sử
   dày dần theo thời gian (giống ứng dụng điện thoại lưu lịch sử trên máy).

Sau lần đầu, mỗi lần làm mới chỉ tốn một request nhờ `sync_token` (Locket trả 304 nếu không có gì mới).
Giới hạn còn lại: nếu một người đăng nhiều ảnh trong lúc web không mở, chỉ ảnh mới nhất của họ lấy được qua nguồn 1.

`GET /api/feed?before=<con trỏ>&limit=30` trả từng trang; giao diện tự tải thêm khi xem gần hết hoặc cuộn panel Lịch sử.

### Vì sao không lấy thêm được lịch sử (đã kiểm tra lại)

- `getLatestMomentV2` và bản cũ `getLatestMoment` luôn trả **đúng 1** khoảnh khắc; `sync_token` chỉ là id của ảnh mới
  nhất (dùng để hỏi "có gì mới không"), truyền id ảnh cũ vẫn chỉ nhận 1 ảnh. Các tham số `limit`, `count`, `before`… bị bỏ qua.
- 16 endpoint lịch sử/feed khác đều trả 404.
- Mọi đường dẫn Firestore chứa lịch sử (`history/…`, `users/<uid>/moments`, …) trả `403 PERMISSION_DENIED`: đây là
  luật bảo mật của Locket, web không vượt qua.
- Quét chat đã bỏ giới hạn số tin nhắn (đang có 3.433 tin trong 14 hội thoại), nên mọi khoảnh khắc từng được nhắc trong chat đều được lấy.
- Firebase Storage cấm liệt kê file (`403`, kể cả thư mục của chính bạn), nên không tìm được khoảnh khắc nào chưa
  từng xuất hiện qua API hoặc chat.
- Lịch sử vì vậy tăng dần theo thời gian: mỗi lần đồng bộ, khoảnh khắc mới của bạn bè được lưu lại trên server.

Kết quả đo trên tài khoản hiện tại: **367 khoảnh khắc** (không trùng) — 151 của bạn (31 video), 216 của bạn bè (4 video).
Khoảnh khắc của bạn có thời gian chính xác; 196 khoảnh khắc cũ của bạn bè chỉ biết qua chat nên thời gian là ước lượng `≈`
và không có caption.

### Video

- Ảnh và video được phân biệt theo dữ liệu thật: có `video_url` từ API, hoặc có file cùng tên trong kho video. Trình phát
  luôn dùng file MP4 gốc (thumbnail chỉ là ảnh chờ): chạm vào video để tạm dừng/tiếp tục, nút loa để bật tiếng, thanh
  tiến trình và thời lượng còn lại.
- Video của Locket là MP4 **HEVC (hvc1)** 720×720 hoặc 1080×1080. Trình duyệt phát được HEVC thì phát thẳng; nếu không, web tự chuyển
  sang bản **H.264** do server tạo và lưu cache (`backend/data/videos/`), hỗ trợ tua (Range).
- Nhấn giữ nút chụp để quay (tối đa 10 giây), thả tay để xem trước; chạm nhanh vẫn là chụp ảnh. Trên iPhone, Safari quay
  thẳng luồng camera và server cắt vuông + lật ảnh selfie; trên desktop quay canvas vuông như khung ngắm.
- Trước khi gửi, server chuyển mọi video (WebM/MP4/MOV, mọi tỉ lệ) thành MP4 H.264 vuông **1080×1080** (đúng cỡ clip của
  ứng dụng iPhone), tối đa 15 giây (web quay / cắt 10 giây), dưới giới hạn 6 MB của Locket; clip đã đúng chuẩn thì
  giữ nguyên, không nén lại. Cần `imageio-ffmpeg` (đã có trong `backend/requirements.txt`).
- Locket không có bình luận công khai: trả lời một khoảnh khắc là tin nhắn riêng. Nút 💬 trên khoảnh khắc mở danh sách
  các tin nhắn thật đã trả lời nó (lấy khi quét hội thoại, làm mới mỗi 5 phút).
- Cảm xúc nhanh dùng `suggested_reactions` Locket gửi kèm từng khoảnh khắc (nếu có).
- Người đã xem chỉ lấy được cho ảnh của chính mình (`getMomentViews` trả 401 với ảnh của người khác).
- Trong chat, "Đã xem / Đã nhận / Đã gửi" lấy từ mốc đọc của Locket; tin nhắn tải 60 cái mới nhất, có nút tải tin cũ hơn.

## Cài đặt như ứng dụng (PWA)

- **Manifest** (`frontend/public/manifest.webmanifest`): tên, mô tả, `display: standalone`, màu nền/thanh trạng thái đen,
  icon PNG 192/512 + icon maskable cho Android + SVG, phím tắt (Camera, Tin nhắn, Thông báo, Kỷ niệm → `/?open=...`).
- **iOS**: `apple-touch-icon` PNG 180, 18 ảnh khởi động `apple-touch-startup-image` cho các cỡ iPhone/iPad, thanh trạng thái
  trong suốt + vùng an toàn. Icon và ảnh khởi động sinh lại bằng `python frontend/scripts/make_pwa_assets.py`.
- **Màn mở ứng dụng**: logo trên nền đen ngay khi tải trang (trong `index.html`), ẩn đi khi biết trạng thái đăng nhập.
- **Service Worker** (`frontend/sw.template.js`, build ra `dist/sw.js` kèm danh sách tệp và số phiên bản):
  - chỉ cache app shell (index.html, JS/CSS có hash, icon) — giống nhau với mọi người, không chứa dữ liệu cá nhân;
  - **không bao giờ** chặn hay cache `/api/*` (phiên, khoảnh khắc, tin nhắn, ảnh): luôn đi thẳng ra mạng, server trả `no-store`;
  - điều hướng: ưu tiên mạng, mất mạng thì dùng shell đã cache.
- **Ngoại tuyến**: mở app khi không có mạng → màn "Bạn đang ngoại tuyến", tự vào lại khi có mạng (sự kiện `online`, khi quay lại
  app, và mỗi 5 giây). Đang dùng mà mất mạng/máy chủ → banner trên cùng; có lại → "Đã kết nối lại" và tải lại bảng tin,
  tin nhắn, thông báo, bạn bè.
- **Cập nhật**: mỗi bản build có service worker mới; app kiểm tra khi quay lại và mỗi 30 phút, hiện "Đã có phiên bản mới ·
  Cập nhật" và chỉ tải lại khi người dùng bấm. Cài đặt → Ứng dụng có số phiên bản và nút kiểm tra.
- **Cài đặt**: Chrome/Edge (Android, máy tính) dùng nút "Cài đặt Locket" trong Cài đặt → Ứng dụng (sự kiện `beforeinstallprompt`)
  hoặc nút trên thanh địa chỉ; iPhone/iPad có hướng dẫn "Chia sẻ → Thêm vào MH chính"; Safari trên Mac: Tệp → Thêm vào Dock.
- **Bảo mật**: token chỉ nằm ở server (cookie HttpOnly); đăng xuất gửi `Clear-Site-Data: "cache"` để xóa ảnh/video bạn bè
  mà trình duyệt đã cache riêng; tệp `/assets/*` có hash được cache `immutable`, `sw.js`/manifest/index luôn `no-cache`.
- **Cài đặt cần HTTPS** (hoặc `localhost`). Khi mở từ điện thoại qua mạng LAN bằng `http://<ip>:8000`, trình duyệt không cho cài
  và không chạy service worker — cần đặt server sau HTTPS (reverse proxy có chứng chỉ, hoặc tunnel).
- **Web Push**: chưa hỗ trợ. Thông báo đẩy của Locket gửi qua Firebase Cloud Messaging tới token của ứng dụng iPhone; web không có
  cấu hình web/VAPID của Locket, và ghi token trình duyệt bằng `setNotificationToken` có thể thay token của iPhone (iPhone mất
  thông báo). Tự gửi Web Push từ server này sẽ cần server luôn chạy, liên tục đọc Locket cho mỗi tài khoản, và HTTPS.

## Giao diện (design system)

- **Token màu** (`frontend/src/styles/tokens.css`): mọi màu đều là biến CSS, có bộ **Tối** và **Sáng** kiểu iOS.
  Cài đặt → Giao diện: Tự động (theo hệ thống) / Sáng / Tối, áp dụng trước lần vẽ đầu. Camera, bảng tin và trình xem
  ảnh luôn nền tối như ứng dụng Locket.
- **Component dùng chung** (`frontend/src/ui/kit.jsx`):
  - `Button` (primary / secondary / tinted / plain / destructive; lg / md / sm), tự hiện spinner khi `onClick` trả về
    Promise và chặn bấm lặp;
  - `IconButton`, `Spinner` (vòng nan kiểu iPhone), `SkeletonList` / `SkeletonGrid` / `SkeletonBubbles`, `StateView`
    (trạng thái rỗng / lỗi có nút thử lại).
- **Phản hồi** (`ui/overlays.jsx`): `ui.success / error / warning / info` — toast có icon, tự ẩn theo độ dài nội dung,
  chạm hoặc vuốt lên để đóng; hộp xác nhận kiểu UIAlertController cho thao tác quan trọng; không dùng `alert()` /
  `confirm()` của trình duyệt.
- **Đăng khoảnh khắc**: vòng tiến trình trên nút Gửi theo dung lượng đã tải lên (XHR), sau đó "Đang xử lý video…"
  trong lúc server chuyển mã (giai đoạn này không đo được chính xác nên không hiện phần trăm).

## Kiểm tra chất lượng

```bash
cd frontend && npm run lint && npm run build     # ESLint (react-hooks) + build production
python -m pyflakes backend/app                    # import / biến thừa phía Python (pip install pyflakes)
```

- Dự án dùng JavaScript (JSX), không có TypeScript; ESLint gồm `@eslint/js` recommended và `react-hooks`.
- Các trang mở khi cần (Tin nhắn, Hồ sơ/Cài đặt, Kỷ niệm, Thông báo) được tách thành chunk riêng và tải sẵn khi rảnh.
- Hồ sơ của chính bạn được đọc lại sau 2 phút / khi quay lại app, nên tên và avatar đổi trên iPhone hiện lên web.
- Mất kết nối máy chủ: app kiểm tra `/api/health` mỗi 5 giây; khi có lại, các màn (bảng tin, tin nhắn, kỷ niệm,
  thông báo, bạn bè, hồ sơ bạn bè) tự tải lại.

## Thư viện asset Photobooth

- `frontend/public/booth/stickers/*.svg` — 35 hình minh họa **tự vẽ** (không dùng hình bên ngoài hay nhân vật có bản quyền;
  phong cách "cute pastel" dùng linh vật nguyên bản "mochi"), cùng một phong cách sticker: màu pastel, nét viền nâu ấm,
  viền cắt trắng, nền trong suốt.
- `frontend/public/booth/textures/*.png` — texture giấy, giấy kraft, hạt film, vải lanh, caro, chấm bi (PNG, có kênh alpha).
- Sinh lại / thêm hình: sửa `frontend/scripts/make_booth_assets.py` rồi chạy `python frontend/scripts/make_booth_assets.py`;
  đăng ký hình mới và mẫu khung trong `frontend/src/lib/boothAssets.js` (vị trí trang trí tính theo tỉ lệ nên mẫu nào cũng
  hợp mọi bố cục và số ảnh).
- Asset được phục vụ cùng trang (không dùng URL ngoài), cache 1 ngày ở server và cache-first trong service worker.

## Kiến trúc

```
frontend/                React 18 + Vite (build ra frontend/dist, backend phục vụ thư mục này)
  src/App.jsx            phiên đăng nhập → Login hoặc shell (sidebar + home + các trang)
  src/api.js             client gọi /api cùng origin
  src/store.js           state dùng chung (người dùng, bạn bè, tin chưa đọc) qua useSyncExternalStore
  src/ui/overlays.jsx    sheet, alert, action sheet, toast, popover (API dạng lệnh: ui.sheet(...), ui.confirm(...))
  src/ui/nav.jsx         các trang đẩy vào (hiệu ứng iOS), nút Back của trình duyệt/Android
  src/screens/           Login · Home (pager, phân trang, lịch sử) · MomentPage (ảnh/video gốc) · Memories · Camera
                         (chụp, giữ để quay) · Friends · Chat · Profile/Settings · Sidebar
  src/components/        Avatar · CaptionPill
  src/styles/            base · home · views · layout (bố cục desktop/điện thoại)
backend/app/
  main.py            FastAPI: route, cookie phiên, CSRF header, media proxy + thumbnail cache, CSP
  sessions.py        phiên phía server (cookie HttpOnly ↔ thư mục phiên)
  providers/live.py  bọc SDK locketlam: đăng nhập, đồng bộ bảng tin, bạn bè, chat, hồ sơ
  history.py         kho lịch sử khoảnh khắc theo tài khoản
  video.py           ffmpeg: chuẩn hóa video trước khi gửi, bản H.264 để phát
  captions.py        kiểu chú thích lấy từ caption_presets.json của SDK
vendor/locketlam/    SDK gốc
```

### Dữ liệu trên server (`backend/data/`, không commit)

| Thư mục | Nội dung |
| --- | --- |
| `sessions/` | token Firebase của từng phiên trình duyệt; xóa khi đăng xuất |
| `accounts/` | lịch sử khoảnh khắc đã đồng bộ của từng tài khoản (URL ảnh, uid bạn bè) |
| `thumbs/` | ảnh thu nhỏ đã tạo, để lưới ảnh tải nhanh |
| `videos/` | bản H.264 của video HEVC, cho trình duyệt không giải mã được HEVC |

### Bảo mật

- Email/mật khẩu chỉ đi từ trình duyệt tới backend; backend đăng nhập Firebase qua SDK. Mật khẩu không được lưu.
- Token nằm phía server; trình duyệt chỉ giữ cookie ngẫu nhiên `lk_sid` (HttpOnly, SameSite=Strict).
- Request ghi phải có header `X-Locket-Client` (chống CSRF); đăng nhập bị giới hạn số lần thử theo IP.
- Ảnh/video được stream qua `/api/media` (chỉ cho phép host lưu trữ của Locket, không follow redirect).
- Ảnh tải lên được giải mã lại và xóa EXIF/GPS trước khi gửi.
- `LOCKET_COOKIE_SECURE=1` trong `.env` để cookie chỉ đi qua HTTPS khi deploy.

## Tính năng (tất cả gọi API thật)

- **Đăng nhập** email/mật khẩu, tự làm mới token, đăng xuất.
- **Camera**: `getUserMedia`, chạm để chụp, giữ để quay video (≤ 10 giây), đổi camera trước/sau, zoom.
  - Flash: camera có đèn (camera sau trên điện thoại, `torch`) thì bật đèn thật khi chụp và suốt lúc quay; camera
    trước / máy tính dùng màn hình sáng trắng khi chụp. Trình duyệt không hỗ trợ `torch` (Safari iOS, Firefox) thì chỉ có flash màn hình.
  - Thư viện: chọn **ảnh hoặc video**. Ảnh được cắt vuông theo đúng hướng EXIF; video dài hơn 10 giây có thanh chọn đoạn
    10 giây, xem trước lặp đúng đoạn đã chọn, server cắt bằng ffmpeg. Video trình duyệt không giải mã được (vd. HEVC trên
    một số trình duyệt máy tính) vẫn gửi được: server tự cắt, chuyển mã và tạo ảnh bìa. Tối đa 200 MB mỗi tệp.
  - Chất lượng: ảnh 1020×1020 WebP như ảnh gốc của Locket, chỉ nén một lần ở server (SDK không nén lại);
    video ghi 1080×1080, 8 Mbps.
- **Bộ lọc (WebGL)** — `frontend/src/lib/filters.js`: 20 bộ lọc (Vintage Film, Retro, Y2K, Korean Aesthetic, Soft Pink,
  Pastel, Film Grain, VHS, Disposable, Black & White, Noir, Warm/Cool Tone, Flash, Soft Blur, Glow, Analog Film, Cinematic,
  Moody) chạy trong một fragment shader: xem trước realtime trên khung ngắm, chỉnh cường độ, và **áp vào pixel thật** của
  ảnh chụp, ảnh chọn từ thư viện và video quay (desktop/Android quay từ canvas đã lọc). Trên iPhone, Safari quay thẳng
  luồng camera nên video không mang bộ lọc (ảnh và photobooth vẫn có).
- **Photobooth** (nút ẢNH / PHOTOBOOTH dưới khung ngắm): chụp liên tiếp 3 hoặc 4 ảnh, đếm ngược 3/5/10 giây, khung căn
  tỉ lệ 3:4 / 1:1 / 4:3, dừng giữa chừng được. Ảnh lưu vuông 1200 px chưa lọc, nên trong trình chỉnh sửa có thể:
  - bộ lọc cho cả dải hoặc riêng từng ảnh (chạm ảnh để chọn) + cường độ;
  - **15 mẫu khung kiểu photobooth Hàn Quốc** (6 nhóm: Thú cưng, Cute, Pastel, Y2K, Vintage & Film, Minimal) với
    hình minh họa thật: cún/mèo nhìn trộm trên ảnh đầu, nhân vật ở chân khung, sticker tràn qua góc ảnh, băng dính
    washi, tem, dải lỗ phim; nền màu/gradient + họa tiết caro, chấm bi, giấy kraft + texture giấy, hạt film, vải lanh;
    thumbnail từng mẫu được render bằng chính ảnh vừa chụp;
  - **Sticker**: 35 hình SVG chia 6 nhóm; kéo để di chuyển, tay cầm ở góc để phóng to/xoay (chụm hai ngón trên điện
    thoại, cuộn chuột trên máy tính, phím Delete/mũi tên), nhân bản, đưa lên trên, xóa; "Chỉnh trang trí của khung"
    biến hình minh họa của mẫu thành sticker để chỉnh từng hình;
  - **Tùy chỉnh**: màu nền, texture, kiểu viền (mảnh, dày, polaroid, đường may), bo góc, khoảng cách; chữ, 7 font có
    tiếng Việt (Itim, Pacifico, Dancing Script, Playfair Display, Comfortaa, Space Mono, Nunito), màu chữ, ngày chụp
    (3 định dạng, ở chân khung, đầu khung hoặc trên ảnh kiểu máy film);
  - bố cục dải dọc, dải đôi (2 dải giống nhau như máy photobooth), lưới 2×2, dải ngang; đổi tỉ lệ ô;
  - chụp lại một ảnh hoặc tất cả; lưu ảnh ghép JPEG hoặc PNG (ô rộng 1000 px, hình minh họa vector vẽ đúng độ
    phân giải xuất nên không vỡ) hoặc từng ảnh riêng (1200 px); bản xem trước và bản xuất dùng cùng một hàm vẽ;
  - **Đăng lên Locket**: Locket hiển thị mọi khoảnh khắc dạng vuông, nên web đặt dải ảnh giữa một ảnh vuông 1020×1020
    cùng màu khung rồi đi qua màn gửi bình thường (chú thích, người nhận, `postMomentV2`).
- **Gửi**: xem trước (video tự phát, bật/tắt tiếng, độ dài), chụp lại, chú thích + kiểu chú thích Locket, chọn người nhận
  hoặc "Chỉ mình tôi", đăng (`postMomentV2`); bài nằm trên máy chủ Locket nên hiện trong ứng dụng iPhone.
- **Bảng tin / Lịch sử**: phân trang, lọc theo người, thả cảm xúc (`reactToMoment`), bình luận (trả lời vào chat kèm
  khoảnh khắc), xem ai đã xem ảnh của mình (`getMomentViews`), xóa ảnh của mình.
- **Kỷ niệm**: toàn bộ lịch sử theo dòng thời gian, nhóm theo ngày / tháng / năm; lọc ảnh–video, người đăng, năm và
  tháng (mỗi lựa chọn hiện số lượng); tìm kiếm không dấu theo caption, tên bài hát và người đăng; tự tải thêm khi cuộn;
  chạm để xem toàn màn hình (ảnh hoặc video gốc, caption, thời gian, người đăng), vuốt/phím mũi tên để chuyển, Back/Esc để đóng.
  API: `GET /api/memories?kind=&author=&year=&month=&q=&before=&limit=` (lọc phía server, có thống kê theo năm/tháng/người đăng).
- **Cảm xúc & bình luận** (bảng tin và trình xem Kỷ niệm):
  - Thả cảm xúc nhanh (bộ gợi ý Locket gửi kèm từng khoảnh khắc) hoặc chọn emoji khác; hiện ngay trên ảnh.
  - Khoảnh khắc của bạn: bảng **Hoạt động** liệt kê từng người đã thả cảm xúc (emoji, thời gian), người đã xem và bình
    luận; tự cập nhật mỗi 4 giây khi đang mở.
  - Bình luận = tin nhắn trả lời khoảnh khắc (đúng cách Locket hoạt động): xem đúng người, avatar, thời gian, nội dung;
    gửi bình luận; thu hồi bình luận của mình; thả/gỡ cảm xúc trên bình luận của bạn bè. Đọc lại từ Locket mỗi khi mở
    và mỗi 4 giây, nên bình luận viết trên iPhone cũng hiện ra.
  - **Giới hạn của Locket**: không có API gỡ cảm xúc khỏi khoảnh khắc (đã thử 10 tên endpoint, đều 404 — app iPhone cũng
    không cho gỡ); chỉ người đăng đọc được ai đã thả cảm xúc, nên trên khoảnh khắc của bạn bè web chỉ hiện các cảm xúc bạn
    gửi từ web; không có API sửa nội dung bình luận.
- **Bạn bè**: danh sách đọc thẳng từ Locket (avatar thật), tìm kiếm không dấu trong bạn bè, tra `@username` trên Locket;
  chấp nhận / từ chối lời mời đến, hủy lời mời đã gửi (`deleteFriendRequest`), xóa bạn, chặn và **bỏ chặn** (danh sách
  đã chặn); tự làm mới mỗi 15 giây để khớp thay đổi từ iPhone; giao diện cập nhật ngay sau mỗi thao tác.
- **Hồ sơ bạn bè**: avatar, tên, username, quan hệ, thống kê từ lịch sử đã đồng bộ (khoảnh khắc, video, bình luận),
  12 khoảnh khắc gần nhất, mở Kỷ niệm lọc sẵn theo người đó, nhắn tin, link mời, xóa/chặn/bỏ chặn. Chạm tên trong chat
  cũng mở hồ sơ.
  - **Giới hạn của Locket**: gửi lời mời kết bạn từ web bị Locket từ chối (`sendFriendRequest` luôn trả
    `UNAUTHENTICATED`, dù các thao tác khác dùng cùng token đều được chấp nhận — nhiều khả năng do App Check của app
    iPhone). Web báo lỗi rõ và gợi ý gửi link mời. Hồ sơ chỉ gồm những gì Locket cho đọc (tên, username, avatar, huy
    hiệu); không có gợi ý bạn bè (endpoint 404 / bị từ chối).
- **Tin nhắn**:
  - Thời gian thực qua WebSocket của Locket (`wss://api.locketcamera.com/wss_v2/chat`). Trình duyệt không gắn được
    token vào WebSocket nên backend làm cầu nối (`/api/chats/{uid}/live`, chỉ nhận kết nối cùng nguồn); mỗi sự kiện
    làm web đọc ngay tin mới từ Firestore. Mất kết nối thì tự nối lại và quay về polling 3,5 giây.
  - Lịch sử phân trang bằng con trỏ thời gian (Firestore `runQuery`, 50 tin/trang): cuộn lên đầu để tải tin cũ, giữ vị trí đang đọc.
  - Trạng thái: Đang gửi → Đã gửi / Đã nhận / Đã xem (mốc đọc của Locket); gửi lỗi có Thử lại / Bỏ.
  - Avatar theo nhóm tin, giờ gửi, thả/gỡ cảm xúc, thu hồi tin của mình; chạm tên để mở hồ sơ.
  - Ảnh/video trong chat: Locket không có tin nhắn ảnh tự do — mọi tin đều gắn với một khoảnh khắc. Web hiện khoảnh
    khắc trong chat (phát được nếu là video) và cho **gửi một khoảnh khắc của bạn** vào cuộc trò chuyện (nút ảnh cạnh ô nhập).
- **Thông báo** (chuông ở thanh trên / thanh bên, có số chưa đọc):
  - Locket không có API hộp thư thông báo (trên iPhone đó là thông báo đẩy; mọi collection kiểu
    `notifications` đều trả 403). Backend ghép danh sách từ chính các sự kiện thật đó, trong 30 ngày gần nhất:
    cảm xúc trên khoảnh khắc của bạn (`moments/{id}/reactions`), câu trả lời khoảnh khắc của bạn và tin nhắn mới
    (tin trong từng cuộc trò chuyện), cảm xúc lên tin nhắn của bạn, lời mời kết bạn, bạn mới (khi Locket có mốc thời gian).
  - Chạm để mở đúng khoảnh khắc (kèm bảng bình luận với câu trả lời), cuộc trò chuyện hoặc hồ sơ; chấp nhận / từ chối lời mời ngay trong danh sách.
  - Đã đọc / chưa đọc: tin nhắn và câu trả lời dùng mốc đọc thật của Locket (đọc trên iPhone thì web cũng tính đã đọc).
    Locket không lưu trạng thái đã xem của các loại khác, nên "đánh dấu đã đọc" (từng mục hoặc tất cả) được lưu trên
    server web (`backend/data/accounts/<id>/notifications.json`) và không đồng bộ ngược về iPhone.
  - Cập nhật bằng polling 15 giây (25 giây khi đang ở trang chủ); server trả danh sách đệm và dựng lại ở nền
    (~10 giây đọc Firestore). Locket không có luồng thời gian thực chung cho thông báo.
- **Hồ sơ**: đổi tên, đổi avatar, tùy chọn thông báo.

Khi Locket lỗi hoặc từ chối, giao diện hiện đúng thông báo lỗi (trang lỗi có nút "Thử lại" hoặc toast) — không có dữ liệu thay thế.

### Giới hạn đã biết

- SDK không có đăng ký, đặt lại mật khẩu, danh sách chặn hay đăng nhập bằng số điện thoại.
- Định dạng sự kiện WebSocket của Locket không được công bố; web chỉ dùng sự kiện làm tín hiệu rồi đọc lại tin từ Firestore.
- Không có Rollcall, streak hay bộ lọc camera: API trả rỗng hoặc không có endpoint (`getRollcallPosts` trả danh sách rỗng, `getFilters` rỗng, `getStreak` 404).
- Đăng từ web chỉ hỗ trợ caption chữ, giờ và các huy hiệu; chưa đăng được caption nhạc/vị trí/thời tiết.
- Phụ thuộc API nội bộ của Locket: nếu Locket đổi API, cần cập nhật `vendor/locketlam` và `providers/live.py`.
