# HANDDN Watch AI — chương trình LoRA

## Mục tiêu

Tạo một visual configurator chuyên về đồng hồ cho HANDDN: kết hợp dây và mặt đồng hồ thành ảnh studio nhất quán, giữ đúng hình học, màu, vật liệu và chi tiết sản phẩm.

Phạm vi hiện tại là visual configurator. Chatbot tư vấn, catalog intelligence và domain assistant sẽ là các chương trình riêng.

## Trạng thái repo

- Đã có draft builder chuẩn hóa và segmented draft cho training/serving.
- Đã có sampling, pair generation, review contact sheet, dataset packing, training và evaluation scripts.
- Production route đã có LoRA opt-in và fallback về PRO.
- Weights có thể lấy từ Replicate hoặc S3 presigned URL; URL S3 được cache trong warm process để tránh tải lại weights không cần thiết.
- Worktree có các thay đổi LoRA chưa commit; không được reset hoặc overwrite khi tiếp tục triển khai.

## Quyết định kỹ thuật hiện tại

1. PRO vẫn là fallback và baseline chất lượng.
2. LoRA chỉ chạy khi có clean render đạt chuẩn và draft đạt `DraftAssessment`.
3. Dataset phải có `approved.json`; thiếu review sẽ chặn packing, trừ khi chạy thử cục bộ với `--allow-unreviewed`.
4. Mỗi run phải tạo `run-manifest-*.json`, gồm dataset hash, training output, combo split và serving config.
5. Model/weights/seed/prompt strength có thể override bằng environment nhưng có default ổn định trong `src/lib/loraConfig.ts`.

## Go / no-go pilot

Go khi toàn bộ điều kiện sau đạt:

- Catastrophic failure không quá 1/6.
- LoRA ngang hoặc hơn PRO về assembly tối thiểu 4/6.
- Màu và texture dây đúng tối thiểu 5/6.
- Mean latency dưới 15 giây.
- Fallback và rollback đã được kiểm tra.

No-go nếu lỗi tập trung ở dữ liệu, draft geometry, model serving hoặc brand fidelity. Khi đó giữ PRO, phân loại lỗi và retrain/đổi trainer có kiểm soát.

## Rủi ro chính

- Model/trainer bên ngoài thay đổi hoặc không phục vụ private weights ổn định.
- Clean render không đủ coverage cho catalog.
- Dataset ít mẫu khiến LoRA tốt trong vùng train nhưng hỏng ngoài phân phối.
- Draft sai hình học sẽ bị model học lại thành lỗi.
- Ảnh đẹp nhưng sai màu/chất liệu gây rủi ro thương mại cho HANDDN.
