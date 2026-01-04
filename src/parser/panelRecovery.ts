import * as ClipperLib from "clipper-lib";
import { CixData, DrillHole, RecoveredPanel, RoutingPath, Vec2 } from "./types";

type Path = ClipperLib.Path;
type Paths = ClipperLib.Paths;

interface RecoverOptions {
  defaultBitDiameterMm?: number;
  depthRatio?: number;
  minPanelArea?: number;
  kerfScale?: number;
}

const SCALE = 1000; // Scale to retain precision for integer clipper API

const toPath = (pts: Vec2[]): Path =>
  pts.map((p) => ({
    X: Math.round(p.x * SCALE),
    Y: Math.round(p.y * SCALE),
  }));

const fromPath = (path: Path): Vec2[] =>
  path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));

const polygonArea = (path: Vec2[]) => {
  let sum = 0;
  for (let i = 0; i < path.length; i += 1) {
    const p1 = path[i];
    const p2 = path[(i + 1) % path.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
};

const circlePath = (center: Vec2, radius: number, segments = 28): Vec2[] => {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || radius <= 0) return [];
  const pts: Vec2[] = [];
  const segs = Math.max(8, segments);
  for (let i = 0; i < segs; i += 1) {
    const a = (Math.PI * 2 * i) / segs;
    pts.push({
      x: center.x + Math.cos(a) * radius,
      y: center.y + Math.sin(a) * radius,
    });
  }
  return pts;
};

const bounds = (path: Vec2[]): [number, number, number, number] => {
  const xs = path.map((p) => p.x);
  const ys = path.map((p) => p.y);
  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
};

const offsetOpenPath = (pts: Vec2[], radius: number): Paths => {
  const co = new ClipperLib.ClipperOffset(2, 0.25);
  const sol: Paths = [];
  co.AddPath(toPath(pts), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etOpenButt);
  co.Execute(sol, radius * SCALE);
  return sol;
};

const unionPaths = (paths: Paths): Paths => {
  if (!paths.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const solution: Paths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return solution;
};

const difference = (subject: Paths, clip: Paths): Paths => {
  if (!subject.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) {
    clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  }
  const solution: Paths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return solution;
};

const differenceWithHoles = (subject: Paths, clip: Paths): Array<{ outer: Path; holes: Path[] }> => {
  if (!subject.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);

  const solutionTree = new (ClipperLib as any).PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    solutionTree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );

  const panels: Array<{ outer: Path; holes: Path[] }> = [];
  const toPathSafe = (node: any): Path => {
    const contour = node?.Contour;
    if (Array.isArray(contour) && contour.length) return contour;
    const poly = node?.m_polygon;
    if (Array.isArray(poly) && poly.length) return poly;
    return contour ?? poly ?? [];
  };
  const toArray = (value: any): any[] | null => {
    if (!value) return null;
    if (Array.isArray(value)) return value;
    try {
      return Array.from(value);
    } catch {
      return null;
    }
  };
  const getChildren = (node: any): any[] => {
    const candidates = [
      node?.m_Childs,
      node?.Childs,
      node?.childs,
      typeof node?.GetChildren === "function" ? node.GetChildren() : null,
    ].filter((c) => c !== null && c !== undefined);
    let fallback: any[] | null = null;
    for (const cand of candidates) {
      const arr = toArray(cand);
      if (!arr) continue;
      if (!fallback) fallback = arr;
      if (arr.length) return arr;
    }
    return fallback ?? [];
  };
  const isHole = (node: any): boolean =>
    typeof node?.IsHole === "function" ? node.IsHole() : Boolean(node?.isHole ?? node?.m_IsHole);

  const visit = (node: any) => {
    const contour: Path = toPathSafe(node);
    if (!contour || contour.length === 0) {
      getChildren(node).forEach(visit);
      return;
    }
    const holes: Path[] = [];
    for (const child of getChildren(node)) {
      if (isHole(child)) {
        const holePath = toPathSafe(child);
        if (holePath?.length) holes.push(holePath);
        visit(child);
      } else {
        visit(child);
      }
    }
    if (!isHole(node)) {
      panels.push({ outer: contour, holes });
    }
  };

  getChildren(solutionTree).forEach(visit);
  return panels;
};

const pathDepth = (path: RoutingPath): number => {
  let depth = Math.abs(path?.max_depth ?? 0);
  const tryParse = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.abs(n) : 0;
  };
  depth = Math.max(depth, tryParse(path?.params?.PR));
  depth = Math.max(depth, tryParse(path?.params?.DP));
  depth = Math.max(depth, tryParse(path?.params?.ZE));
  depth = Math.max(depth, tryParse(path?.params?.Z));
  return depth;
};

const isThroughCut = (path: RoutingPath, sheetThickness: number, depthRatio: number) => {
  const depth = pathDepth(path);
  if (sheetThickness <= 0) return depth > 0;
  return depth >= sheetThickness * depthRatio;
};

const pointInPolygon = (pt: Vec2, polygon: Vec2[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const cross = (pt.y - a.y) * (b.x - a.x) - (pt.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) < 1e-9 && Math.min(a.x, b.x) - 1e-9 <= pt.x && pt.x <= Math.max(a.x, b.x) + 1e-9) {
      if (Math.min(a.y, b.y) - 1e-9 <= pt.y && pt.y <= Math.max(a.y, b.y) + 1e-9) {
        return true; // on boundary
      }
    }
    const intersect =
      a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
};

const pointInPolygonWithHoles = (pt: Vec2, polygon: Vec2[], holes: Vec2[][] = []) => {
  if (!pointInPolygon(pt, polygon)) return false;
  for (const hole of holes) {
    if (hole?.length && pointInPolygon(pt, hole)) return false;
  }
  return true;
};

const attachDrillHolesToPanels = (panels: RecoveredPanel[], drillHoles: DrillHole[]) => {
  if (!drillHoles?.length) return;
  for (const panel of panels) {
    const polyHoles: Vec2[][] = panel.holes ? [...panel.holes] : [];
    const assigned: DrillHole[] = [];
    let area = typeof panel.area === "number" ? panel.area : polygonArea(panel.polygon);
    for (const hole of drillHoles) {
      const cx = Number(hole.x);
      const cy = Number(hole.y);
      const radius = Number(hole.diameter ?? 0) / 2;
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || radius <= 0) continue;
      const center = { x: cx, y: cy };
      if (!pointInPolygon(center, panel.polygon)) continue;
      const circle = circlePath(center, radius, 40);
      if (circle.length >= 3) {
        polyHoles.push(circle);
        assigned.push(hole);
        try {
          area -= Math.abs(polygonArea(circle));
        } catch {
          // ignore area errors for drill holes
        }
      }
    }
    if (polyHoles.length) panel.holes = polyHoles;
    if (assigned.length) panel.drillHoles = assigned;
    if (Number.isFinite(area)) panel.area = Math.max(area, 0);
  }
};

export const recoverPanelsFromRouting = (
  cixData: CixData,
  {
    defaultBitDiameterMm = 6,
    depthRatio = 0.8,
    minPanelArea = 1000,
    kerfScale = 1,
  }: RecoverOptions = {},
): RecoveredPanel[] => {
  const sheetW = Number(cixData.metadata.sheet_width ?? 0);
  const sheetH = Number(cixData.metadata.sheet_height ?? 0);
  const sheetT = Number(cixData.metadata.sheet_thickness ?? 0);

  if (sheetW <= 0 || sheetH <= 0) return [];

  const sheetPath: Paths = [
    toPath([
      { x: 0, y: 0 },
      { x: sheetW, y: 0 },
      { x: sheetW, y: sheetH },
      { x: 0, y: sheetH },
    ]),
  ];

  const routing = (cixData.metadata.routing_paths ?? []) as RoutingPath[];
  const kerfs: Paths = [];

  const addKerfsForPaths = (paths: RoutingPath[]) => {
    for (const path of paths) {
      const pts = (path.points ?? []).map((p) => ({ x: p.x, y: p.y }));
      if (pts.length < 2) continue;
      const radius = ((path.diameter ?? defaultBitDiameterMm) / 2) * kerfScale;
      if (!Number.isFinite(radius) || radius <= 0) continue;
      const buffered = offsetOpenPath(pts, radius);
      kerfs.push(...buffered);
    }
  };

  for (const path of routing) {
    if (!isThroughCut(path, sheetT, depthRatio)) continue;
    addKerfsForPaths([path]);
  }

  // Fallback: if nothing qualified as through-cut, assume all routing are cuts
  if (!kerfs.length && routing.length) {
    addKerfsForPaths(routing);
  }

  if (!kerfs.length) {
    try {
      cixData.metadata.kerf_polygons = [];
    } catch {
      // ignore metadata exposure errors
    }
    const sheetPoly = fromPath(sheetPath[0]);
    const sheetPanel: RecoveredPanel = {
      polygon: sheetPoly,
      coords: sheetPoly,
      area: sheetW * sheetH,
      width: sheetW,
      height: sheetH,
      bounds: [0, 0, sheetW, sheetH],
      holes: [],
    };
    attachDrillHolesToPanels([sheetPanel], (cixData.metadata.drilling ?? []) as DrillHole[]);
    cixData.metadata.removed_polygons = [];
    return [sheetPanel];
  }

  const kerfUnion = unionPaths(kerfs);
  let kerfPolygons: Vec2[][] = [];

  // Expose kerf polygons for visualization (removed material)
  if (!kerfUnion.length) {
    try {
      cixData.metadata.kerf_polygons = [];
    } catch {
      // ignore
    }
  } else {
    try {
      kerfPolygons = kerfUnion.map((path) => fromPath(path)).filter((poly) => poly.length >= 3);
      cixData.metadata.kerf_polygons = kerfPolygons;
    } catch {
      cixData.metadata.kerf_polygons = [];
    }
  }
  let remaining: Array<{ outer: Path; holes: Path[] }> = [];
  try {
    remaining = differenceWithHoles(sheetPath, kerfUnion);
    if (!remaining.length) {
      const fallback = difference(sheetPath, kerfUnion);
      remaining = fallback.map((p) => ({ outer: p, holes: [] }));
    }
  } catch (err) {
    // fallback to simple difference without holes to avoid total failure
    const fallback = difference(sheetPath, kerfUnion);
    remaining = fallback.map((p) => ({ outer: p, holes: [] }));
    const msg = err instanceof Error ? err.message : String(err ?? "kerf difference error");
    try {
      (cixData as any).parse_errors?.push?.(msg);
    } catch {
      // ignore
    }
  }

  const panels: RecoveredPanel[] = [];
  for (const piece of remaining) {
    const outer = fromPath(piece.outer);
    const holes = (piece.holes ?? []).map(fromPath);
    if (outer.length < 3) continue;
    let area = polygonArea(outer);
    try {
      const clipperArea =
        (ClipperLib as any).Area?.(piece.outer) ?? (ClipperLib as any).ClipperLib?.Area?.(piece.outer);
      if (typeof clipperArea === "number") {
        area = Math.abs(clipperArea) / (SCALE * SCALE);
      }
    } catch {
      // fall back to polygonArea
    }
    // subtract hole areas
    for (const h of holes) {
      try {
        const hArea = polygonArea(h);
        area -= Math.abs(hArea);
      } catch {
        // ignore hole area errors
      }
    }
    if (area < minPanelArea) continue;
    const b = bounds(outer);
    panels.push({
      polygon: outer,
      coords: outer,
      holes,
      area,
      width: b[2] - b[0],
      height: b[3] - b[1],
      bounds: b,
    });
  }

  attachDrillHolesToPanels(panels, (cixData.metadata.drilling ?? []) as DrillHole[]);

  const labelPoints =
    cixData.panels
      ?.map((panel) => {
        const x = Number(panel.metadata?.x_position);
        const y = Number(panel.metadata?.y_position);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return { id: String(panel.id ?? ""), x, y };
        }
        return null;
      })
      .filter((p): p is { id: string; x: number; y: number } => Boolean(p)) ?? [];

  if (panels.length === 0) {
    const sheetPoly = fromPath(sheetPath[0]);
    const sheetPanel: RecoveredPanel = {
      polygon: sheetPoly,
      coords: sheetPoly,
      holes: [],
      area: sheetW * sheetH,
      width: sheetW,
      height: sheetH,
      bounds: [0, 0, sheetW, sheetH],
    };
    attachDrillHolesToPanels([sheetPanel], (cixData.metadata.drilling ?? []) as DrillHole[]);
    const removedPolygons = kerfPolygons.map((poly) => ({ outer: poly, holes: [] as Vec2[][] }));
    cixData.metadata.removed_polygons = removedPolygons.filter((poly) => (poly.outer?.length ?? 0) >= 3);
    return [sheetPanel];
  }

  const labeledPanels = labelPoints.length
    ? panels.filter((panel) =>
        labelPoints.some((pt) => pointInPolygonWithHoles(pt, panel.polygon, panel.holes ?? [])),
      )
    : [];
  const finalPanels = labeledPanels.length ? labeledPanels : panels;
  const removedShapes: Array<{ outer: Vec2[]; holes: Vec2[][] }> = [];
  try {
    const panelPaths: Paths = finalPanels
      .filter((panel) => (panel.polygon?.length ?? 0) >= 3)
      .map((panel) => toPath(panel.polygon));
    if (panelPaths.length) {
      const removedPieces = differenceWithHoles(sheetPath, panelPaths);
      removedPieces.forEach((piece) => {
        const outer = fromPath(piece.outer);
        if (outer.length < 3) return;
        const holes = (piece.holes ?? []).map(fromPath).filter((hole) => hole.length >= 3);
        removedShapes.push({ outer, holes });
      });
    } else {
      removedShapes.push({ outer: fromPath(sheetPath[0]), holes: [] });
    }
  } catch {
    if (kerfPolygons.length) {
      kerfPolygons.forEach((poly) => {
        if (poly.length >= 3) removedShapes.push({ outer: poly, holes: [] });
      });
    }
  }

  cixData.metadata.removed_polygons = removedShapes;

  return finalPanels;
};
