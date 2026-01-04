export type RoutingPointType = "start" | "line" | "arc";

export interface Vec2 {
  x: number;
  y: number;
}

export interface RoutingPoint extends Vec2 {
  z?: number;
  type: RoutingPointType;
  center?: Vec2;
}

export interface RoutingPath {
  id?: number;
  points: RoutingPoint[];
  params: Record<string, string>;
  max_depth: number;
  diameter?: number;
}

export interface DrillHole {
  x: number;
  y: number;
  diameter: number;
  depth: number;
  id?: string | number;
}

export interface PanelSpecification {
  id: string;
  width: number;
  height: number;
  thickness: number;
  geometry: any[];
  holes: DrillHole[];
  edges: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface RecoveredPanel {
  polygon: Vec2[];
  coords?: Vec2[];
  holes?: Vec2[][];
  drillHoles?: DrillHole[];
  area: number;
  width: number;
  height: number;
  bounds: [number, number, number, number];
}

export interface RemovedPolygon {
  outer: Vec2[];
  holes?: Vec2[][];
}

export interface KerfPolygon {
  polygon: Vec2[];
  area: number;
  bounds: [number, number, number, number];
}

export interface CixMetadata {
  sheet_width?: number;
  sheet_height?: number;
  sheet_thickness?: number;
  routing_paths?: RoutingPath[];
  drilling?: DrillHole[];
  recovered_panels?: RecoveredPanel[];
  removed_polygons?: RemovedPolygon[];
  kerf_polygons?: Vec2[][];
  [key: string]: unknown;
}

export interface CixData {
  filename: string;
  sheetId: string;
  panels: PanelSpecification[];
  raw_content: string;
  parse_errors: string[];
  metadata: CixMetadata;
}
