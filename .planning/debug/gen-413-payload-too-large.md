---
status: fixed
trigger: "bạn giúp tôi fix và debug cho tôi xem trước đã nhé — upload ảnh mặt trên desktop rồi bấm Combine báo lỗi 413 FUNCTION_PAYLOAD_TOO_LARGE trên POST /api/generate (xem ảnh chụp Vercel dashboard)"
created: 2026-08-05
updated: 2026-08-05
---

# Debug Session: gen-413-payload-too-large

## Symptoms

- **Expected behavior:** Kéo-thả/upload ảnh mặt đồng hồ trên desktop, crop, bấm Combine → request tới `/api/generate` thành công, nhận ảnh kết quả AI.
- **Actual behavior:** Request tới `/api/generate` bị chặn với HTTP 413.
- **Error message:** Vercel dashboard hiển thị `Error: FUNCTION_PAYLOAD_TOO_LARGE`, status 413, trên request `/api/generate` (production, host `watch-customizer-app.vercel.app`).
- **Timeline:** Phát hiện hôm nay (2026-08-05) qua Vercel dashboard khi test tính năng upload ảnh + gen.
- **Reproduction:** Upload một ảnh mặt đồng hồ có độ phân giải cao qua đường drag-drop desktop (không phải qua mobile QR handoff), crop, bấm nút Combine.

## Prior investigation (this session, before /gsd-debug invoked)

Đã dùng `superpowers:systematic-debugging` Phase 1+2 thủ công trước khi gọi `/gsd-debug`, tìm được root cause có bằng chứng cụ thể:

- `src/utils/cropImage.ts:79` — `canvas.toDataURL('image/png')`. Canvas có kích thước = `pixelCrop.width/height`, tức **đúng độ phân giải gốc của ảnh đã upload**, không hề resize/cap trước khi encode. PNG là lossless — với ảnh chụp liên tục tông màu (photographic), PNG nén kém hơn nhiều so với JPEG.
- Ảnh base64 PNG này được gửi nguyên trong JSON body qua `fetch('/api/generate', { body: JSON.stringify({...}) })` tại `src/components/CombineSection.tsx:98-101`.
- Vercel serverless function có giới hạn kích thước request body (dù theo bản cập nhật gần đây có thể cao hơn mức 4.5MB cũ, `FUNCTION_PAYLOAD_TOO_LARGE` là error code chuẩn của Vercel khi vượt giới hạn này) → 413.
- **Đối chứng (pattern comparison):** luồng mobile upload (`src/app/mobile-upload/page.tsx:82`) dùng `canvas.toDataURL('image/jpeg', 0.92)` — nén JPEG 92%, kích thước bị giới hạn tự nhiên bởi độ phân giải camera (thường ~720p-1080p) → payload nhỏ, chưa từng gặp lỗi này. Khác biệt đúng ở 2 điểm: định dạng (PNG lossless vs JPEG nén) và không cap độ phân giải ở luồng desktop.

**Chưa fix gì** — dừng lại ở bước chẩn đoán, đợi `/gsd-debug` xác minh lại bằng chứng độc lập và đề xuất fix trước khi áp dụng, theo đúng yêu cầu người dùng ("cho tôi xem trước đã").

## Current Focus

- **hypothesis:** `getCroppedImg` trong `src/utils/cropImage.ts` encode ảnh crop desktop ở độ phân giải gốc không giới hạn, dạng PNG lossless (không giống JPEG nén như luồng mobile) → base64 payload của ảnh độ phân giải cao vượt giới hạn body size của Vercel Function, gây 413 FUNCTION_PAYLOAD_TOO_LARGE trên `/api/generate`.
- **test:** Kiểm tra kích thước thực tế của base64 string sinh ra từ `getCroppedImg` với 1 ảnh input độ phân giải cao thực tế (vd 3000x3000+), so với giới hạn payload thực tế của deployment Vercel hiện tại (xác nhận qua Vercel docs/dashboard project settings, không đoán).
- **expecting:** Base64 PNG vượt ngưỡng giới hạn body, xác nhận đúng nguyên nhân; nếu đổi sang JPEG nén + resize giống pattern mobile thì payload giảm xuống dưới ngưỡng.
- **next_action:** Xác minh độc lập bằng chứng (đo thử kích thước payload, xác nhận giới hạn Vercel áp dụng cho deployment này), sau đó trình bày fix cụ thể (resize + nén ảnh crop desktop, không đổi UI/luồng khác) để người dùng duyệt trước khi áp dụng.

## Evidence

(để trống — gsd-debugger điền tiếp)

## Eliminated

(để trống)

## Resolution

- **root_cause:** `getCroppedImg` (`src/utils/cropImage.ts`) encode ảnh crop desktop dưới dạng `canvas.toDataURL('image/png')` ở đúng độ phân giải gốc của ảnh upload, không resize/cap. PNG lossless của ảnh photographic độ phân giải cao tạo base64 rất lớn, gửi nguyên trong JSON body tới `POST /api/generate` → vượt giới hạn payload của Vercel Function → 413 FUNCTION_PAYLOAD_TOO_LARGE. Xác nhận thêm: `/api/generate` luôn resize lại face xuống tối đa ~256px trước khi dùng, nên độ phân giải gốc chưa từng thực sự cần thiết.
- **fix:** Trong `getCroppedImg`, sau khi crop tròn + tô nền trắng (không đổi), thêm bước resize canvas xuống tối đa `MAX_FACE_CROP_DIMENSION = 1200px` (chỉ thu nhỏ, không phóng to) trước khi encode, và đổi định dạng output từ PNG sang JPEG chất lượng 0.92 — khớp đúng pattern đã ổn định ở luồng mobile (`src/app/mobile-upload/page.tsx:82`), an toàn vì canvas không còn cần alpha channel (đã tô nền trắng đục).
- **verification:** `npm run build` pass (compile + TypeScript + static generation đều thành công). Chưa test thật qua UI với ảnh độ phân giải cao (cần người dùng xác nhận trên deployment thật).
- **files_changed:** `src/utils/cropImage.ts` (duy nhất — không đổi `CombineSection.tsx`, `/api/generate/route.ts`, hay luồng mobile).
