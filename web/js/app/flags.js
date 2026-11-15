// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Flags of the nations that flew the real missions (catalog field C2 "nation"). The artwork is third-party and
// unaltered (web/assets/flags/, docs/REFERENCES.md): flag-icons (MIT) and, for the Soviet Union, Wikimedia Commons
// (public domain). The app only sizes it with CSS, at its own aspect ratio. No DOM here, so node tests can import it.

/** Folder of the flag files, relative to the page (web/index.html). */
export const FLAG_DIR = "assets/flags/";

/**
 * Nation code (C2 "nation") -> name, the name in a sentence, flag file, and the flag's aspect ratio (width / height)
 * as drawn in that file.
 */
export const NATIONS = {
  US: { name: "United States", the: "the United States", file: "us.svg", aspect: 4 / 3 },
  SU: { name: "Soviet Union", the: "the Soviet Union", file: "su.svg", aspect: 2 },
  CN: { name: "China", the: "China", file: "cn.svg", aspect: 4 / 3 },
  IN: { name: "India", the: "India", file: "in.svg", aspect: 4 / 3 },
  JP: { name: "Japan", the: "Japan", file: "jp.svg", aspect: 4 / 3 },
  IL: { name: "Israel", the: "Israel", file: "il.svg", aspect: 4 / 3 },
};

/**
 * The flag of a catalog site: { code, name, src, aspect, title } for a mission with a known nation, else null (the
 * other kinds of place have no flag). title: "Flag of the United States".
 */
export function siteFlag(site) {
  if (!site || site.kind !== "mission" || !site.nation) return null;
  const code = String(site.nation).toUpperCase();
  const n = NATIONS[code];
  if (!n) return null;
  return { code, name: n.name, src: FLAG_DIR + n.file, aspect: n.aspect, title: `Flag of ${n.the}` };
}
