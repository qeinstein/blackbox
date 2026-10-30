# BLACKBOX

BLACKBOX is a local, Meta Model API connected workspace for reviewing short, stationary-camera vehicle and workplace incident clips. The browser never receives the Meta API key. Muse Spark 1.3 creates a structured scene hypothesis; SAM 3.1 returns video masks; the local service extracts ground-contact tracks, applies a planar scale hypothesis or analyst-entered scale, and calculates track-based motion estimates.

## Start the workspace

Requirements: Node.js 18 or newer, Python 3.10 or newer, and a Meta Model API key with access to Muse Spark 1.3 and SAM 3.1.

```sh
npm install
npm run dev
```

The first run creates a Python virtual environment, installs the local analysis service, and creates `.env` from `.env.example`. Open `.env` in the project folder, add the Meta key, and save:

```dotenv
MODEL_API_KEY=your_meta_model_api_key
```

The development server watches `.env` and reloads the API process. Open the local Vite address printed in the terminal (normally `http://127.0.0.1:5173`), then choose **Test Meta**. The test makes a small Muse Spark request. The same key is used for Muse Spark and SAM 3.1; no model key is entered in the browser.

## Analyze a clip

1. Choose **New case**, select an MP4 or MOV video (up to 250 MB and 90 seconds), and submit it.
2. Follow the analysis stage and progress in Reconstruction. The original clip is stored under the local `data/` directory and uploaded to Meta for model processing. Response persistence is disabled on inference requests, and BLACKBOX requests deletion of the temporary Meta file after analysis; remote deletion is best effort, and the account's Meta data policy still applies. Meta's [Zero Data Retention mode](https://dev.meta.ai/help/policies-and-privacy/zero-data-retention) is separately enabled for eligible organizations and does not support Files API uploads. SAM video segmentation is billed per processed video frame; this flow sends three SAM requests (vehicle, pedestrian, and stationary obstruction), so check your current [Meta API pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits) before processing a large clip.
3. Review the model’s scene hypothesis and SAM tracks. Use the four draggable ground-plane corners and enter the measured rectangle width and length to apply an analyst-entered scale. This reprojects the saved track points and recalculates metric values.
4. Review the findings and export the estimate CSV. Counterfactuals are limited to a stopping-distance calculation when a metric track and scale are available.

Case metadata and analysis are stored in `data/blackbox.sqlite3`; source video files are stored in `data/uploads/`. Both are ignored by Git. Use **Retry analysis** after a temporary API failure. Remove a case through `DELETE /api/cases/{case_id}` or remove the local `data/` directory when the service is stopped.

## What the connected pipeline calculates

- Muse Spark returns a constrained JSON hypothesis for scene type, actors, possible impact time, obstacles, limitations, and possible calibration evidence. These are model outputs, not facts verified by BLACKBOX.
- SAM 3.1 is called for vehicles, pedestrians, and stationary obstructions. The local service decodes mask rasters, finds bottom-edge contact points, and smooths the resulting coordinates with local quadratic fits over a short centered window.
- A planar homography maps pixel coordinates to meters when an analyst supplies a measured rectangle, or when a model-proposed scale passes basic geometry checks. Every scale remains marked for review. If no scale is available, the UI keeps tracks in pixels and suppresses metric speeds.
- Speeds are point-to-point estimates from detected contacts. The trajectory residual comes from a least-squares constant-acceleration fit. The application does not yet implement an inverse optimizer that searches braking and friction parameters, impact momentum conservation, a full rigid-body collision model, obstacle raycasting, or a validated driver-sightline analysis.
- The uploaded-case counterfactual calculator applies `d = v·tᵣ + v²/(2μg)` to a selected speed, reaction time, and friction. It does not know the clip’s clear hazard distance and does not make a preventability or liability determination.

This version is a review tool for model-assisted estimates, not a certified forensic reconstruction or legal evidence package. Confirm camera stability, ground-plane geometry, reference dimensions, frame timing, segmentation, and physical assumptions with a qualified analyst before relying on any result.

## Development and checks

```sh
npm run build
.venv/bin/pytest
```

The local service runs at `127.0.0.1:8000`; Vite proxies `/api` requests to it. `GET /api/health` is the local service health check, and `POST /api/status/test` checks Muse Spark API access. A real video analysis also exercises SAM 3.1 and requires a valid account key and model access.
