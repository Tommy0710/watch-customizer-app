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
  ['stingray', /stingray/i, 'pebbled'], ['ostrich', /ostrich/i, 'pebbled'],
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
  const family = profile.family === 'other-leather' ? 'the specified leather material' : `${profile.family} material`;
  const surface = profile.surface === 'unknown' ? 'with its exact surface appearance' : `with a ${profile.surface} surface`;
  return ` Material identity: ${family} ${surface}; preserve this identity and do not substitute another leather, exotic pattern, fabric, or rubber.`;
}
