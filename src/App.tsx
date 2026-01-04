import { useCallback, useMemo, useState } from "react";
import CixScene from "./components/CixScene";
import { parseCixContent } from "./parser/cixParser";
import { recoverPanelsFromRouting } from "./parser/panelRecovery";
import { CixData } from "./parser/types";

const formatNumber = (value?: number, digits = 1) => {
  if (value === undefined || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(digits)} mm`;
};

const App = () => {
  const [cix, setCix] = useState<CixData | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState({
    panels: true,
    toolpaths: true,
    removed: true,
    labels: true,
    holes: true,
    sheet: true,
  });

  const handleFile = useCallback(async (file?: File | null) => {
    if (!file) return;
    const text = await file.text();
    setStatus("Parsing...");

    try {
      const parsed = parseCixContent(text, file.name);
      try {
        const recovered = recoverPanelsFromRouting(parsed, {
          defaultBitDiameterMm: 6,
          kerfScale: 0.5,
          depthRatio: 0.8,
          minPanelArea: 500,
        });
        parsed.metadata.recovered_panels = recovered;
      } catch (err) {
        const recMessage = err instanceof Error ? err.message : "Panel recovery failed";
        parsed.parse_errors.push(recMessage);
      }

      setCix(parsed);
      setStatus(
        `Loaded ${parsed.panels.length} labels, ${parsed.metadata.routing_paths?.length ?? 0} toolpaths`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown parse error";
      setStatus(message);
    }
  }, []);

  const stats = useMemo(() => {
    if (!cix) return [];
    return [
      { label: "Sheet Width", value: formatNumber(cix.metadata.sheet_width) },
      { label: "Sheet Height", value: formatNumber(cix.metadata.sheet_height) },
      { label: "Thickness", value: formatNumber(cix.metadata.sheet_thickness) },
      { label: "Labels", value: `${cix.panels.length}` },
      { label: "Toolpaths", value: `${cix.metadata.routing_paths?.length ?? 0}` },
      { label: "Recovered Panels", value: `${cix.metadata.recovered_panels?.length ?? 0}` },
      { label: "Drill Holes", value: `${cix.metadata.drilling?.length ?? 0}` },
    ];
  }, [cix]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="brand">CIX to React + Three.js</div>
          <div style={{ color: "#475569", fontSize: 13 }}>
            Drop a .CIX to view sheet, labels, toolpaths, and recovered panels.
          </div>
        </div>
        <div className="badge">Shapely alt: clipper-lib (offset/union/diff)</div>
      </header>

      <div className="content">
        <div className="panel" style={{ minHeight: 0 }}>
          <h3>1) Upload a .CIX file</h3>
          <label className="upload">
            <input
              type="file"
              accept=".cix,text/plain"
              style={{ display: "none" }}
              onChange={(evt) => handleFile(evt.target.files?.[0])}
            />
            <div style={{ fontWeight: 600 }}>Click to select or drag a .CIX file here</div>
            <div style={{ color: "#475569", fontSize: 13 }}>
              We parse MAINDATA, LABELS, ROUT toolpaths (with arc geometry), and BV drilling macros in the browser.
            </div>
          </label>

          {status && <div style={{ marginTop: 8, color: "#0f172a" }}>{status}</div>}

          {cix && (
            <>
              <h3>Sheet + Parse Stats</h3>
              <div className="stats-grid">
                {stats.map((s) => (
                  <div key={s.label} className="stat">
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value">{s.value}</div>
                  </div>
                ))}
              </div>

              {cix.parse_errors.length > 0 && (
                <div className="errors">
                  {cix.parse_errors.map((err) => (
                    <div key={err}>- {err}</div>
                  ))}
                </div>
              )}

              <h3>Notes</h3>
              <ul className="list">
                <li>Y coordinates are flipped to a bottom-left origin for consistency in the 3D view.</li>
                <li>
                  Tool kerfs are buffered with <code>clipper-lib</code> to subtract cuts from the sheet and recover
                  panel polygons.
                </li>
                <li>
                  Arcs are shown as straight segments for now; if you need true arcs, we can interpolate more points
                  from the macro parameters.
                </li>
              </ul>

              <h3>View Toggles</h3>
              <div className="toggles">
                {[
                  { key: "panels", label: "Panels (blue)" },
                  { key: "toolpaths", label: "Toolpaths (green)" },
                  { key: "removed", label: "Removed material (red)" },
                  { key: "labels", label: "Labels" },
                  { key: "holes", label: "Drill holes" },
                  { key: "sheet", label: "Sheet outline" },
                ].map((item) => (
                  <label key={item.key} className="toggle">
                    <input
                      type="checkbox"
                      checked={(view as any)[item.key]}
                      onChange={() =>
                        setView((prev) => ({
                          ...prev,
                          [item.key]: !(prev as any)[item.key],
                        }))
                      }
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel viewer" style={{ minHeight: "70vh" }}>
          <div className="legend">
            <span className="chip">
              <span className="swatch" style={{ background: "#1f2937" }} /> Sheet
            </span>
            <span className="chip">
              <span className="swatch" style={{ background: "#22c55e" }} /> Toolpaths
            </span>
            <span className="chip">
              <span className="swatch" style={{ background: "#ef4444" }} /> Removed material
            </span>
            <span className="chip">
              <span className="swatch" style={{ background: "#0ea5e9" }} /> Recovered panels
            </span>
            <span className="chip">
              <span className="swatch" style={{ background: "#facc15" }} /> Labels
            </span>
            <span className="chip">
              <span className="swatch" style={{ background: "#94a3b8" }} /> Drill holes
            </span>
          </div>
          <CixScene
            data={cix ?? undefined}
            showPanels={view.panels}
            showToolpaths={view.toolpaths}
            showKerf={view.removed}
            showLabels={view.labels}
            showHoles={view.holes}
            showSheet={view.sheet}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
