# BLACKBOX — video to 3D

BLACKBOX turns short videos into interactive 3D scene estimates. The current prototype is optimized for stationary cameras, visible flat ground planes, and moving objects that remain on that plane. It combines Meta Muse Spark scene interpretation, SAM 3.1 object masks, local trajectory fitting, a Three.js scene viewer, and a deterministic counterfactual simulator.

## Start the workspace

1. Create a Meta Model API key and place it in `.env` as `MODEL_API_KEY=...`. The development script creates `.env` from `.env.example` on first launch. The key stays on the local server.
2. Run `npm run dev` from the project directory.
3. Open `http://127.0.0.1:5173`, choose **New video**, and upload a clip.
4. Review the 3D scene and ground-plane estimate. For physics chat, drag the four ground-plane corners onto a known flat rectangle and enter its measured width and length.
5. Open **Ask the scene** to request a counterfactual in natural language. Muse Spark translates the request into bounded structured parameters; the local deterministic engine calculates the motion.

The API is at `127.0.0.1:8000`; Vite proxies `/api` requests to it. Source clips and scene data are stored locally in the ignored `data/` folder. Videos are also uploaded to Meta for inference. Inference requests disable response storage and BLACKBOX requests deletion of the temporary Meta file after processing when the API allows it. Remote deletion is best effort and Meta account policies still apply. SAM video processing is billed per frame for each detected object type, so check current [Meta pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits).

## Current input limits

- MP4 or MOV containers with H.264, H.265, or MPEG-4 video
- 15 seconds maximum
- 100 MB maximum
- No side longer than 1,920 pixels and no more than 2.1 megapixels per frame
- 60 FPS maximum
- The complete clip is decoded before it is accepted; truncated and malformed media is rejected

Muse Spark identifies relevant object classes first. SAM 3.1 is then called only for the object types found in that scene, reducing unnecessary full-video inference requests while retaining the clip's source frame cadence for motion tracking.

## What the prototype produces

- SAM 3.1 boxes and masks for moving objects and identified static obstructions.
- Ground-contact point estimates, smoothed over time to reduce segmentation jitter.
- A planar camera homography when a plausible reference is visible, with unknown scale kept explicit.
- A Three.js environment with a ground plane, class-based 3D object proxies, estimated static obstacle volumes, trajectory paths, lighting, shadows, orbit, pan, zoom, and fullscreen controls.
- Playback synchronized to the source video and reconstructed object tracks.
- Conversational what-if changes for an object's speed, start time, heading, braking, gravity/friction-limited motion, or removal of a detected obstruction.
- Deterministic numerical motion and approximate collision response after Muse Spark returns validated parameter values.

For physics chat, a user must enter a known ground-plane measurement. Muse Spark does not write simulated outcomes; it only returns a structured, range-checked parameter change. The engine fits constant acceleration to observed metric tracks, integrates at the clip frame rate (capped at 60 Hz), applies friction-limited braking, and uses circular object proxies for contact events. Multiple chat requests build on the prior scenario state; **Reset scene** returns to the reconstructed tracks.

## Accuracy limits

A monocular video cannot reveal hidden surfaces, exact depth, or reliable object dimensions by itself. BLACKBOX labels uncalibrated coordinates as relative, asks for a measured scale before physics simulation, and distinguishes detected track data from simulated outcomes. Vertical object sizes and collision footprints are class-based estimates. Ground-constrained gravity changes affect friction-limited braking only; this prototype does not create airborne motion, model detailed steering, deformable bodies, or recover complete architecture. Heading changes are instantaneous, and shifted paths extrapolate outside their observed timestamps. High track-fit error is rejected before simulation. Outputs are scenario estimates, not guarantees or legal, insurance, or engineering determinations.

This release supports stationary-camera clips with a mostly level visible surface. Moving cameras, tumbling/zooming footage, complex elevation changes, occluded trajectories, and scenes without enough metric observations may require stabilization, additional measurements, or may be refused by the simulator. The broader platform could serve workplace safety, traffic, robotics, sports, engineering, and education, but those specialized workflows are not separately implemented here.

## Verification

Run the frontend production build with `npm run build` and backend tests with `.venv/bin/pytest -q`. `GET /api/status` reports model names and media limits. `POST /api/status/test` checks Muse Spark access. A real upload is needed to exercise Meta SAM 3.1 segmentation.
