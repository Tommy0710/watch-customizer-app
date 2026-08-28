export type MaterialProfile = {
  family: string;
  surface: string;
  bucket: string;
  source: 'attribute' | 'name-or-category' | 'fallback';
};

type MaterialInput = {
  name: string;
  categories?: string[];
  attributes?: Array<{ name: string; options: string[] }>;
};

const RULES: Array<[string, RegExp, string]> = [
  ['hornback-alligator', /double\s+hornback|hornback\s+alligator/i, 'hornback'],
  ['ostrich-leg', /ostrich\s+leg/i, 'pebbled'],
  ['sea-snake', /sea\s+snake|snake\s+sea/i, 'scale'],
  ['shell-cordovan', /shell\s+cordovan/i, 'smooth'],
  ['black-diamond', /black\s+diamond/i, 'embossed'],
  ['sailcloth', /sailcloth\s*(?:\/|and|-)\s*rubber|sailcloth\s+rubber/i, 'rubber'],
  ['alligator', /alligator|croc(?:odile)?/i, 'scale'],
  ['python', /python/i, 'scale'], ['lizard', /lizard/i, 'scale'],
  ['stingray', /stingray|galuchat|shagreen/i, 'stingray-pearl-granules'], ['ostrich', /ostrich/i, 'pebbled'],
  ['peccary', /peccary/i, 'pebbled'], ['shark', /shark/i, 'pebbled'],
  ['canvas', /canvas/i, 'woven'], ['alcantara', /alcantara/i, 'suede-nap'],
  ['saffiano', /saffiano/i, 'embossed'], ['epi', /\bepi\b/i, 'embossed'],
  ['suede', /suede/i, 'suede-nap'], ['nubuck', /nubuck/i, 'suede-nap'],
  ['vachetta', /vachetta/i, 'patina'], ['pueblo', /pueblo|badalassi\s+carlo/i, 'patina'],
  ['habana', /habana/i, 'patina'], ['babele', /babele/i, 'smooth'],
  ['chevre', /chevre|goat/i, 'pebbled'], ['sully', /sully/i, 'pebbled'],
  ['swift', /swift/i, 'smooth'], ['box-calf', /box\s+calf/i, 'smooth'],
  ['vegetable-tanned', /vegetable[- ]tann|veg[- ]tann/i, 'patina'],
  ['waxed', /waxed/i, 'smooth'], ['smooth-calf', /smooth\s+calf|calfskin|calf\s+leather/i, 'smooth'],
];

export function classifyMaterial(input: MaterialInput): MaterialProfile {
  const attributes = (input.attributes ?? []).map((a) => `${a.name} ${a.options.join(' ')}`).join(' | ');
  const text = `${input.name} ${(input.categories ?? []).join(' ')} ${attributes}`;
  const attributeRule = RULES.find(([, pattern]) => pattern.test(attributes));
  const rule = attributeRule ?? RULES.find(([, pattern]) => pattern.test(text));
  if (!rule) return { family: 'other-leather', surface: 'unknown', bucket: 'other-leather:unknown', source: 'fallback' };
  return { family: rule[0], surface: rule[2], bucket: `${rule[0]}:${rule[2]}`, source: attributeRule ? 'attribute' : 'name-or-category' };
}

export function buildMaterialClause(profile: MaterialProfile): string {
  switch (profile.family) {
    case 'stingray':
      return ' Material identity: genuine stingray leather with a continuous, tight pebbled texture of interlocking round mineral grains across the entire surface; preserve this distinctive pebbled texture and do not render as smooth leather, calfskin, or reptile scales.';
    case 'alligator':
      return ' Material identity: authentic genuine alligator/crocodile leather with prominent, well-defined rectangular and round scale tiles separated by natural groove lines; preserve this natural reptile scale pattern and do not substitute plain leather or printed grain.';
    case 'hornback-alligator':
      return ' Material identity: authentic hornback alligator leather with pronounced 3D raised dorsal osteoderm ridges and raised bone horns; preserve these distinct raised 3D ridges and do not flatten them into smooth leather.';
    case 'ostrich':
    case 'ostrich-leg':
      return ' Material identity: authentic ostrich leather with raised circular quill follicle bumps evenly distributed across the surface; preserve these distinct quill pores and do not substitute plain or pebbled cowhide.';
    case 'peccary':
      return ' Material identity: authentic peccary wild boar leather with distinctive natural triads of three-pore hair follicles and supple texture; preserve this characteristic 3-pore pattern and do not render as generic cowhide.';
    case 'shark':
      return ' Material identity: authentic shark leather with a rugged, continuous water-ripple texture of deep micro-grooves and matte pebble grain; preserve this oceanic ripple texture and do not render as smooth leather.';
    case 'lizard':
      return ' Material identity: authentic lizard leather featuring an intricate mosaic of tiny, uniform circular and polygonal reptile scales; preserve this micro-scale texture and do not render as smooth or plain leather.';
    case 'python':
    case 'sea-snake':
      return ' Material identity: authentic python snake leather with layered, overlapping diamond reptile scales and natural scale edges; preserve this snake scale structure and do not render as plain leather.';
    case 'pueblo':
      return ' Material identity: authentic Badalassi Carlo Pueblo leather with its signature hand-scratched matte rustic surface texture and micro circular scuffs; preserve this distinctive distressed velvet-matte character.';
    case 'saffiano':
      return ' Material identity: authentic Saffiano leather featuring its iconic machine-embossed diagonal cross-hatch micro-grain texture; preserve this crisp geometric cross-hatch pattern and rigid structure.';
    case 'epi':
      return ' Material identity: authentic Epi leather with its distinctive horizontal undulating wave-ridge embossed grain pattern; preserve this bold textured wave pattern and do not smooth it out.';
    case 'shell-cordovan':
      return ' Material identity: authentic Shell Cordovan equine leather with a perfectly smooth, poreless, glossy mirror-like glazed finish; preserve this glassy lustrous depth and do not add pebble or scale grain.';
    case 'black-diamond':
      return ' Material identity: authentic Black Diamond Wagyu leather with its micro-faceted diamond embossed texture and subtle satin luster; preserve this geometric textured grain.';
    case 'chevre':
    case 'sully':
      return ' Material identity: authentic Alran Chevre goat leather with a fine, tight natural pebble grain and rich supple character; preserve this distinct goat grain texture.';
    case 'sailcloth':
      return ' Material identity: authentic sailcloth fabric bonded to rubber, featuring a technical textured cordura weave pattern with rubberized edge backing; preserve this sporty technical fabric texture.';
    case 'suede':
    case 'nubuck':
    case 'alcantara':
      return ' Material identity: authentic premium suede/nubuck leather with a fine, velvety nap and soft matte texture; preserve this brushed nap texture and do not render as shiny or glossy leather.';
    case 'canvas':
      return ' Material identity: authentic heavy-duty woven cotton/nylon canvas textile with a distinct woven grid texture; preserve this textile weave and do not render as leather.';
    case 'vachetta':
    case 'vegetable-tanned':
    case 'habana':
      return ' Material identity: authentic full-grain vegetable-tanned leather with a natural, rich organic patina and clean surface grain; preserve its organic leather depth.';
    case 'box-calf':
    case 'swift':
    case 'smooth-calf':
    case 'waxed':
    case 'babele':
      return ' Material identity: authentic premium calfskin leather with a tight, smooth, silky micro-grain and subtle satin finish; preserve its refined luxury leather character.';
    default: {
      const family = profile.family === 'other-leather' ? 'the specified leather material' : `${profile.family} material`;
      const surface = profile.surface === 'unknown' ? 'with its exact surface appearance' : `with a ${profile.surface} surface`;
      return ` Material identity: ${family} ${surface}; preserve this identity and do not substitute another leather, exotic pattern, fabric, or rubber.`;
    }
  }
}
