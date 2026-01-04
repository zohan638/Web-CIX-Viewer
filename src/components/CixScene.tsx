import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import { CixData, RecoveredPanel, RemovedPolygon, RoutingPath, Vec2 } from "../parser/types";

interface Props {
  data?: CixData | null;
  showPanels?: boolean;
  showToolpaths?: boolean;
  showKerf?: boolean;
  showLabels?: boolean;
  showHoles?: boolean;
  showSheet?: boolean;
}

const ARC_SEGMENTS = 28;
const DRILL_SEGMENTS = 42;

const ensureCounterClockwise = (poly: Vec2[]) => {
  const vecs = poly.map((p) => new THREE.Vector2(p.x, p.y));
  if (THREE.ShapeUtils.isClockWise(vecs)) return [...poly].reverse();
  return poly;
};

const ensureClockwise = (poly: Vec2[]) => {
  const vecs = poly.map((p) => new THREE.Vector2(p.x, p.y));
  if (THREE.ShapeUtils.isClockWise(vecs)) return poly;
  return [...poly].reverse();
};

const scalePolygon = (poly: Vec2[], factor = 1) => {
  if (factor === 1 || poly.length === 0) return poly;
  const cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
  const cy = poly.reduce((sum, p) => sum + p.y, 0) / poly.length;
  return poly.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  }));
};

const polygonToShape = (outer: Vec2[], holes: Vec2[][] = [], inset = 1) => {
  const scaledOuter = ensureCounterClockwise(scalePolygon(outer, inset));
  if (scaledOuter.length < 3) return null;
  const shape = new THREE.Shape();
  scaledOuter.forEach((pt, idx) => {
    if (idx === 0) shape.moveTo(pt.x, pt.y);
    else shape.lineTo(pt.x, pt.y);
  });
  shape.closePath();

  holes
    .map((h) => ensureClockwise(scalePolygon(h, inset)))
    .filter((h) => h.length >= 3)
    .forEach((hole) => {
      const path = new THREE.Path();
      hole.forEach((pt, idx) => {
        if (idx === 0) path.moveTo(pt.x, pt.y);
        else path.lineTo(pt.x, pt.y);
      });
      path.closePath();
      shape.holes.push(path);
    });

  return shape;
};

const circlePolygon = (center: Vec2, radius: number, segments = DRILL_SEGMENTS): Vec2[] => {
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

const toArcPoints = (start: THREE.Vector3, end: THREE.Vector3, center: THREE.Vector3) => {
  const start2 = new THREE.Vector2(start.x - center.x, start.y - center.y);
  const end2 = new THREE.Vector2(end.x - center.x, end.y - center.y);
  const r = start2.length();
  if (r < 1e-3) return [start, end];

  const a0 = Math.atan2(start2.y, start2.x);
  const a1 = Math.atan2(end2.y, end2.x);
  const cross = start2.x * end2.y - start2.y * end2.x;

  // Preserve sweep direction (cross>0 => CCW, cross<0 => CW)
  let delta = a1 - a0;
  if (cross > 0 && delta <= 0) delta += Math.PI * 2;
  if (cross < 0 && delta >= 0) delta -= Math.PI * 2;

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
    const t = i / ARC_SEGMENTS;
    const a = a0 + delta * t;
    pts.push(
      new THREE.Vector3(
        center.x + Math.cos(a) * r,
        center.y + Math.sin(a) * r,
        THREE.MathUtils.lerp(start.z, end.z, t),
      ),
    );
  }
  return pts;
};

const TOOLPATH_Z_OFFSET = 1.2; // lift for visibility above sheet/panels

const toolpathPoints = (path: RoutingPath) => {
  const pts: THREE.Vector3[] = [];
  let last: THREE.Vector3 | null = null;

  for (const p of path.points) {
    const zVis = (p.z ?? 0) + TOOLPATH_Z_OFFSET; // keep relative depth, lifted for display
    const current = new THREE.Vector3(p.x, p.y, zVis);
    if (p.type === "arc" && p.center && last) {
      const center = new THREE.Vector3(p.center.x, p.center.y, last.z);
      const arcPts = toArcPoints(last, current, center);
      pts.push(...arcPts.slice(1)); // avoid duplicating last
    } else {
      pts.push(current);
    }
    last = current;
  }

  return pts;
};

const PanelMesh = ({ panel, thickness = 2 }: { panel: RecoveredPanel; thickness?: number }) => {
  const { shape, extrudeGeom, edgeGeom } = useMemo(() => {
    if (!panel?.polygon?.length) return { shape: null, extrudeGeom: null, edgeGeom: null };
    const shapeObj = polygonToShape(panel.polygon, panel.holes ?? [], 0.999);
    if (!shapeObj) return { shape: null, extrudeGeom: null, edgeGeom: null };
    const extrude = new THREE.ExtrudeGeometry(shapeObj, { depth: Math.max(1, thickness), bevelEnabled: false });
    const edges = new THREE.EdgesGeometry(new THREE.ShapeGeometry(shapeObj));
    return { shape: shapeObj, extrudeGeom: extrude, edgeGeom: edges };
  }, [panel.holes, panel.polygon, thickness]);

  if (!shape || !extrudeGeom || !edgeGeom) return null;

  const depth = Math.max(1, thickness);

  return (
    <group>
      <mesh position={[0, 0, -depth]}>
        <primitive object={extrudeGeom} />
        <meshStandardMaterial
          color="#0ea5e9"
          opacity={0.68}
          transparent
          side={THREE.DoubleSide}
          metalness={0.05}
          roughness={0.82}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <lineSegments geometry={edgeGeom} position={[0, 0, 0.05]}>
        <lineBasicMaterial color="#02101f" depthWrite={false} />
      </lineSegments>
    </group>
  );
};

const RemovedVolume = ({
  removedPolys,
  drillHoles,
  thickness,
}: {
  removedPolys: RemovedPolygon[];
  drillHoles: { x: number; y: number; diameter: number }[];
  thickness: number;
}) => {
  const shapes = useMemo(() => {
    const entries: Array<{ key: string; shape: THREE.Shape }> = [];
    removedPolys?.forEach((poly, idx) => {
      const shape = polygonToShape(poly.outer, poly.holes ?? []);
      if (shape) entries.push({ key: `kerf-${idx}`, shape });
    });

    drillHoles?.forEach((hole, idx) => {
      const radius = Number(hole?.diameter ?? 0) / 2;
      if (!Number.isFinite(radius) || radius <= 0) return;
      const poly = circlePolygon({ x: hole.x, y: hole.y }, radius, DRILL_SEGMENTS);
      const shape = polygonToShape(poly);
      if (shape) entries.push({ key: `hole-${idx}-${hole.x}-${hole.y}`, shape });
    });

    return entries;
  }, [drillHoles, removedPolys]);

  if (!shapes?.length || !Number.isFinite(thickness) || thickness <= 0) return null;

  return (
    <group>
      {shapes.map(({ key, shape }) => (
        <mesh key={key} position={[0, 0, -thickness]}>
          <extrudeGeometry args={[shape, { depth: thickness, bevelEnabled: false }]} />
          <meshStandardMaterial
            color="#ef4444"
            opacity={0.3}
            transparent
            side={THREE.DoubleSide}
            depthWrite
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}
    </group>
  );
};

const CixScene = ({
  data,
  showPanels = true,
  showToolpaths = true,
  showKerf = true,
  showLabels = true,
  showHoles = true,
  showSheet = true,
}: Props) => {
  const sheetW = data?.metadata.sheet_width ?? 2000;
  const sheetH = data?.metadata.sheet_height ?? 1000;
  const sheetT = data?.metadata.sheet_thickness ?? 18;
  const routing = (data?.metadata.routing_paths ?? []) as RoutingPath[];
  const recovered = (data?.metadata.recovered_panels ?? []) as RecoveredPanel[];
  const removedPolys = (data?.metadata.removed_polygons ?? []) as RemovedPolygon[];
  const labels = data?.panels ?? [];
  const drillingHoles = (data?.metadata.drilling ?? []) as {
    x: number;
    y: number;
    diameter: number;
    depth?: number;
  }[];
  const hasRecovered = recovered.length > 0;
  const sheetOpacity = hasRecovered ? 0.08 : 0.35;
  const showSheetFill = false; // hide fill to better reveal kerfs/gaps

  // Keep the model reasonably sized in view
  const displayScale = 0.1;
  const center = [sheetW * 0.5, sheetH * 0.5, 0];
  const camDistance = Math.max(sheetW, sheetH) * 0.9 * displayScale;

  return (
    <Canvas
      camera={{
        position: [center[0] * displayScale, center[1] * displayScale, camDistance],
        fov: 35,
        up: [0, 0, 1],
        near: 0.1,
        far: 10000,
      }}
      style={{ width: "100%", height: "100%", background: "#0f172a" }}
    >
      <color attach="background" args={["#0f172a"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[500, 500, 500]} intensity={0.6} />
      <group scale={[displayScale, displayScale, displayScale]}>
        {showSheetFill && (
          <mesh position={[center[0], center[1], -sheetT * 0.55]} rotation={[0, 0, 0]}>
            <boxGeometry args={[sheetW, sheetH, sheetT]} />
            <meshStandardMaterial
              color="#0b1220"
              opacity={sheetOpacity}
              transparent
              polygonOffset
              polygonOffsetFactor={2}
              polygonOffsetUnits={2}
              depthWrite={false}
            />
          </mesh>
        )}
        {!showSheetFill && showSheet && (
          <primitive
            object={new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(sheetW, sheetH, sheetT)),
              new THREE.LineBasicMaterial({ color: "#0ea5e9", transparent: true, opacity: 0.3, depthWrite: false }),
            )}
            position={[center[0], center[1], -sheetT * 0.55]}
          />
        )}

        {showToolpaths &&
          routing.map((path) => {
            const pts = toolpathPoints(path);
            if (!pts || pts.length < 2) return null;
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            return (
              <line key={`path-${path.id ?? Math.random()}`} geometry={geo}>
                <lineBasicMaterial color="#22c55e" linewidth={2} depthWrite={false} depthTest={false} />
              </line>
            );
          })}

        {showKerf && (
          <RemovedVolume removedPolys={removedPolys} drillHoles={drillingHoles} thickness={sheetT} />
        )}

        {showPanels &&
          recovered.map((panel, idx) => (
            <group key={`panel-${idx}`}>
              <PanelMesh panel={panel} thickness={sheetT} />
            </group>
          ))}

        {showHoles &&
          drillingHoles.map((hole, idx) => {
            const radius = (hole.diameter ?? 0) / 2;
            const depthVal = Math.abs((hole as any).depth ?? 0);
            const fallbackDepth = sheetT > 0 ? sheetT : hole.diameter ?? 1;
            const h = Math.max(1, depthVal > 0 ? depthVal : fallbackDepth);
            return (
              <mesh
                key={`hole-${idx}-${hole.x}-${hole.y}`}
                position={[hole.x, hole.y, -h * 0.5]}
                rotation={[Math.PI / 2, 0, 0]} // align cylinder height to Z axis
              >
                <cylinderGeometry args={[radius, radius, h, 32]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.2} roughness={0.4} transparent opacity={0.7} />
              </mesh>
            );
          })}
        {showHoles &&
          drillingHoles.map((hole, idx) => {
            const radius = (hole.diameter ?? 0) / 2;
            return (
              <mesh key={`hole-top-${idx}-${hole.x}-${hole.y}`} position={[hole.x, hole.y, 0.1]}>
                <cylinderGeometry args={[radius, radius, 0.2, 32]} />
                <meshStandardMaterial color="#e2e8f0" metalness={0.2} roughness={0.3} depthTest={false} />
              </mesh>
            );
          })}

        {showLabels &&
          labels.map((panel) => {
            const x = Number(panel.metadata?.x_position ?? 0);
            const y = Number(panel.metadata?.y_position ?? 0);
            return (
              <Text
                key={panel.id}
                position={[x, y, 6]}
                fontSize={20}
                color="#facc15"
                anchorX="center"
                anchorY="middle"
                outlineColor="#0f172a"
                outlineWidth={0.5}
              >
                {panel.id}
              </Text>
            );
          })}
      </group>
      <OrbitControls
        enableRotate
        makeDefault
        target={[center[0] * displayScale, center[1] * displayScale, 0]}
        maxPolarAngle={(3 * Math.PI) / 4}
        minPolarAngle={0.1}
      />
    </Canvas>
  );
};

export default CixScene;
