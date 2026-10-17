import { validateCreatureList, type BossDef, type CreatureDef, type EnemyDef, type MobDef } from './schema';

/**
 * Creature JSON bundled from `content/**\/*.json`.
 * The directory may be missing; the glob is then empty and the catalog is empty.
 * Vite inlines the files, so the single-file build does not fetch them.
 */
const bundled = import.meta.glob('../../content/**/*.json', {
  eager: true,
  import: 'default',
});

export interface ContentCatalog {
  readonly mobs: readonly MobDef[];
  readonly enemies: readonly EnemyDef[];
  readonly bosses: readonly BossDef[];
  readonly byId: ReadonlyMap<string, CreatureDef>;
}

/**
 * Validate creature definitions.
 * Omit `files` to read the bundled `content/` JSON. Pass a path → JSON map
 * to validate data that is not on disk. An empty map is an empty catalog.
 * Throws when a file fails the schema or reuses an id. Paths are sorted so
 * the catalog order does not depend on filesystem enumeration.
 */
export function loadContent(files?: Readonly<Record<string, unknown>>): ContentCatalog {
  const source = files ?? bundled;
  const mobs: MobDef[] = [];
  const enemies: EnemyDef[] = [];
  const bosses: BossDef[] = [];
  const byId = new Map<string, CreatureDef>();
  const definedAt = new Map<string, string>();

  for (const path of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
    const file = displayPath(path);
    const result = validateCreatureList(source[path]);
    if (!result.ok) throw new Error(formatErrors(file, result.errors));
    for (const creature of result.value) {
      const prior = definedAt.get(creature.id);
      if (prior) {
        throw new Error(formatErrors(file, [`id: "${creature.id}" is already defined in ${prior}`]));
      }
      definedAt.set(creature.id, file);
      byId.set(creature.id, creature);
      if (creature.kind === 'mob') mobs.push(creature);
      else if (creature.kind === 'enemy') enemies.push(creature);
      else bosses.push(creature);
    }
  }

  return {
    mobs: Object.freeze(mobs),
    enemies: Object.freeze(enemies),
    bosses: Object.freeze(bosses),
    byId,
  };
}

function displayPath(path: string): string {
  const norm = path.replaceAll('\\', '/');
  const marker = 'content/';
  const at = norm.lastIndexOf(marker);
  return at >= 0 ? norm.slice(at) : norm;
}

function formatErrors(file: string, errors: readonly string[]): string {
  return `Invalid content ${file}:\n${errors.map((error) => `  - ${error}`).join('\n')}`;
}
