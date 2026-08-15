# HANDDN material taxonomy — research brief

Snapshot: 2026-08-14. Đây là vocabulary phục vụ captioning và chia train/held-out cho LoRA,
không phải khẳng định về tannery hay thành phần hóa học nếu HANDDN không công bố.

## Taxonomy chốt

Mỗi sample nên có các trường độc lập:

| Trường | Giá trị / cách dùng |
|---|---|
| `family` | `alligator`, `hornback-alligator`, `python`, `sea-snake`, `lizard`, `ostrich`, `ostrich-leg`, `stingray`, `shark`, `peccary`, `shell-cordovan`, `calfskin`, `goatskin`, `canvas`, `rubber`, `alcantara`, `mixed` |
| `material` | Nhãn HANDDN: `epsom`, `saffiano`, `epi`, `nubuck`, `suede`, `box-calf`, `swift`, `togo`, `vachetta`, `pueblo`, `waxed`, `habana`, `chevre-sully`,… |
| `finish/pattern` | `pressed-grain`, `embossed-wave`, `sanded-velvet`, `smooth`, `wax-coated`, `patina`, `woven`, `rubber-textured`, cùng pattern `belly-scales`, `round-scales`, `hornback-ridges`, `quill-follicles`, `leg-scales` khi nhìn thấy rõ |
| `construction` | `classic`, `vintage`, `padded`, `double-padded`, `curved-end`, `folded-edge`, `rally`, `pilot`, `bund`, `nato`, `single-folding`, `mixed-material` |
| `color` | `primary`, tùy chọn `secondary`; giữ tên màu gốc của sản phẩm và thêm hue chuẩn hóa để cân bằng dataset |
| `lining` | Ghi riêng material/label của lining; không suy ra từ mặt chính |

## Quy tắc train

- Không gộp material, finish, color và construction thành một class duy nhất.
- Duocolor dùng `primary_color` + `secondary_color`.
- `Sailcloth mix Alligator` phải ghi rõ alligator cap và canvas/fabric body; không caption như
  một material đồng nhất.
- Exotic cần giữ riêng theo species/pattern; không dùng token chung `exotic` thay cho material.
- Mỗi material/finish cell nên có 8–12 ảnh sạch, tối thiểu 3 màu và 2 construction styles khi
  catalog cho phép; exotic hiếm được ưu tiên đa dạng góc/crop.
- Held-out phải tách theo product family, không dùng lại cùng source product trong train.

## Nguồn đã kiểm chứng

- [HANDDN Collection Leather](https://handdn.com/shop/collection-leather/) — vocabulary các
  nhóm exotic, leather finish và non-leather/composite.
- [HANDDN Regular Leather](https://handdn.com/shop/regular-leather-watch-straps/) — các nhãn
  product/filter như Alran Chevre, Babele, Pueblo, Box Calf, Habana, Swift, Togo, Vachetta.
- [HANDDN Non-Leather](https://handdn.com/shop/non-leather-watch-straps/) — Canvas/Sailcloth và
  Alcantara; product pages mô tả Sailcloth Rubber/FKM.
- [HANDDN Classic Straps](https://handdn.com/shop/classic-watch-straps/) — construction/style
  labels như Classic, Vintage, Curved End, Rally, Pilot, Bund và NATO.
- [Epsom](https://handdn.com/product/black-epsom-leather-watch-strap/),
  [Nubuck](https://handdn.com/product/navy-nubuck-leather-watch-strap/),
  [Epi](https://handdn.com/product/rally-black-epi-leather-watch-strap/) — các mô tả finish/pattern.
- [Duocolor](https://handdn.com/product/duocolor-navy-alran-sully-leather-apple-watch-band/)
  và [mixed face/lining](https://handdn.com/product/black-ostrich-lining-black-alligator-leather-apple-watch-band/)
  — bằng chứng cho hai màu và material mặt chính/lining khác nhau.

## Giới hạn

Product counts trên HANDDN là dữ liệu live, chỉ dùng ưu tiên coverage; không coi là số lượng ảnh
train. Nếu metadata không xác nhận finish/pattern, ghi `unknown` thay vì đoán từ tên hoặc ảnh.

## Catalog sync checkpoint — 2026-08-14

- MongoDB hiện có 443 sản phẩm đủ điều kiện cho configurator và 7.881 face records.
- Split mới đã đạt 200 train products / 36 held-out products, product overlap = 0.
- `Sea Snake` không xuất hiện trong tên hoặc category của catalog sync hiện tại. Đây là blocker
  dữ liệu cần xử lý bằng WooCommerce/catalog sync trước khi có thể claim coverage cho Sea Snake;
  không dùng ảnh bên ngoài để lấp vào dataset HANDDN.
