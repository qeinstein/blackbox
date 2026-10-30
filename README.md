# BLACKBOX

BLACKBOX is an investigation workspace for reconstructing video captured vehicle collisions and workplace incidents. This repository currently contains an interactive product prototype built with React, TypeScript, and Vite.

## Run locally

```sh
npm install
npm run dev
```

The production bundle can be created with `npm run build` and previewed with `npm run preview`.

## Workspace screens

- **Case files** lists sample incidents and lets you create a local case from an MP4, MOV, or WebM clip.
- **Reconstruction** pairs the local video or sample footage with a metric-style scene, synchronized timeline, calibration grid, actor paths, and telemetry.
- **Counterfactuals** compares a reference path with an adjustable ghost path. Speed, response time, and surface friction update a simplified stopping-distance estimate.
- **Findings** shows a structured sample summary and exports a CSV marked as demonstration data.

## Prototype boundaries

There is no analysis service, database, authentication, or cloud upload connected yet. Selected video files stay in the current browser session; the app does not segment, track, calibrate, or analyze them. The Westbridge Avenue incident is hand-authored demonstration data, and every displayed sample score, timestamp, speed, residual, and finding is illustrative.

The counterfactual panel calculates reaction distance plus braking distance on a level surface with constant friction. It is a transparent UI example, not the PARADOX inverse-physics engine, a collision momentum model, or a preventability determination. Do not use the sample data or exported report as forensic evidence.

## Intended production flow

1. Decode and inspect a user-provided clip.
2. Segment actors and obstacles, extract ground-contact tracks, and calibrate the camera to a metric ground plane.
3. Optimize a deterministic forward model against the measured trajectories and preserve residuals and assumptions.
4. Render the verified scene, telemetry, sightlines, counterfactuals, and a traceable report.

The interface establishes these review points, but the perception, calibration, physics, and report provenance services remain to be implemented and integrated.
