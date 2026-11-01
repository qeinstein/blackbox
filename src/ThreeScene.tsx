import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Maximize2, Pause, Play, RotateCcw, ZoomIn } from 'lucide-react'

type Point = { time_s: number; x_m: number | null; y_m: number | null; pixel_x: number; pixel_y: number; footprint_width_m?: number | null }
export type SceneActor = { id: string; class_name: string; concept: string; role: string; is_static_obstacle?: boolean; observations: Point[]; kinematics?: { mass_kg_assumed?: number | null } }
export type SceneAnalysis = { metadata: { duration_s: number; fps: number }; hypothesis: { scene_type: string; calibration: { available: boolean; status?: string } }; provenance: { metric_scale_available: boolean }; tracking: { actors: SceneActor[] } }
export type SimSample = { time_s: number; x_m: number; y_m: number; vx_mps: number; vy_mps: number; speed_mps: number }
export type SimActor = { id: string; class_name: string; is_static_obstacle: boolean; samples: SimSample[] }
export type SimulationResult = { actors: SimActor[]; assumptions: string[]; fit_residual_m: number | null; time_step_s: number; obstacles_removed: boolean; removed_obstacle_id?: string | null; gravity_mps2: number; friction_coefficient: number; collisions: { time_s: number; actor_a: string; actor_b: string }[] }

type Props = {
  analysis: SceneAnalysis | null | undefined
  time: number
  tracksVisible?: boolean
  simulation?: SimulationResult | null
  isPlaying?: boolean
  duration?: number
  onPlay?: () => void
  onTimeChange?: (time: number) => void
}

const COLORS = ['#e39a65', '#72c5b0', '#aaa0da', '#dbcb7b', '#78aaca', '#d28086']

function sampleScene(): SceneActor[] {
  return [
    { id: 'sample-car-a', class_name: 'Passenger car', concept: 'vehicle', role: 'moving', observations: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((time_s) => ({ time_s, x_m: -10 + time_s * 2, y_m: -2, pixel_x: -10 + time_s * 2, pixel_y: -2 })) },
    { id: 'sample-car-b', class_name: 'Passenger car', concept: 'vehicle', role: 'moving', observations: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((time_s) => ({ time_s, x_m: 2, y_m: 12 - time_s * 1.5, pixel_x: 2, pixel_y: 12 - time_s * 1.5 })) },
    { id: 'sample-rack', class_name: 'Storage rack', concept: 'stationary obstruction', role: 'static obstacle', is_static_obstacle: true, observations: [{ time_s: 0, x_m: -8, y_m: 8, pixel_x: -8, pixel_y: 8 }] },
  ]
}

function pointValue(point: Point, metric: boolean): [number, number] | null {
  if (metric && point.x_m !== null && point.y_m !== null) return [point.x_m, point.y_m]
  if (!metric) return [point.pixel_x, point.pixel_y]
  return null
}

function interpolate(points: { time_s: number; x: number; z: number; speed?: number }[], time: number) {
  if (points.length === 0) return null
  if (time <= points[0].time_s) return { ...points[0], yaw: points.length > 1 ? Math.atan2(-(points[1].z - points[0].z), points[1].x - points[0].x) : 0 }
  for (let index = 1; index < points.length; index += 1) {
    if (time <= points[index].time_s) {
      const before = points[index - 1]
      const after = points[index]
      const amount = (time - before.time_s) / Math.max(after.time_s - before.time_s, 1e-6)
      return { time_s: time, x: before.x + (after.x - before.x) * amount, z: before.z + (after.z - before.z) * amount, speed: before.speed === undefined || after.speed === undefined ? undefined : before.speed + (after.speed - before.speed) * amount, yaw: Math.atan2(-(after.z - before.z), after.x - before.x) }
    }
  }
  const last = points[points.length - 1]
  const prior = points[points.length - 2] ?? last
  return { ...last, yaw: Math.atan2(-(last.z - prior.z), last.x - prior.x) }
}

function createActorMesh(actor: SceneActor | SimActor, color: string, faded = false, relativeScale = false) {
  const name = actor.class_name.toLowerCase()
  const group = new THREE.Group()
  const material = (hex: string, opacity = faded ? 0.25 : 1) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.76, metalness: 0.08, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })
  const bodyMaterial = material(color)
  const glassMaterial = material('#a9c2bc', faded ? 0.18 : 0.82)
  const darkMaterial = material('#17282a', faded ? 0.2 : 1)
  const softMaterial = material('#dce6dc', faded ? 0.18 : 0.9)
  if (/person|pedestrian|worker|athlete|human/.test(name)) {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.72, 3, 8), bodyMaterial)
    torso.position.y = 1.08
    torso.castShadow = true
    group.add(torso)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), softMaterial)
    head.position.y = 1.68
    head.castShadow = true
    group.add(head)
  } else if (/ball|sphere/.test(name)) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 16), bodyMaterial)
    ball.position.y = 0.28
    ball.castShadow = true
    group.add(ball)
  } else if (/vehicle|car|sedan|truck|bus|van|forklift|motorcycle|bicycle/.test(name) || actor.id.startsWith('sample-car')) {
    const isLarge = /truck|bus|van/.test(name)
    const isForklift = /forklift/.test(name)
    const length = isLarge ? 6.2 : isForklift ? 2.7 : /motorcycle|bicycle/.test(name) ? 2.0 : 4.25
    const width = isLarge ? 2.35 : isForklift ? 1.2 : /motorcycle|bicycle/.test(name) ? 0.8 : 1.78
    const height = isLarge ? 2.8 : isForklift ? 2.3 : 1.42
    const wheels = isLarge ? 0.48 : 0.34
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(length, height * 0.45, width), bodyMaterial)
    chassis.position.y = wheels + height * 0.24
    chassis.castShadow = true
    chassis.receiveShadow = true
    group.add(chassis)
    if (!/motorcycle|bicycle/.test(name)) {
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(length * 0.43, height * 0.37, width * 0.86), glassMaterial)
      cabin.position.set(-length * 0.04, wheels + height * 0.57, 0)
      cabin.castShadow = true
      group.add(cabin)
    }
    for (const x of [-length * 0.32, length * 0.32]) for (const z of [-width * 0.51, width * 0.51]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheels, wheels, 0.18, 12), darkMaterial)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, wheels, z)
      wheel.castShadow = true
      group.add(wheel)
    }
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, width * 0.7), softMaterial)
    front.position.set(length * 0.49, wheels + height * 0.14, 0)
    group.add(front)
    if (isForklift) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, width * 0.7), darkMaterial)
      mast.position.set(length * 0.56, 1.1, 0)
      group.add(mast)
      const forks = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, width * 0.7), darkMaterial)
      forks.position.set(length * 0.55, 0.16, 0)
      group.add(forks)
    }
  } else {
    const isObstacle = Boolean((actor as SceneActor).is_static_obstacle)
    const box = new THREE.Mesh(new THREE.BoxGeometry(isObstacle ? 1.8 : 1.1, isObstacle ? 1.8 : 1.1, isObstacle ? 2.2 : 1.1), bodyMaterial)
    box.position.y = isObstacle ? 0.9 : 0.55
    box.castShadow = true
    box.receiveShadow = true
    group.add(box)
  }
  if (relativeScale) group.scale.setScalar(0.35)
  return group
}

export default function ThreeScene({ analysis, time, tracksVisible = true, simulation, isPlaying = false, duration = 15, onPlay, onTimeChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef(time)
  const [fullscreen, setFullscreen] = useState(false)
  const [playback, setPlayback] = useState(isPlaying)
  const [renderMessage, setRenderMessage] = useState('')
  const rebuildRef = useRef<((sceneAnalysis: SceneAnalysis | null | undefined, sceneSimulation: SimulationResult | null | undefined) => void) | null>(null)
  const demoActors = useMemo(sampleScene, [])
  const metric = Boolean(analysis?.provenance.metric_scale_available)
  const actors = analysis?.tracking.actors ?? demoActors
  const analysisKey = useMemo(() => JSON.stringify(analysis ? { metric, actors: actors.map((actor) => [actor.id, actor.class_name, actor.is_static_obstacle, actor.observations.map((point) => [point.time_s, point.x_m, point.y_m, point.pixel_x, point.pixel_y, point.footprint_width_m])]) } : 'demo'), [analysis, metric])
  const stableAnalysis = useMemo(() => analysis, [analysisKey])
  const stableSimulation = useMemo(() => simulation, [simulation])

  useEffect(() => { timeRef.current = time }, [time])
  useEffect(() => { setPlayback(isPlaying) }, [isPlaying])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      setRenderMessage('WebGL is unavailable in this browser. Enable hardware acceleration to explore this scene.')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#15292d')
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800)
    camera.position.set(18, 15, 20)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 2
    controls.maxDistance = 180
    controls.maxPolarAngle = Math.PI * 0.49
    controls.target.set(0, 0.5, 0)

    scene.add(new THREE.HemisphereLight('#e2e9df', '#334343', 2.0))
    const keyLight = new THREE.DirectionalLight('#fff0d6', 2.6)
    keyLight.position.set(-12, 24, 13)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.left = -36
    keyLight.shadow.camera.right = 36
    keyLight.shadow.camera.top = 36
    keyLight.shadow.camera.bottom = -36
    scene.add(keyLight)

    const dynamicRoot = new THREE.Group()
    const obstacleRoot = new THREE.Group()
    const traceRoot = new THREE.Group()
    const simulationRoot = new THREE.Group()
    const simulationTraceRoot = new THREE.Group()
    scene.add(dynamicRoot, obstacleRoot, traceRoot, simulationRoot, simulationTraceRoot)
    let actorMeshes: { actor: SceneActor; mesh: THREE.Group; trace?: THREE.Line; coordinates: { time_s: number; x: number; z: number }[] }[] = []
    let simulationMeshes: { actor: SimActor; mesh: THREE.Group; trace?: THREE.Line; coordinates: { time_s: number; x: number; z: number; speed?: number }[] }[] = []
    let animationId = 0
    let resizeObserver: ResizeObserver | null = null
    let hasBuiltScene = false

    const buildScene = (sceneAnalysis: SceneAnalysis | null | undefined, sceneSimulation: SimulationResult | null | undefined) => {
      for (const root of [dynamicRoot, obstacleRoot, traceRoot, simulationRoot, simulationTraceRoot]) {
        while (root.children.length) {
          const child = root.children[0]
          root.remove(child)
          child.traverse((object) => {
            if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
              object.geometry.dispose()
              const materials = Array.isArray(object.material) ? object.material : [object.material]
              materials.forEach((material) => material.dispose())
            }
          })
        }
      }
      const sceneActors = sceneAnalysis?.tracking.actors ?? demoActors
      const calibrated = Boolean(sceneAnalysis?.provenance.metric_scale_available)
      const selected = sceneActors.filter((actor) => actor.observations.length > 0)
      const raw = selected.flatMap((actor) => actor.observations.map((point) => pointValue(point, calibrated)).filter((point): point is [number, number] => point !== null))
      const scenarioRaw = sceneSimulation?.actors.flatMap((actor) => actor.samples.map((point) => [point.x_m, point.y_m] as [number, number])) ?? []
      const allRaw = [...raw, ...scenarioRaw]
      const minX = allRaw.length ? Math.min(...allRaw.map(([x]) => x)) : -8
      const maxX = allRaw.length ? Math.max(...allRaw.map(([x]) => x)) : 8
      const minZ = allRaw.length ? Math.min(...allRaw.map(([, z]) => z)) : -6
      const maxZ = allRaw.length ? Math.max(...allRaw.map(([, z]) => z)) : 6
      const centerX = (minX + maxX) / 2
      const centerZ = (minZ + maxZ) / 2
      const rawSpan = Math.max(maxX - minX, maxZ - minZ, 1)
      const scale = calibrated ? 1 : 20 / rawSpan
      const toWorld = (x: number, z: number) => [(x - centerX) * scale, (z - centerZ) * scale] as const
      const floorWidth = Math.max(12, (maxX - minX) * scale + 12)
      const floorDepth = Math.max(10, (maxZ - minZ) * scale + 10)
      if (!hasBuiltScene) {
        camera.position.set(floorWidth * 0.78, Math.max(11, floorDepth * 0.72), floorDepth * 0.92)
        camera.far = Math.max(300, floorWidth * 8)
        camera.updateProjectionMatrix()
        controls.target.set(0, 0.45, 0)
        controls.update()
        hasBuiltScene = true
      }

      const ground = new THREE.Mesh(new THREE.PlaneGeometry(floorWidth, floorDepth), new THREE.MeshStandardMaterial({ color: '#25383b', roughness: 0.95, metalness: 0.02 }))
      ground.rotation.x = -Math.PI / 2
      ground.receiveShadow = true
      obstacleRoot.add(ground)
      const grid = new THREE.GridHelper(Math.max(floorWidth, floorDepth), Math.max(12, Math.round(Math.max(floorWidth, floorDepth) / (calibrated ? 1 : 0.8))), '#526363', '#35494b')
      grid.position.y = 0.012
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
      gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.42; material.depthWrite = false })
      obstacleRoot.add(grid)

      const obstacles = selected.filter((actor) => actor.is_static_obstacle && !(sceneSimulation?.obstacles_removed && (!sceneSimulation.removed_obstacle_id || sceneSimulation.removed_obstacle_id === actor.id)))
      obstacles.forEach((actor) => {
        const point = actor.observations[Math.floor(actor.observations.length / 2)]
        const rawPoint = pointValue(point, calibrated)
        if (!rawPoint) return
        const [x, z] = toWorld(rawPoint[0], rawPoint[1])
        const mesh = createActorMesh(actor, '#71847d', false, !calibrated)
        mesh.position.set(x, 0, z)
        mesh.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true } })
        obstacleRoot.add(mesh)
      })

      const moving = selected.filter((actor) => !actor.is_static_obstacle && actor.observations.length > 0)
      actorMeshes = moving.map((actor, index) => {
        const color = COLORS[index % COLORS.length]
        const mesh = createActorMesh(actor, color, Boolean(sceneSimulation), !calibrated)
        dynamicRoot.add(mesh)
        const coordinates = actor.observations.flatMap((point) => {
          const value = pointValue(point, calibrated)
          if (!value) return []
          const [x, z] = toWorld(value[0], value[1])
          return [{ time_s: point.time_s, x, z }]
        }).sort((a, b) => a.time_s - b.time_s)
        if (coordinates.length > 1) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(coordinates.map((point) => new THREE.Vector3(point.x, 0.025 + index * 0.001, point.z))), new THREE.LineBasicMaterial({ color, transparent: true, opacity: sceneSimulation ? 0.32 : 0.88 }))
          traceRoot.add(line)
        }
        return { actor, mesh, coordinates }
      })

      simulationMeshes = (sceneSimulation?.actors ?? []).filter((actor) => !actor.is_static_obstacle && actor.samples.length > 0).map((actor, index) => {
        const baseIndex = moving.findIndex((item) => item.id === actor.id)
        const color = COLORS[(baseIndex >= 0 ? baseIndex : index) % COLORS.length]
        const sourceActor = moving.find((item) => item.id === actor.id) ?? { id: actor.id, class_name: actor.class_name, concept: actor.class_name, role: 'moving', observations: [] }
        const mesh = createActorMesh(sourceActor, color, false, !calibrated)
        simulationRoot.add(mesh)
        const coordinates = actor.samples.map((point) => {
          const [x, z] = toWorld(point.x_m, point.y_m)
          return { time_s: point.time_s, x, z, speed: point.speed_mps }
        })
        if (coordinates.length > 1) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(coordinates.map((point) => new THREE.Vector3(point.x, 0.035, point.z))), new THREE.LineDashedMaterial({ color: '#83d4ba', dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.92 }))
          line.computeLineDistances()
          simulationTraceRoot.add(line)
        }
        return { actor, mesh, coordinates }
      })
    }
    rebuildRef.current = buildScene

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()
    const clock = new THREE.Clock()
    const render = () => {
      animationId = window.requestAnimationFrame(render)
      const delta = Math.min(clock.getDelta(), 0.05)
      controls.update()
      const currentTime = timeRef.current
      for (const entry of actorMeshes) {
        const point = interpolate(entry.coordinates, currentTime)
        if (!point) continue
        entry.mesh.position.set(point.x, 0, point.z)
        entry.mesh.rotation.y = point.yaw
      }
      for (const entry of simulationMeshes) {
        const point = interpolate(entry.coordinates, currentTime)
        if (!point) continue
        entry.mesh.position.set(point.x, 0, point.z)
        entry.mesh.rotation.y = point.yaw
      }
      renderer.render(scene, camera)
      void delta
    }
    render()

    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shellRef.current)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      rebuildRef.current = null
      window.cancelAnimationFrame(animationId)
      resizeObserver?.disconnect()
      controls.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.GridHelper) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    rebuildRef.current?.(stableAnalysis, stableSimulation)
  }, [stableAnalysis, stableSimulation, demoActors, metric])

  const toggleFullscreen = async () => {
    setRenderMessage('')
    try {
      if (document.fullscreenElement === shellRef.current) await document.exitFullscreen()
      else await shellRef.current?.requestFullscreen()
    } catch {
      setRenderMessage('Fullscreen is unavailable in this browser window.')
    }
  }
  const togglePlayback = () => {
    if (onPlay) onPlay()
    else setPlayback((value) => !value)
  }
  const activePlayback = onPlay ? isPlaying : playback

  return (
    <div className={`three-scene-shell ${fullscreen ? 'is-fullscreen' : ''}`} ref={shellRef}>
      <div className="three-scene-canvas" ref={hostRef} role="img" aria-label="Interactive three-dimensional reconstruction. Drag to orbit, right-drag to pan, and scroll to zoom." />
      <div className="three-scene-controls">
        <span className="three-scene-scale"><span />{analysis ? metric ? 'METRIC SCALE · REVIEW' : 'RELATIVE SCALE · ESTIMATED' : 'SAMPLE ENVIRONMENT · ILLUSTRATIVE'}</span>
        <button type="button" className="three-scene-button" aria-label={fullscreen ? 'Exit fullscreen scene' : 'Open fullscreen scene'} title={fullscreen ? 'Exit fullscreen' : 'Explore fullscreen'} onClick={() => void toggleFullscreen()}><Maximize2 size={15} /></button>
      </div>
      {renderMessage && <div className="three-scene-message" role="status">{renderMessage}</div>}
      {fullscreen && <div className="three-scene-fullscreen-playback" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="three-scene-button" aria-label={activePlayback ? 'Pause scene playback' : 'Play scene playback'} onClick={togglePlayback}>{activePlayback ? <Pause size={15} /> : <Play size={15} />}</button>
        <button type="button" className="three-scene-button" aria-label="Reset scene playback" onClick={() => { onTimeChange?.(0); if (activePlayback) onPlay?.(); setPlayback(false) }}><RotateCcw size={14} /></button>
        <input aria-label="Scrub reconstructed motion" type="range" min="0" max={Math.max(duration, 0.1)} step="0.02" value={Math.min(time, duration)} onChange={(event) => onTimeChange?.(Number(event.target.value))} />
        <span>{time.toFixed(2)} s</span>
      </div>}
      {!fullscreen && tracksVisible && <span className="three-scene-orbit-hint"><ZoomIn size={12} />Drag to orbit · scroll to zoom</span>}
    </div>
  )
}
