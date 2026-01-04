declare module "clipper-lib" {
  export interface IntPoint {
    X: number;
    Y: number;
  }

  export type Path = IntPoint[];
  export type Paths = Path[];

  export enum JoinType {
    jtSquare = 0,
    jtRound = 1,
    jtMiter = 2
  }

  export enum EndType {
    etClosedPolygon = 0,
    etClosedLine = 1,
    etOpenSquare = 2,
    etOpenRound = 3,
    etOpenButt = 4
  }

  export enum PolyType {
    ptSubject = 0,
    ptClip = 1
  }

  export enum ClipType {
    ctIntersection = 0,
    ctUnion = 1,
    ctDifference = 2,
    ctXor = 3
  }

  export enum PolyFillType {
    pftEvenOdd = 0,
    pftNonZero = 1,
    pftPositive = 2,
    pftNegative = 3
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: JoinType, endType: EndType): void;
    AddPaths(paths: Paths, joinType: JoinType, endType: EndType): void;
    Execute(solution: Paths, delta: number): void;
    Clear(): void;
  }

  export class Clipper {
    AddPath(path: Path, polyType: PolyType, closed: boolean): void;
    AddPaths(paths: Paths, polyType: PolyType, closed: boolean): void;
    Execute(
      clipType: ClipType,
      solution: Paths,
      subjFillType?: PolyFillType,
      clipFillType?: PolyFillType
    ): void;
    Clear(): void;
  }

  export function Area(path: Path): number;
}
