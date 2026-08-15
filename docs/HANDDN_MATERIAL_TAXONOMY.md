# HANDDN material taxonomy for LoRA retraining

> Snapshot researched 2026-08-14. Product counts and filters on HANDDN are live and may
> change; the names below are the public labels observed on the linked pages, not a claim that
> every label is a distinct tannery or animal species.

Nguồn domain chính là collection materials của HANDDN. Trang này hiện liệt kê các nhãn:

- Exotic / animal-origin: `Alligator`, `Double Hornback Alligator`, `Python Leather`, `Lizard`,
  `Stingray`, `Snake Sea`, `Ostrich`, `Ostrich Leg`, `Shell Cordovan`, `Peccary`, `Black
  Diamond`, `Shark`.
- Leather / tannery or finish labels: `Patina Veg-Tanned`, `Saffiano`, `Epsom`, `Suede`,
  `Smooth Calf`, `Nubuck`, `Waxed`, `Waxed 2.0`.
- Non-leather or composite labels: `Sailcloth Rubber`, `Canvas`, `Alcantara`, plus
  `Sailcloth mix Alligator`.

The public regular-leather filter exposes additional product-facing labels that must not be
collapsed into the groups above: `Alran Chevre (Fat nat)`, `Alran Chevre (Sully)`, `Babele
Calfskin`, `Badalassi Carlo Pueblo`, `Badalassi Carlo Waxed`, `Box Calfskin`, `Crazy Horse`,
`Habana`, `Maya Calfskin`, `Barenia`, `Swift`, `Togo`, `Vachetta`, and `Vegetable Tanned`.
These are useful training labels because they occur in product names/filters, even when the
collection page groups them under a broader family. See [Collection Leather](https://handdn.com/shop/collection-leather/),
[All Watch Straps](https://handdn.com/shop/), and [Regular Leather](https://handdn.com/shop/regular-leather-watch-straps/).

## Operational taxonomy

Use one structured caption with independent fields. Do not encode all fields as one flat
material class: `Epsom + padded + navy` is a different training example from `Epsom + vintage
+ tan`, but both still teach Epsom's pressed-grain identity.

| Field | Controlled values / examples | Annotation rule |
|---|---|---|
| `family` | `alligator`, `hornback-alligator`, `python`, `sea-snake`, `lizard`, `ostrich`, `ostrich-leg`, `stingray`, `shark`, `peccary`, `shell-cordovan`, `calfskin`, `goatskin`, `other-leather`, `canvas`, `alcantara`, `rubber`, `mixed` | What the main visible surface is made from. Keep exotic species separate. |
| `material` | `epsom`, `saffiano`, `epi`, `nubuck`, `suede`, `smooth-calf`, `box-calf`, `swift`, `togo`, `vachetta`, `pueblo`, `waxed`, `habana`, `chevre-sully`, etc. | Use the HANDDN product/filter label when available; otherwise use `unknown`, not a visual guess. |
| `finish` | `pressed-grain`, `embossed-wave`, `sanded-velvet`, `smooth`, `wax-coated`, `patina`, `natural-grain`, `woven`, `rubber-matte`, `rubber-textured` | Surface treatment/appearance, independent from species or base leather. |
| `pattern` | `belly-scales`, `round-scales`, `hornback-ridges`, `quill-follicles`, `leg-scales`, `pebbled`, `fine-diagonal`, `wave`, `plain`, `woven`, `stingray-granules` | Describe the repeatable visual motif visible at the crop scale. Do not infer a species from pattern alone. |
| `construction` | `classic`, `vintage`, `padded`, `double-padded`, `curved-end`, `folded-edge`, `rally`, `pilot`, `bund`, `nato`, `single-folding`, `mixed-material` | Source from WooCommerce attributes/name where present. This maps to `classifyStrap` and must remain separate from material. |
| `color` | `primary`, optional `secondary`, plus normalized hue family (`black`, `brown`, `blue`, `green`, `red`, `grey`, `beige`, `white`, `yellow`, `orange`, `pink`, `purple`, `natural`, `multicolor`) | Preserve merchant color names in metadata; normalize only for balancing. |
| `edge_stitch` | `none`, `standard`, `micro`, `double`, `box`; edge finish `painted`, `raw/burnished`, `folded` when confirmed | Never let stitch or edge color stand in for material identity. |
| `lining` | exact visible/merchant label, e.g. `Zermatt`, `rubber`, `alligator`, `ostrich`, `epsom`, `unknown` | Record separately because HANDDN products can use a different lining material from the face. |

### Family and finish mapping for captioning

The following is the practical mapping for training, based on HANDDN's own descriptions and
labels. A slash means “candidate mapping”, not a verified equivalence:

| HANDDN label | `family` | `finish` / `pattern` to teach | Confidence |
|---|---|---|---|
| Alligator / Double Hornback Alligator | alligator / hornback-alligator | `natural-grain`; `belly-scales` or `hornback-ridges` only when visible | high |
| Python / Sea Snake | python / sea-snake | `natural-scale`; preserve scale direction and irregularity | high for family, medium for pattern |
| Lizard | lizard | `fine-scales` | high |
| Ostrich / Ostrich Leg | ostrich / ostrich-leg | `quill-follicles` / `leg-scales` | high |
| Stingray / Shark / Peccary | stingray / shark / peccary | species-specific texture only if visible; do not substitute generic “exotic” | high for label, medium for visual pattern |
| Shell Cordovan | shell-cordovan | `smooth`, often high-gloss or reflective in product photo | high for label; finish must be image-checked |
| Epsom Calfskin | calfskin | `pressed-grain`, regular small grain | high |
| Saffiano Calfskin | calfskin | `wax-coated`, fine diagonal crosshatch | high |
| Epi | calfskin / other-leather | `embossed-wave` | high |
| Nubuck Calfskin | calfskin | `sanded-velvet`, low-sheen nap | high |
| Suede | other-leather | `sanded-velvet`, softer/deeper nap than smooth leather | medium; verify each source photo |
| Smooth Calf / Box Calf / Swift | calfskin | `smooth` or `natural-grain` depending on product photo | medium |
| Vachetta / Vegetable Tanned / Patina Veg-Tanned | calfskin / other-leather | `natural`, `patina`; color may evolve and must be preserved from source | high for label, medium for finish |
| Pueblo / Waxed / Waxed 2.0 / Crazy Horse / Habana | other-leather | `wax-coated`, `pull-up`, or `patina` only when product metadata/photo supports it | medium |
| Alran Chevre Fat nat / Sully | goatskin | `natural-grain` or `smooth`; Sully is not a synonym for all goatskin | high for family, medium for finish |
| Canvas / Sailcloth Rubber / Alcantara | canvas / rubber / alcantara | `woven` / `rubber-textured` / `suede-like synthetic` | high |
| Sailcloth mix Alligator | mixed | alligator cap + woven canvas/fabric body; annotate both regions | high |

HANDDN product pages also show that the main face and lining may differ (for example, an
ostrich face with an alligator lining), and that duocolor products explicitly carry two colors.
Therefore captions should use `main_face_material`, `lining_material`, `primary_color`, and
`secondary_color`, rather than a single `material` or `color` token. See [Ostrich/Alligator
example](https://handdn.com/product/black-ostrich-lining-black-alligator-leather-apple-watch-band/)
and [Duocolor example](https://handdn.com/product/duocolor-navy-alran-sully-leather-apple-watch-band/).

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

Checkpoint catalog 2026-08-14: split mới đã đạt 200 train products và 36 held-out products với
product overlap bằng 0. Sea Snake chưa có trong catalog sync hiện tại, dù có trong collection
HANDDN; cần đồng bộ/import product trước khi claim model đã học nhóm này.

### Coverage priority

Prioritize by production risk, not by the number of products in the catalog:

1. `alligator`, `python`, `lizard`, `stingray`, `ostrich`, `ostrich-leg`, `sea-snake`, and
   `shark`: high-risk species confusion; each needs clean close-ups with direction/orientation.
2. `epsom`, `saffiano`, `epi`, `nubuck`, `suede`, `shell-cordovan`: high-risk finish confusion;
   pair similar colors across contrasting finishes.
3. `chevre-sully`, `pueblo`, `waxed`, `habana`, `vachetta`, `box-calf`, `swift`, `togo`, and
   `vegetable-tanned`: expand the regular-leather long tail after the high-risk set.
4. `canvas`, `sailcloth-rubber`, `alcantara`, and `sailcloth-mix-alligator`: keep as separate
   non-leather/mixed-material classes; never train them as “leather”.

## Data contract cho mỗi material

Mỗi material/finish cell mới cần tối thiểu 8–12 ảnh đã duyệt, gồm ít nhất 3 màu và 2
construction styles nếu catalog cho phép. Caption phải ghi rõ `main_face_material`, `family`,
`finish`, `pattern`, `primary_color`, optional `secondary_color`, `construction`, `stitch`,
`padding`, and `lining`; không chỉ ghi tên sản phẩm. Với exotic hiếm hoặc màu hiếm, ưu tiên
đa dạng góc/crop và giữ held-out theo product family thay vì ép đủ 3 màu.

Mỗi material phải có held-out examples riêng. Không dùng cùng một product family cho cả train và held-out nếu mục tiêu là kiểm tra generalization.

## Quy tắc đặc biệt cho 56035

`56035 Duocolor Forest Suede Red Alran Sully` có màu/pattern đạt nhưng clean render hiện có tỷ lệ buckle-side khoảng 50%, không đạt quality gate khoảng 38% ± 6%. Không nới gate để cho chạy production; cần tạo lại clean render đúng hình học trước khi đưa sample này vào retraining.

## Tham chiếu mô tả vật liệu

- [Regular Leather](https://handdn.com/shop/regular-leather-watch-straps/) — HANDDN mô tả nhóm regular chủ yếu là calfskin và goatskin.
- [Epsom](https://handdn.com/product/black-epsom-leather-watch-strap/) — leather ép grain, bền, nhẹ và dễ vệ sinh.
- [Nubuck](https://handdn.com/product/navy-nubuck-leather-watch-strap/) — top-grain được sanding để tạo cảm giác mềm như velvet.
- [Saffiano](https://handdn.com/product/black-saffiano-leather-watch-strap/) — bề mặt wax-coated với pattern đặc trưng.
- [Epi](https://handdn.com/product/black-epi-leather-watch-strap/) — pattern dạng wave được emboss.
- [HANDDN Leather Knowledge](https://help.handdn.com/kb/leather-knowledge) — phân biệt exotic,
  regular leather và non-leather; dùng làm nguồn thuật ngữ, không dùng để suy ra thuộc tính
  của một ảnh không có metadata.
- [HANDDN Non-Leather](https://handdn.com/shop/non-leather-watch-straps/) — Canvas/Sailcloth và
  Alcantara; các trang sản phẩm cũng mô tả rubber/FKM là mặt chính của Sailcloth Rubber.
- [HANDDN Classic Straps](https://handdn.com/shop/classic-watch-straps/) — construction/style
  labels như Classic, Vintage, Curved End, Rally, Pilot, Bund, NATO và Single Folding.
- [HANDDN Duocolor](https://handdn.com/product/duocolor-navy-alran-sully-leather-apple-watch-band/)
  — ví dụ sản phẩm có hai màu và Alran Chevre Sully là mặt chính.

## Assumptions and limits

- HANDDN's collection page is the authoritative public vocabulary for this repo. Product names,
  filters, and photos are supporting evidence; they can expose a label not present in the
  collection summary.
- “Finish” and “pattern” are visual annotation fields, not claims about chemical treatment or
  tannery provenance. When the page does not state the finish, annotate only what is visible.
- A product count is not a training-image count. Counts are used for prioritization only; the
  dataset must count unique, approved source products after deduplication.
- Do not use category words such as `exotic`, `classic`, or `vintage` as a substitute for the
  face material. They describe a group or construction, not the visible surface.
- Do not infer lining from the face material. HANDDN pages demonstrate mixed face/lining
  combinations, and the app's training captions must preserve that distinction.
