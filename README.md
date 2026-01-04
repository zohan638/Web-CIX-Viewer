# CIX Viewer

CIX Viewer is a fast, browser-based viewer for CIX CNC programs used in woodworking and panel processing. Drop a `.cix` file to inspect the sheet, labels, toolpaths, drill holes, and recovered panels in a 3D scene. All parsing happens in the browser; files are not uploaded.

Live site: https://zohan638.github.io/Web-CIX-Viewer/

## What is CIX?
CIX is a text-based, macro-driven CNC interchange format used in the woodworking industry. It originated in the Biesse Group ecosystem (BiesseWorks/BSolid) and is used by CAM post-processors to drive Biesse CNC routers, nesting lines, and drilling machines. CIX files define sheet dimensions and machining macros (routing, drilling, labeling) rather than full 3D geometry. Vendor-specific variants exist, so parsers typically target a common subset.

## Highlights
- Reads MAINDATA for sheet size and thickness (LPX, LPY, LPZ).
- Parses LABEL macros for part labels and placement.
- Extracts ROUT toolpaths, including line and arc segments.
- Reads BV macros for drilling patterns.
- Recovers panels by buffering toolpaths by kerf and subtracting from the sheet with clipper-lib.
- Renders everything in 3D with React Three Fiber and quick view toggles.

## How it works
1. Parse MAINDATA for sheet dimensions.
2. Scan MACRO blocks to collect LABEL and BV data.
3. Extract ROUT paths (start, line, arc) with depth and tool diameter.
4. Offset routing paths by bit radius, union the kerfs, and subtract from the sheet to estimate finished panels.
5. Attach drill holes to recovered panels and render sheet, paths, holes, labels, and panels.

## Supported CIX subset
This viewer focuses on common panel-processing macros:
- MAINDATA: LPX, LPY, LPZ
- MACRO NAME=LABEL
- MACRO NAME=ROUT (line and arc segments)
- MACRO NAME=BV (vertical drilling)

Arcs are currently rendered as segmented lines and some macros are not yet implemented.

## Tech stack
- React 18 + Vite
- @react-three/fiber and drei
- three
- clipper-lib

## Development
Prerequisites: Node.js LTS and npm.

- Install: `npm install`
- Dev server: `npm run dev`
- Production build: `npm run build`
- Preview build: `npm run preview`

## GitHub Pages deployment
This project sets `base` to `./` in `vite.config.ts` so the built assets work under a GitHub Pages repo subpath.

### Option A: GitHub Actions (recommended)
1. Push to GitHub.
2. In Settings -> Pages, set Source to "GitHub Actions".
3. The workflow at `.github/workflows/deploy.yml` builds and deploys on pushes to `main`.

### Option B: Manual deployment
1. `npm run build`
2. Publish the `dist` folder to the `gh-pages` branch.

If you host on a custom domain or need a different base path, update `vite.config.ts` to set `base` accordingly.
