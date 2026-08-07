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

### Quy mô: giới hạn bởi ngân sách $4.63

Ngân sách Replicate khả dụng là **$4.63**, quyết định bởi người dùng ngày 2026-08-07. Toàn bộ quy mô pilot bị cắt theo đó.

| | Pilot (ngân sách $4.63) | Mở rộng (chỉ nếu pilot đạt, cần nạp thêm) |
|---|---|---|
| Tổ hợp sinh qua PRO | **30** (24 train @1MP + 6 held-out @2MP) | +300-500 |
| Vào vòng duyệt | 24 → giữ **~10-14** | ~250 |
| Thời gian duyệt tay | ~15 phút | ~2-3 tiếng |
| `training_steps` | **700** | 1000 |
| **Tổng** | **$2.20-4.40** | ~$40 |

Phân bổ chi tiết:

| Khoản | Ước tính |
|---|---|
| Hiệu chuẩn giá: 3 ảnh thử, rồi đối chiếu dashboard Replicate | $0.10-0.20 |
| Dữ liệu train: 24 tổ hợp @ 1MP | $0.70-1.45 |
| Baseline held-out: 6 tổ hợp @ 2MP (đúng cấu hình production) | $0.25-0.36 |
| Train 700 steps | $1.00-2.25 |
| Eval 6 lần qua LoRA | ~$0.12 |

Hai điều chỉnh so với thiết kế gốc:

- **Dữ liệu train sinh ở 1MP thay vì 2MP.** Canvas train chỉ 832×1472 (1.22 MP) nên không mất chi tiết nào; nếu Replicate tính tiền theo megapixel thì tiết kiệm một nửa. Riêng 6 ảnh held-out vẫn sinh ở 2MP với đúng tham số production, vì chúng là baseline để so sánh công bằng với PRO.
- **`training_steps` 700 thay vì 1000**, chừa biên an toàn cho khoản chi bất định nhất.

**Hàm chặn chi tiêu là bắt buộc**, không phải tuỳ chọn: mọi script gọi Replicate phải đếm số lần gọi, nhận `--max-spend`, và dừng cứng khi chạm trần. Sau 3 ảnh đầu tiên phải dừng lại để người dùng xác nhận giá thật trên dashboard trước khi tiêu tiếp — mọi con số trong bảng trên là **ước tính chưa xác minh** (Replicate không công bố giá `flux-2-pro` qua API lẫn trang pricing).

### Rủi ro đã được chấp nhận rõ ràng

24 tổ hợp, duyệt xong còn ~10-14 cặp — **đúng mức sàn của Kontext LoRA**. Nếu kết quả tệ, không phân biệt được là *phương pháp không chạy* hay *chỉ thiếu dữ liệu*, và không còn ngân sách train lần hai. Người dùng đã được thông báo và chọn tiến hành (2026-08-07).

Kể cả khi pilot đạt, độ phủ vẫn quá mỏng để kết luận "đủ tốt để bỏ PRO". Mở rộng dataset vẫn là điều kiện bắt buộc trước khi xoá PRO.

## 5. Train

`replicate/fast-flux-kontext-trainer`, version `26c877b4ec3988b7e8edc5840e61339c68f09913bb11e23c31566590fd92a66d`:

| Tham số | Giá trị | Lý do |
|---|---|---|
| `input_images` | zip từ bước 5 | |
| `training_steps` | **700** | cắt từ mặc định 1000 để chừa biên ngân sách; xem mục 4 |
| `seed` | `19826` | trùng seed đang dùng ở `/api/generate`, để train lại tái lập được |
| `kontext_prompt_instruction` | `assemble into a finished wristwatch product photo` | chốt cứng, dùng chung mọi ảnh |
| `hf_repo_id` / `hf_token` | repo riêng của bạn — **cần bạn tạo trước khi chạy** | **để sở hữu weights thật**, không bị khoá trong Replicate |

Thời gian ~20-40 phút.

Câu `kontext_prompt_instruction` ở trên là **hằng số dùng chung**, phải khai báo một chỗ duy nhất (`src/lib/generateEngines/lora.ts`) và được `train.ts` import lại — không chép tay hai nơi. Lệch một ký tự giữa lúc train và lúc chạy là mất tác dụng của LoRA.

## 6. Đo và tiêu chí đạt

`eval.ts` chạy **6 tổ hợp held-out** (chưa từng train) qua LoRA, dựng contact sheet 3 cột `draft | PRO | LoRA`, đồng thời ghi thời gian thực tế mỗi lần gọi kể cả cold start.

**Tiêu chí chốt trước khi nhìn kết quả** (để không tự thuyết phục mình), quy đổi theo cỡ mẫu 6:

1. Lỗi thảm hoạ (mất mặt số, dây tách đôi/rời, sót da tay) **≤ 1/6**
2. LoRA bằng hoặc hơn PRO về độ chính xác lắp ráp ở **≥ 4/6**
3. Vân và màu da của dây được giữ đúng ở **≥ 5/6**
4. Thời gian trung bình **< 15s** kể cả cold start

Cỡ mẫu 6 quá nhỏ để có ý nghĩa thống kê — nó chỉ đủ phát hiện hỏng nặng, không đủ để đo chênh lệch tinh tế. Đây là hệ quả trực tiếp của ngân sách, đã được chấp nhận.

Không đạt → dừng, giữ PRO, tổng thiệt hại dưới $4.63 và có câu trả lời rõ ràng.
Đạt → mở rộng dataset (cần nạp thêm tiền), train lại 1000 steps, đo lại bằng đúng 4 tiêu chí trên với held-out 60 mẫu.

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

**R3 — Ảnh dây có phông phức tạp. ĐÃ XẢY RA, đã xử lý (2026-08-07).**
Rủi ro này được ước lượng là "~10 trên 100 ảnh". Đo thực tế trên mẫu 30/443 sản phẩm: **30/30 là ảnh vuông dàn dựng**, không có ảnh nào là crop dọc sạch. Dây nằm chéo trên tấm da lớn, cuộn vải, hoặc đạo cụ khác chiếm phần lớn khung.

Hậu quả quan sát được trên 3 ảnh draft đầu tiên: mặt đồng hồ bị đặt theo khung *bức ảnh* chứ không theo *thân dây*, nên rơi ra giữa phông nền cách xa lugs; và toàn bộ đạo cụ bị nướng vào ảnh input mà LoRA sẽ phải học xoá.

*Đã xử lý bằng `scripts/dataset/prepare-straps.ts` + `src/lib/cropStrap.ts`:* cắt ảnh dây **một lần cho cả catalog, offline**, lưu kết quả lại; cả lúc train lẫn lúc phục vụ khách đều đọc ảnh đã sạch. Cùng mô hình với `/api/faces/sync` và `/api/woocommerce/sync` đang có.

Điểm quan trọng (theo yêu cầu của người dùng ngày 2026-08-07): **không có lời gọi vision nào ở thời điểm request.** Dịch vụ ngoài chỉ được dùng một lần lúc chuẩn bị catalog, không phải phụ thuộc thường trực khi chạy.

*Ghi chú vận hành:* Vercel AI Gateway free tier giới hạn **tốc độ theo phút**, không phải hết quota — gọi dồn sẽ lỗi `Free tier requests exceeded`, giãn nhịp ~8s/lần thì chạy bình thường.

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
| Pilot: sinh + duyệt + train + đo | **$2.20-4.40** (trần cứng $4.63) | ~30 phút | ~1-2 giờ |
| Mở rộng (nếu pilot đạt, cần nạp thêm) | ~$40 | ~3 tiếng | ~1 ngày |
| Chuyển đổi + xoá PRO | $0 | ~30 phút review | — |

Chi phí vận hành sau khi xong: ~$0.010-0.015/ảnh so với ~$0.04 hiện tại. Ở mức 500-5.000 lượt/tháng, tiết kiệm khoảng **$15-150/tháng**.
