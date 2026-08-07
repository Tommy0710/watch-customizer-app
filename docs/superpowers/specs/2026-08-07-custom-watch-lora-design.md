# Thiết kế: Model riêng (Kontext LoRA) thay thế FLUX-2-PRO

**Ngày:** 2026-08-07
**Trạng thái:** Chờ duyệt
**Phạm vi:** Thay `black-forest-labs/flux-2-pro` trong `/api/generate` bằng một LoRA tự train trên `black-forest-labs/flux-kontext-dev-lora`, chưng cất từ chính output của PRO.

---

## 1. Mục tiêu

Bốn mục tiêu, theo thứ tự ưu tiên đã thống nhất:

1. **Ổn định** — cùng input phải ra cùng kết quả; loại bỏ sự bất định do prompt tự mâu thuẫn
2. **Kiểm soát** — sở hữu weights, không phụ thuộc BFL đổi model/giá/safety-filter
3. **Chi phí** — giảm từ ~$0.04/ảnh xuống ~$0.010-0.015/ảnh
4. **Tốc độ** — giảm thời gian chờ của khách

**Không phải mục tiêu:** vượt PRO về chất lượng. LoRA chưng cất từ PRO có trần chất lượng bằng PRO. Muốn vượt cần ảnh chụp thật hoặc ground-truth sửa tay — để lại cho v2.

## 2. Ràng buộc đã xác minh

Truy vấn trực tiếp Replicate API ngày 2026-08-07:

| Model | LoRA | Ảnh input | Kết luận |
|---|---|---|---|
| `black-forest-labs/flux-2-pro` | ❌ closed | nhiều | Không train được |
| `black-forest-labs/flux-2-dev` | ❌ không có `lora_weights` | nhiều (`input_images`) | Chưa nạp được LoRA trên Replicate |
| `black-forest-labs/flux-kontext-dev-lora` | ✅ `lora_weights`, `lora_strength` | **1** (`input_image`) | **Đường khả thi duy nhất** |
| `replicate/fast-flux-kontext-trainer` | — | zip cặp before/after | Trainer sẽ dùng |

Định dạng dataset của trainer (từ schema): zip chứa mỗi cặp là `x_start.jpg` (before) + `x_end.jpg` (after), caption `x.txt` tuỳ chọn. Nếu không có caption thì dùng `kontext_prompt_instruction` chung. `training_steps` mặc định 1000 (min 100, max 20000). Output: `weights` (URI) + `validation_images`.

Giá GPU Replicate: H100 $0.001525/s. `flux-kontext-dev-lora` predict_time trung bình đo được **4.40s**; `flux-2-pro` **5.59s** (chưa tính hàng đợi).

Ràng buộc từ `PROJECT.md` được tôn trọng: không thêm dịch vụ ngoài (dùng lại S3 + MongoDB + Replicate + AI Gateway đã có), UI khách hàng đóng băng (công cụ duyệt là file HTML tĩnh chạy local, không phải route trong app).

## 3. Kiến trúc

### 3.1 Đảo chiều pipeline

```
Hiện tại:  strap + face → 3 ảnh reference + prompt ~2000 ký tự → PRO vẽ lại từ đầu
Sau này:   strap + face → 1 ảnh draft chuẩn hoá → LoRA làm sạch mối nối
```

Kontext là *edit model*: nó giữ ảnh input và chỉ sửa phần được yêu cầu. Hệ quả: **ảnh draft quyết định ~90% kết quả**, thay vì chỉ là gợi ý bố cục như hiện nay.

### 3.2 Ba nguyên tắc bắt buộc

**a. Canvas draft cố định.** Hiện draft dựng theo kích thước ảnh dây gốc (mỗi sản phẩm một tỷ lệ), trong khi output ép cứng `aspect_ratio: "9:16"`. Với PRO không sao; với Kontext thì output kế thừa hình học của input, nên mọi draft phải cùng một khung.

Quy cách canvas:
- Kích thước **832 × 1472** (9:16, ≈1.22 MP, cả hai chiều chia hết cho 16)
- Nền trắng đặc `rgb(255,255,255)`
- Ảnh dây scale-to-fit vào vùng an toàn (margin 6% mỗi cạnh), giữ tỷ lệ, không phóng to quá kích thước gốc
- Mặt đồng hồ: bề rộng `= 0.16 × bề rộng dây sau khi scale` (giữ nguyên `FACE_TO_STRAP_WIDTH_RATIO`)
- Tâm mặt đồng hồ theo trục dọc `= 0.30 × chiều cao dây sau khi scale`, tính từ mép trên của dây (giữ nguyên `SHORT_END_TOP_RATIO`)
- Xuất PNG (không JPEG — lý do chroma subsampling làm hỏng vân da đã ghi trong `CLAUDE.md`)

**b. Một hàm dựng draft duy nhất.** Tách khỏi route thành `src/lib/draftComposite.ts`. Script tạo dataset và route production **phải gọi đúng hàm này**. Lệch nhau dù vài pixel sẽ gây train/serve skew — model vẫn chạy, chỉ là kết quả tệ không rõ nguyên nhân, rất khó chẩn đoán.

**c. PRO không bị gỡ cho tới khi đo xong.** Thêm `GENERATE_ENGINE=pro|lora` làm công tắc **tạm thời** cho giai đoạn chuyển đổi. Đường PRO giữ nguyên từng ký tự (ràng buộc "AI pipeline must not regress"). Sau khi mở rộng dataset và đo đạt, xoá hẳn đường PRO khỏi request path.

`scripts/dataset/` **được giữ lại vĩnh viễn** kể cả sau khi xoá PRO: khi nhập dòng dây mới mà LoRA chưa từng thấy, cần PRO để sinh thêm dữ liệu và train lại.

### 3.3 Module

| File | Trách nhiệm |
|---|---|
| `src/lib/draftComposite.ts` | Dựng ảnh draft chuẩn hoá — nguồn sự thật duy nhất |
| `src/lib/generateEngines/pro.ts` | Đường PRO hiện tại, bê nguyên, xoá ở phase cuối |
| `src/lib/generateEngines/lora.ts` | Gọi `flux-kontext-dev-lora` với `lora_weights` |
| `scripts/dataset/sample-combos.ts` | Chọn tổ hợp phủ đều |
| `scripts/dataset/generate-pairs.ts` | Sinh cặp before/after qua PRO |
| `scripts/dataset/align-pairs.ts` | Căn chỉnh hình học before↔after |
| `scripts/dataset/build-contact-sheet.ts` | Sinh HTML duyệt tay |
| `scripts/dataset/pack-dataset.ts` | Đóng zip đúng định dạng trainer |
| `scripts/dataset/train.ts` | Gọi trainer |
| `scripts/dataset/eval.ts` | Đo trên held-out, dựng bảng so sánh |

## 4. Đường ống dataset

Kontext học tốt nhất khi cặp before/after **khớp nhau về hình học** — cùng khung, cùng vị trí, cùng tỷ lệ, chỉ khác ở chỗ được sửa. Nếu PRO trả ảnh đồng hồ lệch chỗ hoặc sai tỷ lệ so với draft, LoRA phải học thêm một phép biến hình, kết quả nhoè và bất định.

**Bước 1 — Chọn tổ hợp.** Không lấy ngẫu nhiên. Phủ đều theo `classifyStrap`: padded/không, curved-end/không, từng kiểu stitch, cả hai category `Classic`/`Vintage`. Mặt đồng hồ phủ đều theo brand folder trong S3. Cố ý đưa vào **~10 mẫu dây có ảnh nền phức tạp** (dây chụp trên tấm da lớn làm phông) để biết đây có phải vấn đề không — xem mục Rủi ro R3.

**Bước 2 — Sinh.** Dựng draft bằng `draftComposite.ts`, gọi PRO với đúng prompt/tham số hiện tại, lưu cả before và after lên S3 (`training/before/`, `training/after/`), metadata vào MongoDB collection `training_pairs`. Chạy song song 5 luồng, có resume để đứt giữa chừng không mất tiền.

**Bước 3 — Căn chỉnh.** Dùng lại đúng model `openai/gpt-5-nano` đã có trong `cropToWatchFace` để đo bounding box đồng hồ trong cả draft lẫn output PRO, rồi scale/dịch output về khớp draft. Không thêm dịch vụ, ~$0.0002/ảnh. Cặp lệch quá ngưỡng bị đánh dấu loại tự động.

**Bước 4 — Duyệt tay.** Sinh file HTML tĩnh, mở bằng trình duyệt, hiện before | after cạnh nhau, phím `J` = giữ / `K` = loại, export JSON danh sách đã duyệt. Không đụng vào app.

Tiêu chí loại (nghiêm, vì LoRA học đúng cái được duyệt):
- Mặt số bị vẽ lại thay vì sao chép
- Màu/vân da của dây sai lệch so với ảnh gốc
- Dây tách đôi, rời khỏi vỏ, hoặc không xuyên qua lugs
- Tỷ lệ đoạn buckle / đoạn tail sai rõ rệt
- Còn sót ngón tay, da người, hoặc dây gốc của mặt đồng hồ

**Bước 5 — Đóng gói.** Zip theo `x_start.jpg` / `x_end.jpg`. Không dùng caption riêng; dùng `kontext_prompt_instruction` cố định.

### Quy mô: pilot trước, mở rộng sau

| | Pilot (làm ngay) | Mở rộng (chỉ nếu pilot đạt) |
|---|---|---|
| Tổ hợp sinh qua PRO | 100 | +300-500 |
| Giữ riêng làm held-out | 15 | 60 |
| Vào vòng duyệt | 85 → giữ ~45 | ~250 |
| Thời gian duyệt tay | ~45 phút | ~2-3 tiếng |
| Chi phí PRO | ~$4-6 | ~$20-30 |
| Chi phí train | ~$3-6 | ~$5-10 |
| **Tổng** | **< $15** | ~$40 |

~45 cặp nằm trong vùng chạy được của Kontext LoRA vì đây là **một phép biến hình duy nhất lặp lại**, không phải học nhiều khái niệm. Nhưng độ phủ mỏng, nên pilot chỉ trả lời được "cách này có chạy không", **chưa** trả lời được "đã đủ tốt để bỏ PRO chưa". Mở rộng dataset là điều kiện bắt buộc trước khi xoá PRO.

## 5. Train

`replicate/fast-flux-kontext-trainer`, version `26c877b4ec3988b7e8edc5840e61339c68f09913bb11e23c31566590fd92a66d`:

| Tham số | Giá trị | Lý do |
|---|---|---|
| `input_images` | zip từ bước 5 | |
| `training_steps` | 1000 | mặc định, hợp với ~45 cặp; tăng có nguy cơ overfit |
| `seed` | `19826` | trùng seed đang dùng ở `/api/generate`, để train lại tái lập được |
| `kontext_prompt_instruction` | `assemble into a finished wristwatch product photo` | chốt cứng, dùng chung mọi ảnh |
| `hf_repo_id` / `hf_token` | repo riêng của bạn — **cần bạn tạo trước khi chạy** | **để sở hữu weights thật**, không bị khoá trong Replicate |

Thời gian ~20-40 phút.

Câu `kontext_prompt_instruction` ở trên là **hằng số dùng chung**, phải khai báo một chỗ duy nhất (`src/lib/generateEngines/lora.ts`) và được `train.ts` import lại — không chép tay hai nơi. Lệch một ký tự giữa lúc train và lúc chạy là mất tác dụng của LoRA.

## 6. Đo và tiêu chí đạt

`eval.ts` chạy 15 tổ hợp held-out (chưa từng train) qua LoRA, dựng contact sheet 3 cột `draft | PRO | LoRA`, đồng thời ghi thời gian thực tế mỗi lần gọi kể cả cold start.

**Tiêu chí chốt trước khi nhìn kết quả** (để không tự thuyết phục mình):

1. Lỗi thảm hoạ (mất mặt số, dây tách đôi/rời, sót da tay) **≤ 1/15**
2. LoRA bằng hoặc hơn PRO về độ chính xác lắp ráp ở **≥ 10/15**
3. Vân và màu da của dây được giữ đúng ở **≥ 13/15**
4. Thời gian trung bình **< 15s** kể cả cold start

Không đạt → dừng, giữ PRO, tổng thiệt hại dưới $15 và có câu trả lời rõ ràng.
Đạt → mở rộng dataset, train lại, đo lại bằng đúng 4 tiêu chí trên với held-out 60 mẫu.

## 7. Chuyển đổi và xoá PRO

Chỉ thực hiện sau khi vòng mở rộng đã đo đạt:

1. Bật `GENERATE_ENGINE=lora`, chạy song song một thời gian, theo dõi log
2. Xoá `generateEngines/pro.ts`, prompt ~2000 ký tự, ba ảnh reference, `strapProfile` khỏi request path
3. Xoá cờ `GENERATE_ENGINE`
4. Giữ nguyên `scripts/dataset/` và tài liệu quy trình train lại

Sau bước này `/api/generate` còn khoảng 1/3 kích thước hiện tại.

**Quy trình train lại khi nhập dòng dây mới** (viết thành checklist trong repo): dây thuộc nhóm `classifyStrap` chưa từng train → sinh thêm ~50 cặp → duyệt → train lại → đo → thay `lora_weights`. Chi phí mỗi vòng ~$5-10.

## 8. Rủi ro

**R1 — Ổn định không đồng nghĩa với đúng.** Model sẽ ổn định tái tạo *trung bình của dataset*. Nếu 20% cặp được duyệt có tỷ lệ buckle sai nhẹ, model sẽ sai đúng chừng đó ở mọi lần. Lỗi ngẫu nhiên dễ phát hiện, lỗi ổn định thì quen mắt rồi bỏ qua.
*Giảm thiểu:* tiêu chí loại nghiêm ở bước 4; held-out không bao giờ dùng để train.

**R2 — Ổn định chỉ nằm trong vùng đã phủ.** PRO có kiến thức tổng quát; LoRA ~45-250 mẫu thì không. Gặp chất liệu/kiểu dây lạ, LoRA có thể hỏng nặng hơn PRO — và sau khi xoá PRO thì không còn đường lui.
*Giảm thiểu:* chọn tổ hợp phủ đều thay vì lấy nhiều; quy trình train lại ở mục 7; chỉ xoá PRO sau vòng mở rộng.

**R3 — Ảnh dây có phông phức tạp.** Prompt hiện tại có cả một đoạn dài dạy PRO bỏ qua các tấm da lớn dùng làm phông. Với draft một ảnh, phông đó nằm luôn trong input và LoRA phải học cách xoá — khó hơn.
*Giảm thiểu:* cố ý đưa ~10 mẫu loại này vào pilot để đo. Nếu hỏng, phương án dự phòng là dùng `gpt-5-nano` crop dây ra khỏi phông trước khi composite, đối xứng với `cropToWatchFace` đã có.

**R4 — Mất chi tiết mặt số.** Hiện ảnh reference thứ 3 cấp chi tiết mặt số độ phân giải cao. Draft một ảnh chỉ có mặt số ở ~16% bề rộng.
*Đánh giá:* output 9:16 cũng chỉ hiển thị mặt số ở cỡ tương đương, nên về lý thuyết đủ. *Giảm thiểu:* đo cụ thể ở tiêu chí eval; nếu hỏng, phương án dự phòng là draft hai panel (draft + inset mặt số độ phân giải cao), đổi lại mất độ phân giải tổng thể.

**R5 — Cold start.** Model riêng trên Replicate tính tiền theo giây hoạt động; cold start có thể nuốt hết phần tiết kiệm và làm hỏng mục tiêu tốc độ.
*Giảm thiểu:* tiêu chí eval số 4 đo đúng thứ này, gồm cả cold start.

**R6 — Train/serve skew.** Nêu ở mục 3.2b.
*Giảm thiểu:* một hàm `draftComposite.ts` duy nhất; thêm unit test khoá hình học của nó (khớp với Phase 3 trong roadmap hiện có).

## 9. Ngoài phạm vi

- Vượt chất lượng PRO (cần ảnh chụp thật / ground-truth sửa tay — v2)
- Tự host GPU (vi phạm ràng buộc "không thêm dịch vụ ngoài")
- Đổi UI khách hàng (đóng băng theo `PROJECT.md`)
- Thu thập dữ liệu từ production kèm nút rate của khách (cân nhắc sau, khi app đã live)

## 10. Ước tính

| Giai đoạn | Chi phí | Thời gian của bạn | Thời gian chờ |
|---|---|---|---|
| Pilot: sinh + duyệt + train + đo | < $15 | ~1 tiếng | ~2-3 giờ |
| Mở rộng (nếu pilot đạt) | ~$40 | ~3 tiếng | ~1 ngày |
| Chuyển đổi + xoá PRO | $0 | ~30 phút review | — |

Chi phí vận hành sau khi xong: ~$0.010-0.015/ảnh so với ~$0.04 hiện tại. Ở mức 500-5.000 lượt/tháng, tiết kiệm khoảng **$15-150/tháng**.
