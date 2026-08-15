# HANDDN LoRA runbook

## Tạo dataset

Đồng bộ catalog trước khi sampling. Sync lưu cả `stockStatus`; UI vẫn chỉ hiển thị sản phẩm đang
có hàng. Dataset chỉ giữ product hết hàng nếu material family đó vẫn còn ít nhất một SKU đang bán;
nếu toàn bộ family đã out-of-stock thì loại khỏi train hoàn toàn:

```bash
curl http://localhost:3000/api/woocommerce/sync
npm run ds -- scripts/dataset/sample-combos.ts --include-out-of-stock --train=200 --heldout=36
```

```bash
npm run ds -- scripts/dataset/selectCombos.ts
npm run ds -- scripts/dataset/prepare-straps.ts
npm run ds -- scripts/dataset/generate-pairs.ts --set=train --max-spend=1.50
npm run ds -- scripts/dataset/build-contact-sheet.ts
npm run ds -- scripts/dataset/material-coverage.ts
npm run ds -- scripts/dataset/material-readiness.ts
```

Review contact sheet thủ công. Chỉ đưa các pair đạt chuẩn vào `scripts/dataset/out/approved.json`.
`material-coverage.json` phải được xem cùng contact sheet: family nào thiếu mẫu thì chưa được coi là
đã được model học. `productOverlap` phải bằng 0 cho held-out dùng để đo generalisation; nếu khác 0,
đó chỉ là smoke test chứ không phải benchmark sạch.

`material-readiness.ts` chỉ báo thiếu clean render và không gọi dịch vụ trả phí. Chỉ chạy pack sau
khi đã review/hoàn thiện các product train cần thiết.

`--include-out-of-stock` chỉ bổ sung SKU hết hàng thuộc các family còn active. Nó không đưa một
family đã hết hàng toàn bộ quay lại dataset. Danh sách family active được ghi vào `combos.json`
và dùng để tính `material-coverage.json`.

## Pack và train

Chạy preflight local trước mọi thao tác có thể tính phí:

```bash
node --import tsx scripts/dataset/audit-material-coverage.ts
node --import tsx scripts/dataset/train-style.ts --dry-run
```

Preflight phải pass product-disjoint train/held-out và không được có material bucket chỉ xuất
hiện ở held-out. Artifact hiện tại đang fail do product leakage; không dùng nó làm bằng chứng
generalisation cho tới khi tạo lại `combos.json`.

```bash
npm run ds -- scripts/dataset/pack-dataset.ts
npm run ds -- scripts/dataset/pack-style-dataset.ts
npm run ds -- scripts/dataset/train-style.ts --steps=1000 --confirm-paid
npm run ds:manifest -- --label=pilot-1
```

`pack-dataset.ts` sẽ dừng nếu thiếu `approved.json`. Chỉ dùng `--allow-unreviewed` cho thử nghiệm local không dùng weights để phục vụ khách hàng.
`train-style.ts` luôn chặn paid job nếu thiếu cả `--confirm-paid` và `ALLOW_PAID_TRAINING=1`.

Vòng train material-aware phải bật cùng một prompt contract ở lúc train/eval/serve:

```bash
REPLICATE_LORA_PROMPT_SCHEMA=material-v2 \
ALLOW_PAID_TRAINING=1 \
npm run ds -- scripts/dataset/train-style.ts --steps=1000 --confirm-paid
```

Không bật `material-v2` cho weights cũ: weights hiện tại dùng schema `legacy`. Ghi schema vào
run manifest và chỉ rollout weights mới sau khi evaluation dùng cùng schema.

## Evaluate

Dry-run không lookup weights và không gửi generation request:

```bash
node --import tsx scripts/dataset/eval-style.ts --dry-run
```

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

### Smoke-test toàn catalog (chỉ dùng tạm thời)

Để thử LoRA trên cả những dây chưa có clean render, đặt `LORA_TEST_MODE=force` ở môi trường
production. Chế độ này dùng ảnh catalog làm draft thay thế, đánh dấu response là `loraTestMode=force`
và vẫn fallback PRO nếu LoRA lỗi. Chất lượng không được coi là benchmark vì draft catalog nằm ngoài
phân phối train. Xóa biến này sau khi test để quay về gate chuẩn.

```bash
GENERATE_ENGINE=lora LORA_TEST_MODE=force
```

Không bật `REPLICATE_LORA_PROMPT_SCHEMA=material-v2` với weights cũ; weights production hiện tại
dùng `legacy`. Chỉ bật schema mới sau khi train và evaluate weights mới.

Không gỡ PRO cho tới khi pilot và canary đều đạt ngưỡng chất lượng.

## Retraining

Khi thêm nhóm dây mới:

1. Xác định bucket construction chưa được phủ.
2. Tạo pair đại diện và held-out pair riêng.
3. Review màu, texture, hình học và assembly.
4. Train với manifest mới.
5. Evaluate trên regression set cũ và held-out set mới.
6. Chỉ thay weights sau khi không có regression brand-critical.
