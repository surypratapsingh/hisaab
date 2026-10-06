/**
 * Where wealth sits: bank, cash, investments and anything else, as bodies around
 * the total. A node's size follows its share of the whole and a bigger share sits
 * a little closer in. Pure geometry from figures the wealth view already has;
 * a balance nobody has told the app (unknown) is not drawn, exactly as it is left
 * out of the total.
 */

export type OrbitKind = 'bank' | 'cash' | 'investment' | 'other';

export type OrbitPart = { kind: OrbitKind; value: number; unknown?: boolean };

export type OrbitNode = { kind: OrbitKind; value: number; share: number };

export type OrbitPlace = OrbitNode & {
  /** Diameter of the body. */
  size: number;
  /** Degrees; 0 is to the right, -90 straight up. */
  angle: number;
  /** Distance from the total. */
  radius: number;
};

/** Fixed order and places, so the picture is the same every time and a change is seen as a change. */
export const ORBIT_ANGLE: Record<OrbitKind, number> = { investment: -90, bank: 180, cash: 0, other: 90 };
const ORDER: OrbitKind[] = ['investment', 'bank', 'cash', 'other'];

export const NODE_MIN = 30;
export const NODE_MAX = 64;
export const RADIUS_FAR = 112;
export const RADIUS_NEAR = 98;

/** Each kind's total among the counted parts, in a fixed order; a kind with nothing in it is left out. */
export const orbitNodes = (parts: OrbitPart[]): OrbitNode[] => {
  const counted = parts.filter((p) => !p.unknown && p.value > 0);
  const total = counted.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return [];
  return ORDER.flatMap((kind) => {
    const value = counted.filter((p) => p.kind === kind).reduce((sum, p) => sum + p.value, 0);
    return value > 0 ? [{ kind, value, share: value / total }] : [];
  });
};

export const orbitLayout = (nodes: OrbitNode[]): OrbitPlace[] =>
  nodes.map((node) => ({
    ...node,
    size: Math.round(NODE_MIN + (NODE_MAX - NODE_MIN) * Math.sqrt(node.share)),
    angle: ORBIT_ANGLE[node.kind],
    radius: Math.round(RADIUS_FAR - (RADIUS_FAR - RADIUS_NEAR) * node.share),
  }));
