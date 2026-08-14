# HANDDN LoRA runbook

## Tạo dataset

```bash
npm run ds -- scripts/dataset/selectCombos.ts
npm run ds -- scripts/dataset/prepare-straps.ts
npm run ds -- scripts/dataset/generate-pairs.ts --set=train --max-spend=1.50
npm run ds -- scripts/dataset/build-contact-sheet.ts
```

Review contact sheet thủ công. Chỉ đưa các pair đạt chuẩn vào `scripts/dataset/out/approved.json`.

## Pack và train

```bash
npm run ds -- scripts/dataset/pack-dataset.ts
npm run ds -- scripts/dataset/pack-style-dataset.ts
npm run ds -- scripts/dataset/train-style.ts --steps=1000
npm run ds:manifest -- --label=pilot-1
```

`pack-dataset.ts` sẽ dừng nếu thiếu `approved.json`. Chỉ dùng `--allow-unreviewed` cho thử nghiệm local không dùng weights để phục vụ khách hàng.

## Evaluate

```bash
npm run ds:eval-style -- --strength=0.35 --label=watch-lora-v2-035 --max-spend=0.40
npm run ds:eval-style -- --strength=0.45 --label=watch-lora-v2-045 --draft-source=watch-lora-v2-035 --delay-ms=15000 --max-spend=0.40
npm run ds:manifest -- --label=pilot-1-evaluated --evaluation-label=watch-lora-v2-045
```

Review `scripts/dataset/out/eval-*.html` theo rubric: assembly, strap fidelity, dial/case fidelity, geometry, artifact rate, latency và cost. Evaluator dùng weights S3 mới được presign, lưu progress từng case và retry được lỗi 429/5xx.

## Production rollout

1. Đặt `REPLICATE_LORA_MODEL` và `REPLICATE_LORA_WEIGHTS` ở environment của deployment.
2. Giữ `GENERATE_ENGINE=pro` để baseline.
3. Chạy canary với `GENERATE_ENGINE=lora` trên traffic nhỏ.
4. Theo dõi engine, latency, lỗi LoRA, fallback rate và feedback ảnh.
5. Rollback bằng cách đặt `GENERATE_ENGINE=pro` hoặc xóa weights.

Không gỡ PRO cho tới khi pilot và canary đều đạt ngưỡng chất lượng.

## Retraining

Khi thêm nhóm dây mới:

1. Xác định bucket construction chưa được phủ.
2. Tạo pair đại diện và held-out pair riêng.
3. Review màu, texture, hình học và assembly.
4. Train với manifest mới.
5. Evaluate trên regression set cũ và held-out set mới.
6. Chỉ thay weights sau khi không có regression brand-critical.
