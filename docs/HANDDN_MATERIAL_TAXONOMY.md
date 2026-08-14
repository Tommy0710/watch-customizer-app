# HANDDN material taxonomy for LoRA retraining

Nguồn domain chính là collection materials của HANDDN: 11 nhóm exotic và 20 nhóm phổ biến, gồm Alligator, Double Hornback Alligator, Python, Lizard, Stingray, Snake Sea, Ostrich, Shell Cordovan, Peccary, Black Diamond, Ostrich Leg, Shark, Sailcloth Rubber, Canvas, Alcantara, Patina Veg-Tanned, Saffiano, Epsom, Suede, Smooth Calf, Nubuck, Waxed và Waxed 2.0. Xem [HANDDN Collection Leather](https://handdn.com/shop/collection-leather/).

## Coverage hiện tại

Dataset captioned đang có khoảng 41 ảnh. Đã có đại diện cho: alligator, vachetta, pueblo/badalassi, habana, nubuck, peccary, epsom, babele, chevre, sully, vegetable-tanned, box calf, canvas, sailcloth/rubber và swift.

Các nhóm cần bổ sung rõ ràng trước vòng train tiếp theo:

- Python.
- Suede.
- Ostrich và Ostrich Leg.
- Lizard.
- Stingray.
- Shell Cordovan.
- Shark và Sea Snake.
- Saffiano, Epi và Black Diamond.
- Alcantara.
- Alligator theo nhiều pattern: belly, round scale, hornback, lining/mix.

## Data contract cho mỗi material

Mỗi nhóm mới cần tối thiểu 8–12 ảnh đã duyệt, gồm ít nhất 3 màu và 2 construction styles. Caption phải ghi rõ material, màu, texture/pattern, stitch và padding; không chỉ ghi tên sản phẩm.

Mỗi material phải có held-out examples riêng. Không dùng cùng một product family cho cả train và held-out nếu mục tiêu là kiểm tra generalization.

## Quy tắc đặc biệt cho 56035

`56035 Duocolor Forest Suede Red Alran Sully` có màu/pattern đạt nhưng clean render hiện có tỷ lệ buckle-side khoảng 50%, không đạt quality gate khoảng 38% ± 6%. Không nới gate để cho chạy production; cần tạo lại clean render đúng hình học trước khi đưa sample này vào retraining.

## Tham chiếu mô tả vật liệu

- [Regular Leather](https://handdn.com/shop/regular-leather-watch-straps/) — HANDDN mô tả nhóm regular chủ yếu là calfskin và goatskin.
- [Epsom](https://handdn.com/product/black-epsom-leather-watch-strap/) — leather ép grain, bền, nhẹ và dễ vệ sinh.
- [Nubuck](https://handdn.com/product/navy-nubuck-leather-watch-strap/) — top-grain được sanding để tạo cảm giác mềm như velvet.
- [Saffiano](https://handdn.com/product/black-saffiano-leather-watch-strap/) — bề mặt wax-coated với pattern đặc trưng.
- [Epi](https://handdn.com/product/black-epi-leather-watch-strap/) — pattern dạng wave được emboss.
