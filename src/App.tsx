import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight,
  BarChart3, Bell, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Clock3, Crosshair, Download, FileVideo2, Grid2X2, HardDrive,
  Layers3, Link2, Maximize2, MoreHorizontal, Pause, Play, Plus,
  RotateCcw, ScanLine, Search, Send, Settings2, ShieldCheck,
  Upload, Waypoints, X, type LucideIcon,
} from 'lucide-react'
import ThreeScene, { type SceneAnalysis, type SimulationResult } from './ThreeScene'

type Screen = 'cases' | 'reconstruction' | 'counterfactual' | 'findings'
type AnalysisTab = 'summary' | 'physics' | 'limits'

type IncidentCase = {
  id: string
  title: string
  site: string
  date: string
  category: string
  status: string
  videoName?: string
  videoUrl?: string
  analysis_status?: 'queued' | 'running' | 'completed' | 'failed' | null
  analysis_stage?: string | null
  analysis_progress?: number | null
  analysis_message?: string | null
  analysis_error?: string | null
  duration_s?: number
  width?: number
  height?: number
  fps?: number
  analysis?: AnalysisResult | null
}

type TrackObservation = { frame: number; time_s: number; pixel_x: number; pixel_y: number; x_m: number | null; y_m: number | null; footprint_width_m?: number | null; confidence?: number | null }
type AnalysisActor = { id: string; concept: string; class_name: string; role: string; is_static_obstacle?: boolean; mass_kg_assumed?: number | null; observations: TrackObservation[]; kinematics: { first_observed_speed_mps?: number | null; first_observed_speed_mph: number | null; speed_near_impact_mph: number | null; braking_onset_candidate_s: number | null; trajectory_fit_residual_m: number | null } }
type AnalysisResult = {
  metadata: { duration_s: number; width: number; height: number; fps: number }
  hypothesis: { scene_type: string; stationary_camera: boolean; summary: string; impact_time_s: number | null; calibration: { available: boolean; status: string; source: string; evidence: string; confidence: number | null; review_required: boolean; reviewed_by_user?: boolean; width_m?: number | null; length_m?: number | null; image_corners?: number[][] | null }; obstacles: string[]; limitations: string[] }
  tracking: { actors: AnalysisActor[]; mean_fit_residual_m: number | null; fit_model: string; fit_note: string }
  provenance: { classification: string; metric_scale_available: boolean; deterministic_claim: string; not_a_finding: string }
}

type ServiceStatus = { ready: boolean; models: { scene_analysis: string; video_segmentation: string }; setup?: string | null }
type ScenarioState = { actor_id: string | null; speed_scale: number; start_time_shift_s: number; heading_change_deg: number; brake_at_s: number | null; gravity_mps2: number; friction_coefficient: number; obstacles_removed: boolean; obstacle_id: string | null }
type SimulationResponse = { supported: boolean; explanation: string; scenario: ScenarioState; simulation: SimulationResult | null }

const initialCases: IncidentCase[] = [
  { id: 'WB-0248', title: 'Intersection approach', site: 'Road scene · sample', date: '18 Oct 2026', category: 'Traffic motion', status: 'Illustrative scene' },
  { id: 'WH-0112', title: 'Warehouse aisle', site: 'Work floor · sample', date: '11 Oct 2026', category: 'Workplace motion', status: 'Illustrative scene' },
  { id: 'RT-0086', title: 'Cyclist route', site: 'Street scene · sample', date: '03 Oct 2026', category: 'Moving objects', status: 'Illustrative scene' },
]

const navItems: { id: Screen; label: string; icon: LucideIcon }[] = [
  { id: 'cases', label: 'Scene library', icon: Layers3 },
  { id: 'reconstruction', label: '3D reconstruction', icon: Crosshair },
  { id: 'counterfactual', label: 'Ask the scene', icon: Waypoints },
  { id: 'findings', label: 'Motion data', icon: BarChart3 },
]

function formatTime(time: number) {
  const mins = Math.floor(time / 60)
  const secs = (time % 60).toFixed(2).padStart(5, '0')
  return `${String(mins).padStart(2, '0')}:${secs}`
}

async function responseError(response: Response): Promise<string> {
  try { const body = await response.json(); return typeof body.detail === 'string' ? body.detail : `Request failed with HTTP ${response.status}.` }
  catch { return `Request failed with HTTP ${response.status}.` }
}

function sampleSpeedKmh(time: number) {
  const entryKmh = 42 * 1.60934
  const impactKmh = 31 * 1.60934
  if (time <= 4.62) return entryKmh
  if (time <= 5.2) return entryKmh - ((time - 4.62) / .58) * (entryKmh - impactKmh)
  return Math.max(0, impactKmh * (1 - (time - 5.2) / (9.18 - 5.2)))
}

function IconButton({ label, children, onClick, className = '' }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function BrandMark() {
  return (
    <div className="brand-lockup" aria-label="BLACKBOX">
      <div className="brand-symbol" aria-hidden="true"><span /><span /><span /><span /></div>
      <span className="brand-name">BLACKBOX</span>
    </div>
  )
}

function Sidebar({ page, cases, activeCaseId, onNavigate, onSelectCase, onNewCase, onHelp }: { page: Screen; cases: IncidentCase[]; activeCaseId: string; onNavigate: (screen: Screen) => void; onSelectCase: (item: IncidentCase) => void; onNewCase: () => void; onHelp: () => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top"><BrandMark /><IconButton label="Collapse navigation" className="sidebar-collapse"><ArrowLeft size={15} /></IconButton></div>
      <div className="workspace-switcher">
        <div className="workspace-avatar">F</div>
        <div className="workspace-copy"><strong>BLACKBOX Lab</strong><span>Workspace</span></div>
        <ChevronDown className="switcher-chevron" size={14} />
      </div>
      <div className="side-label">Workspace</div>
      <nav className="primary-nav" aria-label="Workspace navigation">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)} aria-current={page === id ? 'page' : undefined}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            {id === 'cases' && <span className="nav-count">{String(cases.length).padStart(2, '0')}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-section-title"><span>Recent scenes</span><button type="button" aria-label="Add a video scene" onClick={onNewCase}><Plus size={15} /></button></div>
      <div className="recent-cases">
        {cases.slice(0, 4).map((item, index) => (
          <button type="button" key={item.id} className={`recent-case ${item.id === activeCaseId && page !== 'cases' ? 'selected' : ''}`} onClick={() => onSelectCase(item)}>
            <span className={`case-dot dot-${index}`} /><span className="recent-case-text"><strong>{item.title}</strong><small>{item.id}</small></span>
          </button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="storage-card"><div className="storage-heading"><HardDrive size={14} /><span>Local workspace</span></div><div className="storage-meter"><span /></div><small>Source videos stay in this workspace</small></div>
        <button type="button" className="nav-item utility-item" onClick={onHelp}><CircleHelp size={17} /><span>Help &amp; documentation</span></button>
        <button type="button" className="profile-button"><span className="profile-avatar">AM</span><span className="profile-copy"><strong>Alex Morgan</strong><small>Scene explorer</small></span><MoreHorizontal size={17} /></button>
      </div>
    </aside>
  )
}

function Topbar({ title, onNewCase, onShare, onExport, onSearch, onNotifications, serviceReady, onTestMeta, testingMeta, metaTestMessage }: { title: string; onNewCase: () => void; onShare: () => void; onExport: () => void; onSearch: () => void; onNotifications: () => void; serviceReady: boolean; onTestMeta: () => void; testingMeta: boolean; metaTestMessage: string }) {
  return (
    <header className="topbar">
      <div className="breadcrumb"><span>BLACKBOX workspace</span><ChevronRight size={14} /><strong>{title}</strong></div>
      <div className="topbar-actions">
        <span className={`demo-mode-chip ${serviceReady ? 'service-ready' : ''}`}><span className="demo-dot" />{serviceReady ? 'META KEY SET' : 'LOCAL WORKSPACE'}</span>
        <button type="button" className="button button-quiet top-share" onClick={onTestMeta} disabled={testingMeta} title={metaTestMessage || 'Check the Meta Muse Spark API connection'}>{testingMeta ? 'Testing…' : 'Test Meta'}</button>
        <IconButton label="Search cases" onClick={onSearch}><Search size={17} /></IconButton>
        <IconButton label="Notifications" onClick={onNotifications}><Bell size={17} /></IconButton>
        <span className="topbar-divider" />
        <button type="button" className="button button-quiet top-share" onClick={onShare}><Link2 size={15} />Share</button>
        <button type="button" className="button button-primary top-new" onClick={onNewCase}><Plus size={16} />New video</button>
        {title === 'Motion data' && <button type="button" className="button button-quiet top-export" onClick={onExport}><Download size={15} />Export</button>}
      </div>
    </header>
  )
}

function CaseHeader({ currentCase, page, onNavigate }: { currentCase: IncidentCase; page: Screen; onNavigate: (screen: Screen) => void }) {
  return (
    <div className="case-header">
      <div className="case-heading-main">
        <div className="case-meta-line"><span className="case-id-tag">{currentCase.id}</span><span className="meta-dot" /><span>{currentCase.category}</span><span className="meta-dot" /><span>{currentCase.date}</span></div>
        <h1>{page === 'cases' ? 'Scene library' : page === 'counterfactual' ? 'Ask the scene' : page === 'findings' ? 'Motion data' : '3D reconstruction'}</h1>
        <p className="case-subtitle">{page === 'cases' ? 'Browse videos and explore their reconstructed environments.' : <>{currentCase.title}<span className="inline-separator">/</span>{currentCase.site}</>}</p>
      </div>
      <div className="case-heading-actions">
        {page !== 'cases' && <span className="reference-badge"><ShieldCheck size={14} />{currentCase.videoUrl ? currentCase.analysis?.provenance.metric_scale_available ? 'Scale estimate · review' : 'Uploaded clip · scale pending' : 'Illustrative sample'}</span>}
        {page !== 'cases' && <button type="button" className="button button-outline" onClick={() => onNavigate('findings')}><FileVideo2 size={15} />Scene data</button>}
      </div>
    </div>
  )
}

function StatusDot({ children, tone = 'teal' }: { children: ReactNode; tone?: 'teal' | 'orange' | 'muted' }) {
  return <span className={`status-pill status-${tone}`}><span className="status-pip" />{children}</span>
}

function EvidenceScene({ time, gridVisible, tracksVisible }: { time: number; gridVisible: boolean; tracksVisible: boolean }) {
  const blend = Math.min(time / 5.2, 1)
  const aX = 90 + blend * 350
  const bY = 400 - blend * 160
  return (
    <svg className="evidence-svg" viewBox="0 0 800 480" role="img" aria-label="Illustrative CCTV frame showing two vehicles approaching an intersection">
      <defs>
        <linearGradient id="cctv-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8dbd5" /><stop offset="1" stopColor="#8b9893" /></linearGradient>
        <linearGradient id="cctv-road" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#444f50" /><stop offset="1" stopColor="#283234" /></linearGradient>
        <radialGradient id="cctv-vignette"><stop offset="62%" stopColor="#0d191a" stopOpacity="0" /><stop offset="100%" stopColor="#0d191a" stopOpacity=".55" /></radialGradient>
        <filter id="cctv-grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncA type="table" tableValues="0 .1" /></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light" /></filter>
      </defs>
      <rect width="800" height="480" fill="url(#cctv-sky)" />
      <path d="M0 0h800v135l-115 20-110-18-136 24-154-12L0 173Z" fill="#b8c3bc" />
      <path d="m0 45 143-19 44 106-187 27Zm800-39L676 24l-48 110 172 22Z" fill="#838e88" />
      <path d="M0 177 800 135v345H0Z" fill="url(#cctv-road)" />
      <path d="M0 217 800 190M0 419l800-40" stroke="#d3d3bd" strokeWidth="3" opacity=".48" />
      <path d="m370 152 34-2-10 326-40 4Zm42-1 34-2-5 324-37 3Z" fill="#454d4a" />
      <path d="M384 154h7l-3 70-8 1Zm-4 102 7-1-4 66-8 1Zm-5 100 7-1-4 59-7 1Z" fill="#e6e3cf" opacity=".7" />
      <path d="M349 253 463 247" stroke="#d8d8c5" strokeWidth="3" opacity=".7" />
      {[0,1,2,3,4].map((n) => <path key={`cross-${n}`} d={`M${347+n*25} 232l-1 31 14-1 1-31Z`} fill="#e2e2d1" opacity=".7" />)}
      <path d="M518 170h104v21H518zM88 220h93v19H88zM591 405h85v18h-85z" fill="#79837d" opacity=".7" />
      <path d="M550 160v-37m0 0h31m-31 10h27m-27 10h24" stroke="#35453d" strokeWidth="4" />
      <g opacity=".65" fill="#576a58"><circle cx="105" cy="156" r="27" /><circle cx="142" cy="160" r="31" /><circle cx="694" cy="166" r="34" /><circle cx="746" cy="161" r="28" /></g>
      <g opacity=".6" fill="#d8d6c4"><rect x="62" y="140" width="90" height="27" /><rect x="605" y="132" width="93" height="31" /></g>
      <g transform={`translate(${aX} ${291 - blend*26}) rotate(-2)`}>
        <rect x="-35" y="-14" width="70" height="28" rx="6" fill="#596a70" stroke="#c5c9bd" strokeWidth="2" />
        <rect x="-14" y="-11" width="24" height="22" rx="4" fill="#a6b4b0" opacity=".8" />
        <rect x="-32" y="-17" width="10" height="5" rx="2" fill="#e9dfb9" /><rect x="23" y="12" width="10" height="5" rx="2" fill="#c47f65" />
      </g>
      <g transform={`translate(425 ${bY}) rotate(1)`}>
        <rect x="-16" y="-34" width="32" height="68" rx="7" fill="#b4b4a5" stroke="#e4e0ce" strokeWidth="2" />
        <rect x="-12" y="-17" width="24" height="25" rx="4" fill="#657276" opacity=".8" />
        <rect x="-13" y="-31" width="8" height="4" rx="2" fill="#eee4c5" /><rect x="5" y="29" width="8" height="4" rx="2" fill="#bb7762" />
      </g>
      {tracksVisible && <g fill="none" stroke="#dc9763" strokeWidth="2.5" strokeDasharray="8 7"><path d={`M${aX} 291 440 265`} /><path d={`M425 ${bY} 425 260`} /></g>}
      {gridVisible && <g className="calibration-grid" stroke="#a8e0cf" strokeWidth="1" opacity=".6"><path d="M0 260 800 215M0 320 800 278M0 380 800 341M0 440 800 402" /><path d="m175 0 18 480m111-480 4 480m153-480-10 480m155-480-23 480m163-480-37 480" /><path d="M260 260 393 210 535 255 389 305Z" strokeDasharray="5 5" /></g>}
      <rect width="800" height="480" fill="url(#cctv-vignette)" />
      <rect width="800" height="480" fill="#9dad94" opacity=".06" filter="url(#cctv-grain)" />
      <rect x="1" y="1" width="798" height="478" fill="none" stroke="#eef0df" strokeOpacity=".18" />
    </svg>
  )
}

type CalibrationPoint = [number, number]

function CalibrationOverlay({ points, onPointsChange }: { points: CalibrationPoint[]; onPointsChange: (points: CalibrationPoint[]) => void }) {
  const dragging = useRef<number | null>(null)
  const movePoint = (index: number, clientX: number, clientY: number, target: HTMLElement) => {
    const frame = target.closest('.evidence-viewport')
    if (!frame) return
    const bounds = frame.getBoundingClientRect()
    const x = Math.max(2, Math.min(98, ((clientX - bounds.left) / bounds.width) * 100))
    const y = Math.max(3, Math.min(97, ((clientY - bounds.top) / bounds.height) * 100))
    onPointsChange(points.map((point, pointIndex) => pointIndex === index ? [x, y] : point))
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current !== null) movePoint(dragging.current, event.clientX, event.clientY, event.target as HTMLElement)
  }
  const keyMove = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const delta = directions[event.key]
    if (!delta) return
    event.preventDefault()
    onPointsChange(points.map((point, pointIndex) => pointIndex === index ? [Math.max(2, Math.min(98, point[0] + delta[0])), Math.max(3, Math.min(97, point[1] + delta[1]))] : point))
  }
  return (
    <div className="calibration-overlay" onPointerMove={handlePointerMove} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }}>
      <svg className="calibration-plane" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={points.map((point) => point.join(',')).join(' ')} fill="rgba(130,205,175,.09)" stroke="#a5ddc1" strokeWidth=".45" strokeDasharray="1.2 1" /><path d={`M${points[0][0]} ${points[0][1]} L${points[2][0]} ${points[2][1]} M${points[1][0]} ${points[1][1]} L${points[3][0]} ${points[3][1]}`} fill="none" stroke="#b2e4ca" strokeWidth=".35" strokeDasharray="1 1" /></svg>
      {points.map((point, index) => <button type="button" key={index} className="calibration-handle" style={{ left: `${point[0]}%`, top: `${point[1]}%` }} aria-label={`Move calibration grid corner ${index + 1}; use arrow keys for fine adjustment`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragging.current = index }} onPointerUp={() => { dragging.current = null }} onKeyDown={(event) => keyMove(event, index)}><span /></button>)}
    </div>
  )
}

function EvidencePanel({ time, gridVisible, tracksVisible, onGridToggle, onMaximize, videoUrl, videoRef, onLoadedMetadata, onTimeUpdate, calibrationPoints, onCalibrationPointsChange }: {
  time: number; gridVisible: boolean; tracksVisible: boolean; onGridToggle: () => void; onMaximize: () => void;
  videoUrl?: string; videoRef: RefObject<HTMLVideoElement>; onLoadedMetadata: (duration: number) => void; onTimeUpdate: (time: number) => void; calibrationPoints: CalibrationPoint[]; onCalibrationPointsChange: (points: CalibrationPoint[]) => void
}) {
  return (
    <section className="visual-panel evidence-panel" aria-label="Source video">
      <div className="visual-panel-header">
        <div className="panel-title-group"><span className="panel-kicker">SOURCE VIDEO</span><strong>{videoUrl ? 'Uploaded video' : 'Sample camera view'}</strong></div>
        <div className="panel-header-actions"><StatusDot tone="orange">{videoUrl ? 'Local video' : 'Sample scene'}</StatusDot><IconButton label="Expand source video" onClick={onMaximize}><Maximize2 size={15} /></IconButton></div>
      </div>
      <div className="evidence-viewport">
        {videoUrl ? <video ref={videoRef} className="uploaded-video" src={videoUrl} muted playsInline onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget.duration)} onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)} aria-label="Uploaded video" /> : <EvidenceScene time={time} gridVisible={gridVisible} tracksVisible={tracksVisible} />}
      {gridVisible && <CalibrationOverlay points={calibrationPoints} onPointsChange={onCalibrationPointsChange} />}
      <div className="camera-stamp"><span>{videoUrl ? 'SOURCE' : 'CAM 04'}</span><span>{formatTime(time)}</span><span className="record-led">REC</span></div>
        {gridVisible && <div className="grid-state-label"><Grid2X2 size={12} />{videoUrl ? 'GROUND PLANE · DRAG CORNERS' : 'DEMO GRID · NOT CALIBRATED'}</div>}
        {!videoUrl && <div className="footage-note"><span>Sample footage · illustrative</span></div>}
      </div>
      <div className="visual-panel-footer"><div className="legend-item"><span className="legend-line legend-orange" />Object A</div><div className="legend-item"><span className="legend-line legend-teal" />Object B</div><button type="button" className={`tool-toggle ${gridVisible ? 'tool-active' : ''}`} onClick={onGridToggle} aria-pressed={gridVisible}><Grid2X2 size={14} />{gridVisible ? 'Grid on' : 'Calibrate'}</button></div>
    </section>
  )
}

function TwinPanel({ time, duration, isPlaying, onPlay, onTimeChange, onToggleTracks, tracksVisible, analysis, useActualData, simulation }: { time: number; duration: number; isPlaying: boolean; onPlay: () => void; onTimeChange: (time: number) => void; onToggleTracks: () => void; tracksVisible: boolean; analysis?: AnalysisResult | null; useActualData: boolean; simulation?: SimulationResult | null }) {
  return (
    <section className="visual-panel twin-panel" aria-label={analysis ? 'Interactive 3D scene reconstruction' : useActualData ? 'Scene reconstruction preview' : 'Illustrative 3D sample environment'}>
      <div className="visual-panel-header twin-header">
        <div className="panel-title-group"><span className="panel-kicker">{analysis ? 'VIDEO-TO-3D SCENE' : 'INTERACTIVE 3D VIEW'}</span><strong>{analysis ? analysis.hypothesis.scene_type || 'Reconstructed environment' : useActualData ? 'Waiting for scene tracking' : 'Sample environment'}</strong></div>
        <div className="panel-header-actions"><StatusDot tone={analysis?.provenance.metric_scale_available ? 'teal' : 'orange'}>{analysis ? analysis.provenance.metric_scale_available ? 'Metric · review' : 'Relative scale' : useActualData ? 'Processing' : 'Illustrative'}</StatusDot><button type="button" className="icon-button" aria-label="Show or hide scene paths" aria-pressed={tracksVisible} onClick={onToggleTracks}><Waypoints size={15} /></button></div>
      </div>
      <div className="twin-viewport">{useActualData && !analysis ? <div className="track-empty"><Waypoints size={24} /><strong>3D scene will appear here</strong><span>BLACKBOX is tracking objects and estimating the ground plane.</span></div> : <ThreeScene analysis={analysis as SceneAnalysis | null | undefined} simulation={simulation} time={time} duration={duration} tracksVisible={tracksVisible} isPlaying={isPlaying} onPlay={onPlay} onTimeChange={onTimeChange} />}</div>
      <div className="visual-panel-footer twin-footer"><div className="legend-item"><span className="legend-dot legend-orange-dot" />{simulation ? 'Simulated path' : 'Tracked path'}</div><div className="legend-item">{analysis ? (analysis.provenance.metric_scale_available ? 'Metric scale · review' : 'Relative scale · estimate') : 'Sample geometry'}</div><span className="coordinate-readout">{analysis ? `${analysis.tracking.actors.length} objects` : 'Sample scene'}</span></div>
    </section>
  )
}

function Timeline({ time, duration, isPlaying, onPlay, onTimeChange, onStep, impactTime, impactLabel = 'IMPACT', fps = 30 }: { time: number; duration: number; isPlaying: boolean; onPlay: () => void; onTimeChange: (time: number) => void; onStep: (direction: number) => void; impactTime?: number; impactLabel?: string; fps?: number }) {
  const safeDuration = duration > 0 ? duration : 10.4
  const visibleImpactTime = impactTime !== undefined && impactTime <= safeDuration ? impactTime : undefined
  const ticks = visibleImpactTime === undefined
    ? [0, safeDuration * .2, safeDuration * .4, safeDuration * .6, safeDuration * .8, safeDuration]
    : [0, safeDuration * .2, safeDuration * .35, visibleImpactTime, safeDuration * .78, safeDuration]
  return (
    <section className="timeline-panel" aria-label="Synchronized video and scene timeline">
      <div className="timeline-toolbar"><div className="timeline-controls"><IconButton label="Step back one frame" onClick={() => onStep(-1)}><ArrowLeft size={15} /></IconButton><button type="button" className="play-button" aria-label={isPlaying ? 'Pause playback' : 'Play synchronized playback'} onClick={onPlay}>{isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><IconButton label="Step forward one frame" onClick={() => onStep(1)}><ArrowRight size={15} /></IconButton></div><div className="timeline-time"><strong>{formatTime(time)}</strong><span>/</span><span>{formatTime(safeDuration)}</span><span className="timeline-fps">{fps.toFixed(fps % 1 ? 2 : 0)} FPS</span></div><div className="timeline-actions"><button type="button" className="timeline-action" onClick={() => onTimeChange(0)}><RotateCcw size={14} />Reset playback</button></div></div>
      <div className="timeline-range-wrap"><div className="timeline-markers">{ticks.map((tick, index) => <span key={`${index}-${tick}`}>{formatTime(tick)}{visibleImpactTime !== undefined && Math.abs(tick - visibleImpactTime) < .001 && <b>{impactLabel}</b>}</span>)}</div><div className="timeline-visual"><div className="timeline-track"><span className="timeline-progress" style={{ width: `${Math.max(0, Math.min((time / safeDuration) * 100, 100))}%` }} /></div>{visibleImpactTime !== undefined && <div className="timeline-impact-marker" style={{ left: `${Math.min((visibleImpactTime / safeDuration) * 100, 100)}%` }}><span /></div>}<input aria-label="Scrub synchronized video and simulation" type="range" min={0} max={safeDuration} step={0.04} value={Math.min(time, safeDuration)} onChange={(event) => onTimeChange(Number(event.target.value))} /></div></div>
    </section>
  )
}

function TelemetryChart({ time, duration = 10.4, kind = 'velocity' }: { time: number; duration?: number; kind?: 'velocity' | 'distance' | 'both' }) {
  const velocity = [68, 68, 67, 67, 66, 65, 64, 63, 61, 58, 54, 51, 50, 49, 47, 45, 42, 37, 32, 27, 21, 14, 7, 0]
  const distance = [48, 46, 43, 40, 37, 33, 29, 25, 20, 15, 10, 5, 2, 0, 0, 3, 7, 12, 18, 24, 29, 34, 38, 41]
  const values = kind === 'distance' ? distance : velocity
  const linePoints = (series: number[]) => series.map((value, index) => `${(index / (series.length - 1)) * 560},${96 - (value / 70) * 86}`).join(' ')
  const points = linePoints(values)
  const secondaryPoints = linePoints(distance)
  const markerX = Math.max(0, Math.min((time / duration) * 560, 560))
  const markerY = 96 - (Math.min(sampleSpeedKmh(time), 70) / 70) * 86
  return <svg className="telemetry-svg" viewBox="0 0 560 104" preserveAspectRatio="none" role="img" aria-label={`${kind === 'both' ? 'Speed and inter-vehicle distance' : kind === 'velocity' ? 'Vehicle speed' : 'Inter-vehicle distance'} telemetry chart`}><path d="M0 22H560M0 47H560M0 71H560M0 96H560" stroke="#e2e9e5" strokeWidth="1" strokeDasharray="3 5" />{kind === 'both' && <polyline points={secondaryPoints} fill="none" stroke="#d78955" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity=".82" />}<polyline points={points} fill="none" stroke={kind === 'velocity' || kind === 'both' ? '#357f79' : '#d78955'} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /><path d={`M${markerX} 5V96`} stroke="#c66f43" strokeDasharray="3 4" /><circle cx={markerX} cy={markerY} r="4" fill="#c66f43" stroke="white" strokeWidth="2" /></svg>
}

function AnalysisProgressCard({ incident, onRetry, retrying }: { incident: IncidentCase; onRetry: () => void; retrying: boolean }) {
  const analysis = incident.analysis
  const completed = incident.analysis_status === 'completed' && analysis
  return <div className="analysis-card actual-analysis-card">
    <div className="analysis-card-heading"><div><span className="section-kicker">SCENE RECONSTRUCTION</span><h2>{incident.analysis_status === 'completed' ? 'Review scene' : 'Scene analysis'}</h2></div><StatusDot tone={incident.analysis_status === 'failed' ? 'orange' : incident.analysis_status === 'completed' ? 'teal' : 'orange'}>{incident.analysis_status ?? 'queued'}</StatusDot></div>
    {incident.analysis_status === 'queued' || incident.analysis_status === 'running' ? <div className="analysis-job-state"><div className="analysis-progress-track"><span style={{ width: `${incident.analysis_progress ?? 4}%` }} /></div><strong>{incident.analysis_message || 'Waiting for analysis…'}</strong><small>{incident.analysis_stage?.replace(/_/g, ' ') || 'queued'} · {incident.analysis_progress ?? 0}%</small><p>Video perception and scene estimates are running through Meta Muse Spark and SAM 3.1.</p></div> : null}
    {incident.analysis_status === 'failed' && <div className="analysis-job-state"><div className="analysis-error"><AlertTriangle size={16} /><span>{incident.analysis_error || 'Scene reconstruction failed. Check the local service and Meta API connection.'}</span></div><button type="button" className="button button-outline retry-analysis" onClick={onRetry} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry analysis'}</button></div>}
    {completed && <>
      <div className="actual-estimate-label"><AlertTriangle size={14} /><span>{analysis.provenance.classification}</span></div>
      <p className="analysis-scene-summary">{analysis.hypothesis.summary || 'Meta returned no scene summary.'}</p>
      <div className="calibration-result"><div><span className="section-kicker">SCALE CALIBRATION</span><strong>{analysis.hypothesis.calibration.available ? 'Metric hypothesis available' : 'Metric scale unavailable'}</strong><small>{analysis.hypothesis.calibration.source || 'No identifiable scale object'} · {analysis.hypothesis.calibration.confidence === null ? 'analyst-entered dimensions' : `${Math.round((analysis.hypothesis.calibration.confidence || 0) * 100)}% model confidence`}</small>{analysis.hypothesis.calibration.evidence && <small>{analysis.hypothesis.calibration.evidence}</small>}</div><span className={`calibration-state ${analysis.hypothesis.calibration.available ? 'is-ready' : ''}`}>{analysis.hypothesis.calibration.available ? 'REVIEW' : 'PIXELS'}</span></div>
      <div className="actual-actor-list">{analysis.tracking.actors.slice(0, 6).map((actor) => <div key={actor.id} className="actual-actor-row"><span><strong>{actor.class_name}</strong><small>{actor.observations.length} detected frames{actor.is_static_obstacle ? ' · static obstacle' : ''}</small></span><strong>{!actor.is_static_obstacle && analysis.provenance.metric_scale_available && actor.kinematics.first_observed_speed_mps !== null ? `${actor.kinematics.first_observed_speed_mps.toFixed(1)} m/s` : '—'}<small>{actor.is_static_obstacle ? 'obstruction track' : analysis.provenance.metric_scale_available ? 'first tracked estimate' : 'metric scale needed'}</small></strong></div>)}{analysis.tracking.actors.length === 0 && <p className="analysis-scene-summary">No moving actor tracks were returned for this clip.</p>}</div>
      {analysis.tracking.mean_fit_residual_m !== null && <div className="actual-residual"><span>Mean trajectory fit residual</span><strong>{analysis.tracking.mean_fit_residual_m.toFixed(2)} m</strong></div>}
      <p className="actual-limit-note">{analysis.provenance.not_a_finding}</p>
    </>}
    {incident.analysis_status !== 'completed' && incident.analysis_status !== 'running' && incident.analysis_status !== 'queued' && incident.analysis_status !== 'failed' && <div className="analysis-job-state"><p>{incident.analysis_message || 'Upload a video to start reconstruction.'}</p></div>}
  </div>
}

function ActualTelemetry({ analysis, time }: { analysis: AnalysisResult; time: number }) {
  if (!analysis.provenance.metric_scale_available) return <section className="telemetry-panel actual-telemetry"><div className="section-heading"><div><span className="section-kicker">OBSERVED TRACKS</span><h2>Metric telemetry unavailable</h2></div></div><p>{analysis.tracking.fit_note}</p></section>
  const samples = analysis.tracking.actors.filter((actor) => !actor.is_static_obstacle).flatMap((actor) => actor.observations.slice(1).map((point, index) => {
    const previous = actor.observations[index]
    const delta = point.time_s - previous.time_s
    if (delta <= 0 || point.x_m === null || point.y_m === null || previous.x_m === null || previous.y_m === null) return null
    return { time_s: point.time_s, speed: Math.hypot(point.x_m - previous.x_m, point.y_m - previous.y_m) / delta * 3.6, actor: actor.class_name }
  }).filter((sample): sample is { time_s: number; speed: number; actor: string } => sample !== null))
  const maxSpeed = Math.max(1, ...samples.map((sample) => sample.speed))
  const duration = analysis.metadata.duration_s || 1
  const latest = samples.reduce((best, sample) => Math.abs(sample.time_s - time) < Math.abs(best.time_s - time) ? sample : best, samples[0] || { time_s: 0, speed: 0, actor: '' })
  const points = samples.map((sample) => `${(sample.time_s / duration) * 560},${96 - (sample.speed / maxSpeed) * 86}`).join(' ')
  return <section className="telemetry-panel actual-telemetry"><div className="section-heading"><div><span className="section-kicker">DETECTED TRACKS · DERIVED SPEED</span><h2>Observed path speed</h2></div><div className="chart-controls"><div className="playhead-reading"><small>SPEED NEAR PLAYHEAD</small><strong>{latest.speed.toFixed(1)} <em>km/h</em></strong></div></div></div>{samples.length < 2 ? <p>At least three metric observations are needed to display a speed profile.</p> : <div className="actual-chart-wrap"><svg className="telemetry-svg" viewBox="0 0 560 104" preserveAspectRatio="none" role="img" aria-label="Speed derived from detected metric track points"><path d="M0 22H560M0 47H560M0 71H560M0 96H560" stroke="#e2e9e5" strokeWidth="1" strokeDasharray="3 5" /><polyline points={points} fill="none" stroke="#357f79" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /></svg><div className="chart-x-axis">{Array.from({ length: 6 }, (_, index) => <span key={index}>{formatTime((duration * index) / 5)}</span>)}</div></div>}<p className="actual-limit-note">Point-to-point ground-track estimates. They are sensitive to segmentation, camera calibration, and frame rate.</p></section>
}

function CalibrationEditor({ incident, gridVisible, onToggleGrid, onSave, saving }: { incident: IncidentCase; gridVisible: boolean; onToggleGrid: () => void; onSave: (width: number, length: number) => Promise<void>; saving: boolean }) {
  const [width, setWidth] = useState('')
  const [length, setLength] = useState('')
  const [error, setError] = useState('')
  const calibration = incident.analysis?.hypothesis.calibration
  useEffect(() => {
    setWidth(calibration?.reviewed_by_user && calibration.width_m ? String(calibration.width_m) : '')
    setLength(calibration?.reviewed_by_user && calibration.length_m ? String(calibration.length_m) : '')
  }, [incident.id, calibration?.width_m, calibration?.length_m])
  const submit = async () => {
    const widthValue = Number(width); const lengthValue = Number(length)
    if (!widthValue || !lengthValue || widthValue <= 0 || lengthValue <= 0) { setError('Enter the measured real-world width and length in meters.'); return }
    setError('')
    try { await onSave(widthValue, lengthValue) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Calibration could not be saved.') }
  }
  return <div className="analysis-card calibration-editor"><div className="analysis-card-heading"><div><span className="section-kicker">SCALE REVIEW</span><h2>Ground plane</h2></div><ScanLine size={16} /></div><p>Drag the four overlay corners to a flat, measured rectangle in the video. Enter its real dimensions to calculate metric tracks.</p><div className="calibration-dimensions"><label>Width<input type="number" min="0.1" step="0.1" value={width} onChange={(event) => setWidth(event.target.value)} placeholder="meters" /></label><label>Length<input type="number" min="0.1" step="0.1" value={length} onChange={(event) => setLength(event.target.value)} placeholder="meters" /></label></div><small className="calibration-corner-note">Corner order: top-left → top-right → bottom-right → bottom-left. Use a flat plane with a known measured size.</small>{error && <p className="field-error" role="alert">{error}</p>}{incident.analysis?.hypothesis.stationary_camera === false && <p className="field-error">Camera motion detected or uncertain. This release only supports fixed-camera calibration.</p>}<div className="calibration-editor-actions"><button type="button" className="button button-quiet" onClick={onToggleGrid}><Grid2X2 size={14} />{gridVisible ? 'Hide corners' : 'Adjust corners'}</button><button type="button" className="button button-primary" onClick={() => void submit()} disabled={saving || !incident.analysis || incident.analysis.hypothesis.stationary_camera !== true}>{saving ? 'Saving…' : !incident.analysis ? 'Waiting for tracks' : incident.analysis.hypothesis.stationary_camera !== true ? 'Fixed camera required' : 'Apply measured scale'}</button></div><p className="actual-limit-note">Saved scale is analyst-entered and remains a hypothesis until the dimensions and ground plane are independently checked.</p></div>
}

function Workbench({ currentCase, time, duration, isPlaying, gridVisible, tracksVisible, simulation, onGridToggle, onTracksToggle, onPlay, onTimeChange, onStep, videoRef, onLoadedMetadata, onTimeUpdate, onNavigate, onNewScene, onRetryAnalysis, retryingAnalysis, calibrationPoints, onCalibrationPointsChange, onSaveCalibration, savingCalibration }: {
  currentCase: IncidentCase; time: number; duration: number; isPlaying: boolean; gridVisible: boolean; tracksVisible: boolean;
  simulation: SimulationResult | null;
  onGridToggle: () => void; onTracksToggle: () => void; onPlay: () => void; onTimeChange: (time: number) => void; onStep: (direction: number) => void;
  videoRef: RefObject<HTMLVideoElement>; onLoadedMetadata: (duration: number) => void; onTimeUpdate: (time: number) => void; onNavigate: (screen: Screen) => void; onNewScene: () => void; onRetryAnalysis: () => void; retryingAnalysis: boolean; calibrationPoints: CalibrationPoint[]; onCalibrationPointsChange: (points: CalibrationPoint[]) => void; onSaveCalibration: (width: number, length: number) => Promise<void>; savingCalibration: boolean
}) {
  const [tab, setTab] = useState<AnalysisTab>('summary')
  return (
    <>
      <div className="workbench-layout">
        <div className="workbench-main">
          <div className="scene-toolbar"><div className="scene-status"><span className="live-simulation-dot" />{currentCase.videoUrl ? 'Source video' : 'Illustrative sample'}<span className="toolbar-divider" /><span>{(currentCase.duration_s ?? duration).toFixed(1)} s · {(currentCase.fps ?? 30).toFixed(currentCase.fps ? 2 : 0)} fps</span></div><div className="scene-toolbar-actions"><span className="scene-input-note">Orbit · pan · zoom</span><IconButton label="Open scene library" onClick={() => onNavigate('cases')}><MoreHorizontal size={17} /></IconButton></div></div>
          <div className="visual-pair">
            <EvidencePanel time={time} gridVisible={gridVisible} tracksVisible={tracksVisible} onGridToggle={onGridToggle} onMaximize={() => window.dispatchEvent(new Event('blackbox-source-expand'))} videoUrl={currentCase.videoUrl} videoRef={videoRef} onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} calibrationPoints={calibrationPoints} onCalibrationPointsChange={onCalibrationPointsChange} />
            <TwinPanel time={time} duration={duration} isPlaying={isPlaying} onPlay={onPlay} onTimeChange={onTimeChange} onToggleTracks={onTracksToggle} tracksVisible={tracksVisible} analysis={currentCase.analysis} useActualData={Boolean(currentCase.videoUrl)} simulation={simulation} />
          </div>
          <Timeline time={time} duration={duration} isPlaying={isPlaying} onPlay={onPlay} onTimeChange={onTimeChange} onStep={onStep} impactTime={currentCase.videoUrl ? (currentCase.analysis?.hypothesis.impact_time_s ?? undefined) : 5.2} impactLabel={currentCase.videoUrl ? 'EVENT?' : 'IMPACT'} fps={currentCase.fps ?? 30} />
          {currentCase.videoUrl && currentCase.analysis ? <ActualTelemetry analysis={currentCase.analysis} time={time} /> : currentCase.videoUrl ? <section className="telemetry-panel actual-telemetry"><div className="section-heading"><div><span className="section-kicker">MOTION PROFILE</span><h2>Track data pending</h2></div></div><p>Object paths and motion estimates will appear here when scene analysis finishes.</p></section> : <section className="telemetry-panel">
            <div className="section-heading"><div><span className="section-kicker">MOTION PROFILE · SAMPLE</span><h2>Illustrative object speed</h2></div><div className="chart-controls"><div className="playhead-reading"><small>SAMPLE SPEED AT PLAYHEAD</small><strong>{sampleSpeedKmh(time).toFixed(1)} <em>km/h</em></strong></div><button type="button" className="chart-select">Sample object <ChevronDown size={13} /></button></div></div>
            <div className="chart-plot"><div className="chart-y-axis"><span>60</span><span>40</span><span>20</span><span>0</span></div><div className="chart-content"><TelemetryChart time={time} duration={duration} /><div className="chart-x-axis">{Array.from({ length: 6 }, (_, index) => <span key={index}>{formatTime((duration * index) / 5)}</span>)}</div></div></div>
          </section>}
        </div>
        <aside className="analysis-rail">
          {currentCase.videoUrl ? <><AnalysisProgressCard incident={currentCase} onRetry={onRetryAnalysis} retrying={retryingAnalysis} /><CalibrationEditor incident={currentCase} gridVisible={gridVisible} onToggleGrid={onGridToggle} onSave={onSaveCalibration} saving={savingCalibration} /></> : <><div className="analysis-card analysis-overview">
            <div className="analysis-card-heading"><div><span className="section-kicker">VIDEO-TO-3D WORKFLOW</span><h2>Build a scene from video</h2></div><IconButton label="Open scene library" onClick={() => onNavigate('cases')}><MoreHorizontal size={16} /></IconButton></div>
            <StatusDot>Sample environment · illustrative</StatusDot>
            <p className="scene-intro-copy">Upload a short fixed-camera clip. BLACKBOX tracks visible objects, estimates the ground plane, and builds an interactive 3D scene.</p>
            <div className="analysis-divider" />
            <div className="analysis-tabs" role="tablist" aria-label="Scene information">{(['summary','physics','limits'] as AnalysisTab[]).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item === 'summary' ? 'Scene' : item === 'physics' ? 'Motion' : 'Limits'}</button>)}</div>
            {tab === 'summary' && <div className="analysis-tab-content scene-info-copy"><p>Explore object paths, orbit around the reconstructed environment, and compare the source video with its 3D scene.</p></div>}
            {tab === 'physics' && <div className="analysis-tab-content scene-info-copy"><p>Motion follows segmented ground-contact tracks. Physics chat needs a measured metric scale before a scenario can be simulated.</p></div>}
            {tab === 'limits' && <div className="analysis-tab-content scene-info-copy"><p>The current prototype supports fixed cameras and visible flat surfaces. Hidden depth and object dimensions are estimated or left unknown.</p></div>}
            <button type="button" className="button run-button" onClick={onNewScene}><Upload size={15} />Upload a video<ArrowRight size={14} /></button>
            <p className="assumption-note"><AlertTriangle size={13} />Sample geometry and motion are illustrative, not measurements.</p>
          </div>
          <div className="analysis-card event-card"><div className="event-card-heading"><span className="section-kicker">SCENE CONTENT</span></div><div className="event-row"><span className="event-glyph event-sight"><Layers3 size={14} /></span><span className="event-copy"><strong>Ground plane</strong><small>Approximate surface for 3D navigation</small></span></div><div className="event-row"><span className="event-glyph event-brake"><Waypoints size={14} /></span><span className="event-copy"><strong>Moving objects</strong><small>Illustrative tracks in this sample</small></span></div></div>
          <div className="calibration-reminder"><div className="reminder-icon"><ScanLine size={16} /></div><div><strong>Scale review</strong><p>Enter a known ground-plane measurement for meter-based motion.</p><button type="button" className="text-link" onClick={onNewScene}>Start from a video <ArrowRight size={13} /></button></div></div></>}
        </aside>
      </div>
    </>
  )
}

function CaseFiles({ cases, onSelect, onNewCase }: { cases: IncidentCase[]; onSelect: (item: IncidentCase) => void; onNewCase: () => void }) {
  const [filter, setFilter] = useState('All scenes')
  const visible = cases.filter((item) => filter === 'All scenes' || (filter === 'Analyzing' ? ['queued', 'running'].includes(item.analysis_status ?? '') : filter === 'Retry needed' ? item.analysis_status === 'failed' : false))
  return (
    <div className="case-files-page">
      <div className="case-files-toolbar"><div className="filter-tabs">{['All scenes','Analyzing','Retry needed'].map((label) => <button key={label} type="button" className={filter === label ? 'active' : ''} onClick={() => setFilter(label)}>{label}<span>{(label === 'All scenes' ? cases : label === 'Analyzing' ? cases.filter((item) => ['queued', 'running'].includes(item.analysis_status ?? '')) : cases.filter((item) => item.analysis_status === 'failed')).length.toString().padStart(2, '0')}</span></button>)}</div><div className="case-file-actions"><button type="button" className="button button-primary" onClick={onNewCase}><Plus size={16} />New scene</button></div></div>
      <div className="case-table-card"><div className="case-table-head"><span>Scene</span><span>Type</span><span>Last updated</span><span>Status</span><span /></div>{visible.map((item, index) => { const status = item.analysis_status === 'running' || item.analysis_status === 'queued' ? 'Analyzing' : item.analysis_status === 'failed' ? 'Retry needed' : item.analysis_status === 'completed' ? 'Estimate ready' : item.status; const tone = status === 'Draft' ? 'draft' : status === 'Retry needed' ? 'failed' : status === 'Analyzing' ? 'running' : 'reference'; return <button type="button" key={item.id} className="case-table-row" onClick={() => onSelect(item)}><span className="case-table-title"><span className={`case-file-icon case-file-${index % 3}`}><FileVideo2 size={17} /></span><span><strong>{item.title}</strong><small>{item.id} <span className="table-separator">/</span> {item.site}</small></span></span><span className="table-type">{item.category}</span><span className="table-date">{item.date}</span><span><span className={`case-status status-case-${tone}`}><span />{status}</span></span><ChevronRight className="table-chevron" size={16} /></button> })}{visible.length === 0 && <div className="empty-cases"><div className="empty-icon"><FileVideo2 size={21} /></div><strong>No matching scenes</strong><p>Upload a video or change the scene filter.</p><button type="button" className="button button-primary" onClick={onNewCase}><Plus size={15} />Create a scene</button></div>}</div>
      <div className="case-files-footnote"><ShieldCheck size={15} /><span>Source clips are stored in the local workspace and sent to Meta for analysis. Delete a case to remove its local video.</span></div>
      <div className="case-summary-strip"><div><span className="summary-strip-icon"><Layers3 size={16} /></span><span><strong>{cases.length} saved scenes</strong><small>Across motion and physical environments</small></span></div><div><span className="summary-strip-icon"><HardDrive size={16} /></span><span><strong>Local database and media</strong><small>Analysis models run through Meta API</small></span></div><button type="button" onClick={onNewCase}>Create a scene <ArrowRight size={14} /></button></div>
    </div>
  )
}

type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; details?: string[]; error?: boolean }

function baselineScenario(analysis: AnalysisResult | null | undefined): ScenarioState | null {
  const actor = analysis?.tracking.actors.find((item) => !item.is_static_obstacle && item.observations.length >= 3)
  return actor ? { actor_id: actor.id, speed_scale: 1, start_time_shift_s: 0, heading_change_deg: 0, brake_at_s: null, gravity_mps2: 9.81, friction_coefficient: 0.7, obstacles_removed: false, obstacle_id: null } : null
}

function CounterfactualStudio({ time, duration, isPlaying, onPlay, onTimeChange, currentCase, simulation, onSimulationChange, onNavigate }: { time: number; duration: number; isPlaying: boolean; onPlay: () => void; onTimeChange: (time: number) => void; currentCase: IncidentCase; simulation: SimulationResult | null; onSimulationChange: (simulation: SimulationResult | null) => void; onNavigate: (screen: Screen) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 0, role: 'assistant', text: 'Ask the reconstructed scene to change one thing. Muse Spark translates your request into model parameters; the simulation engine calculates the result.' }])
  const [scenario, setScenario] = useState<ScenarioState | null>(baselineScenario(currentCase.analysis))
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const analysis = currentCase.analysis
  const ready = Boolean(currentCase.videoUrl && analysis && currentCase.analysis_status === 'completed' && analysis.provenance.metric_scale_available && analysis.hypothesis.calibration.reviewed_by_user && scenario)
  const examples = ['What if this object moved slower?', 'What if it started two seconds earlier?', 'What if it stopped sooner?', 'What if the obstacle was removed?']

  useEffect(() => {
    setMessages([{ id: 0, role: 'assistant', text: 'Ask the reconstructed scene to change one thing. Muse Spark translates your request into model parameters; the simulation engine calculates the result.' }])
    setScenario(baselineScenario(currentCase.analysis))
    setPrompt('')
    onSimulationChange(null)
  }, [currentCase.id])
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])

  const reset = () => {
    setScenario(baselineScenario(currentCase.analysis))
    setMessages([{ id: Date.now(), role: 'assistant', text: 'Simulation reset to the reconstructed scene.' }])
    onSimulationChange(null)
  }
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || !ready || sending) return
    setPrompt(''); setSending(true)
    setMessages((items) => [...items, { id: Date.now(), role: 'user', text }])
    try {
      const response = await fetch(`/api/cases/${currentCase.id}/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, current_state: scenario }) })
      if (!response.ok) throw new Error(await responseError(response))
      const result = await response.json() as SimulationResponse
      if (!result.supported || !result.simulation) {
        setMessages((items) => [...items, { id: Date.now() + 1, role: 'assistant', text: result.explanation || 'This request is outside the supported simulation model.', error: true }])
        return
      }
      setScenario(result.scenario); onSimulationChange(result.simulation)
      const collision = result.simulation.collisions[0]
      const summary = [result.explanation, `${result.simulation.actors.length} tracked path(s) recomputed by the deterministic engine at ${(result.simulation.time_step_s * 1000).toFixed(1)} ms steps.`, collision ? `First modeled contact: ${collision.actor_a} and ${collision.actor_b} at ${collision.time_s.toFixed(2)} s.` : 'No modeled contact event occurred during the simulated interval.', 'This is a simulated outcome under the assumptions below, not an observation from the source video.'].join('\n\n')
      setMessages((items) => [...items, { id: Date.now() + 1, role: 'assistant', text: summary, details: result.simulation?.assumptions ?? [] }])
    } catch (reason) {
      setMessages((items) => [...items, { id: Date.now() + 1, role: 'assistant', text: reason instanceof Error ? reason.message : 'Simulation failed. Check the Meta connection and retry.', error: true }])
    } finally { setSending(false) }
  }
  const unavailable = !currentCase.videoUrl
    ? 'Upload a video to create a scene before simulating a change.'
    : currentCase.analysis_status !== 'completed'
      ? 'Scene reconstruction must finish before a simulation can run.'
      : !analysis?.provenance.metric_scale_available
        ? 'Add a measured ground-plane scale in Reconstruction to enable physics simulation.'
        : !analysis.hypothesis.calibration.reviewed_by_user
          ? 'Review the ground-plane corners and enter a known real-world measurement in Reconstruction before simulating.'
        : !scenario ? 'This scene needs at least one object with three metric observations.' : ''

  return <div className="counterfactual-layout actual-counterfactual conversational-simulation">
    <div className="counterfactual-main">
      <div className="counterfactual-toolbar"><div className="scenario-switch"><span className="scenario-dot" /><span><strong>{simulation ? 'Counterfactual simulation' : 'Reconstructed scene'}</strong><small>{analysis?.provenance.metric_scale_available ? 'Metric scale · review required' : 'Scale and motion limits apply'}</small></span></div><button type="button" className="ghost-toggle" onClick={reset}><RotateCcw size={14} />Reset scene</button></div>
      <div className="counterfactual-scene"><ThreeScene analysis={analysis as SceneAnalysis | null | undefined} simulation={simulation} time={time} duration={duration} isPlaying={isPlaying} onPlay={onPlay} onTimeChange={onTimeChange} /></div>
      <Timeline time={time} duration={duration} isPlaying={isPlaying} onPlay={onPlay} onTimeChange={onTimeChange} onStep={(direction) => onTimeChange(time + direction / Math.max(currentCase.fps ?? 30, 1))} impactTime={analysis?.hypothesis.impact_time_s ?? undefined} impactLabel="EVENT" fps={currentCase.fps ?? 30} />
      <div className="counterfactual-method"><div className="method-icon"><Activity size={16} /></div><div><strong>Simulation model</strong><p>Constant-acceleration motion on a calibrated ground plane, friction-limited braking, and circular collision proxies. Hidden geometry, object dimensions, and some physical properties remain estimates.</p></div><span className="model-state-tag">ENGINE</span></div>
    </div>
    <aside className="cf-controls-rail chat-rail">
      <div className="cf-panel-heading"><div><span className="section-kicker">NATURAL-LANGUAGE SIMULATION</span><h2>Ask this scene</h2></div><IconButton label="Reset simulation" onClick={reset}><RotateCcw size={15} /></IconButton></div>
      {unavailable && <div className="chat-requirement"><AlertTriangle size={14} /><span>{unavailable}<button type="button" onClick={() => onNavigate('reconstruction')}>Open reconstruction</button></span></div>}
      <div className="chat-suggestions" aria-label="Example simulation requests">{examples.map((example) => <button key={example} type="button" disabled={!ready || sending} onClick={() => setPrompt(example)}>{example}</button>)}</div>
      <div className="chat-log" role="log" aria-live="polite" aria-label="Simulation conversation">{messages.map((message) => <article key={message.id} className={`chat-message ${message.role} ${message.error ? 'message-error' : ''}`}><span>{message.role === 'assistant' ? 'BLACKBOX' : 'YOU'}</span><p>{message.text}</p>{message.details && <details><summary>Model assumptions</summary><ul>{message.details.map((item) => <li key={item}>{item}</li>)}</ul></details>}</article>)}{sending && <div className="chat-thinking"><span className="button-spinner" />Interpreting request and running simulation…</div>}<div ref={messagesEnd} /></div>
      <form className="chat-composer" onSubmit={(event) => void send(event)}><label htmlFor="scene-prompt">Describe a physical change</label><textarea id="scene-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={ready ? 'What if this object slowed down?' : 'An analyzed scene and scale are required'} maxLength={500} rows={3} disabled={!ready || sending} /><div><small>{prompt.length}/500</small><button type="submit" className="button button-primary" disabled={!ready || sending || !prompt.trim()}>{sending ? 'Running…' : 'Simulate'}<Send size={14} /></button></div></form>
      <p className="chat-separation-note">Muse Spark interprets the request. The deterministic engine calculates motion.</p>
    </aside>
  </div>
}

function Findings({ onExport, onNavigate, currentCase }: { onExport: () => void; onNavigate: (screen: Screen) => void; currentCase: IncidentCase }) {
  if (currentCase.videoUrl) {
    const analysis = currentCase.analysis
    return <div className="findings-page"><div className="findings-banner"><div className="findings-banner-icon"><AlertTriangle size={18} /></div><div><strong>{analysis ? 'Automated analysis estimates' : `Analysis ${currentCase.analysis_status ?? 'pending'}`}</strong><p>{analysis?.provenance.classification ?? currentCase.analysis_message ?? 'Complete analysis to see track and calibration outputs.'}</p></div><span>REVIEW REQUIRED</span></div>{analysis ? <div className="findings-grid"><section className="findings-card verdict-card"><div className="findings-card-heading"><div><span className="section-kicker">TRACK SUMMARY</span><h2>{analysis.hypothesis.scene_type || 'Video scene'}</h2></div><span className="status-pill status-orange"><span className="status-pip" />Estimate</span></div><p className="analysis-scene-summary">{analysis.hypothesis.summary}</p><div className="findings-metric-grid"><div><span>Tracked instances</span><strong>{analysis.tracking.actors.length}</strong><small>SAM 3.1 detections</small></div><div><span>Mean fit residual</span><strong>{analysis.tracking.mean_fit_residual_m === null ? '—' : analysis.tracking.mean_fit_residual_m.toFixed(2)} <small>{analysis.tracking.mean_fit_residual_m === null ? '' : 'm'}</small></strong><small>Constant acceleration fit</small></div><div><span>Event timing estimate</span><strong>{analysis.hypothesis.impact_time_s === null ? '—' : `${analysis.hypothesis.impact_time_s.toFixed(2)} s`}</strong><small>Model estimate only</small></div><div><span>Metric scale</span><strong>{analysis.provenance.metric_scale_available ? 'Available' : 'Unavailable'}</strong><small>Review ground plane</small></div></div><div className="actual-limit-note">{analysis.provenance.not_a_finding}</div></section><section className="findings-card assumptions-card"><div className="findings-card-heading"><div><span className="section-kicker">CALIBRATION &amp; LIMITS</span><h2>Model record</h2></div><Settings2 size={17} /></div><div className="assumption-list"><div><span className="assumption-pending"><Clock3 size={12} /></span><span><strong>Scale source</strong><small>{analysis.hypothesis.calibration.source || 'Not identified'}</small></span><span className="assumption-value pending">REVIEW</span></div><div><span className="assumption-pending"><Clock3 size={12} /></span><span><strong>Track fit</strong><small>{analysis.tracking.fit_model}</small></span><span className="assumption-value pending">ESTIMATE</span></div>{analysis.hypothesis.limitations.slice(0, 4).map((item, index) => <div key={index}><span className="assumption-pending"><AlertTriangle size={12} /></span><span><strong>Limitation</strong><small>{item}</small></span><span className="assumption-value pending">NOTE</span></div>)}</div><button type="button" className="text-link" onClick={() => onNavigate('reconstruction')}>Review tracks and scale <ArrowRight size={14} /></button></section><section className="findings-card actual-actors-findings"><div className="findings-card-heading"><div><span className="section-kicker">ACTOR ESTIMATES</span><h2>Detected ground contacts</h2></div></div>{analysis.tracking.actors.map((actor) => <div className="actual-actor-row" key={actor.id}><span><strong>{actor.class_name}</strong><small>{actor.observations.length} observations · {actor.role}</small></span><strong>{analysis.provenance.metric_scale_available && actor.kinematics.first_observed_speed_mps !== null ? `${actor.kinematics.first_observed_speed_mps.toFixed(1)} m/s` : 'Pixel path'}<small>{analysis.provenance.metric_scale_available ? 'first tracked speed estimate' : 'no metric speed'}</small></strong></div>)}{analysis.tracking.actors.length === 0 && <p>No actor tracks were returned.</p>}</section></div> : <div className="findings-empty"><Activity size={22} /><strong>Scene data will appear after analysis</strong><p>Return to Reconstruction to follow analysis progress.</p><button type="button" className="button button-primary" onClick={() => onNavigate('reconstruction')}>Open reconstruction</button></div>}<div className="report-actions"><div><ShieldCheck size={16} /><span><strong>Estimate provenance</strong><small>Export includes model status and known limitations</small></span></div><button type="button" className="button button-primary" onClick={onExport}><Download size={15} />Export scene data</button></div></div>
  }
  return (
    <div className="findings-page">
      <div className="findings-banner"><div className="findings-banner-icon"><Layers3 size={18} /></div><div><strong>Illustrative sample environment</strong><p>This scene demonstrates the interface. It was not reconstructed from an uploaded video.</p></div><span>SAMPLE DATA</span></div>
      <div className="findings-grid">
        <section className="findings-card verdict-card"><div className="findings-card-heading"><div><span className="section-kicker">VIDEO-TO-3D</span><h2>Scene reconstruction</h2></div><span className="status-pill status-orange"><span className="status-pip" />Illustrative</span></div><p className="analysis-scene-summary">Upload a short fixed-camera video with a visible ground plane to build a scene from detected object paths.</p><div className="findings-metric-grid"><div><span>Sample objects</span><strong>3</strong><small>Illustrative geometry</small></div><div><span>Metric scale</span><strong>—</strong><small>Not calibrated</small></div><div><span>Observed motion</span><strong>—</strong><small>No source video</small></div><div><span>Physics simulation</span><strong>—</strong><small>Requires metric tracks</small></div></div><div className="actual-limit-note">Hidden depth and object dimensions cannot be recovered from this sample. Real scene measurements require a known ground-plane scale.</div></section>
        <section className="findings-card assumptions-card"><div className="findings-card-heading"><div><span className="section-kicker">SUPPORTED INPUT</span><h2>Current prototype</h2></div><Settings2 size={17} /></div><div className="assumption-list"><div><span className="assumption-check"><Check size={12} /></span><span><strong>Camera</strong><small>Stationary or linear dashcam view</small></span><span className="assumption-value">SUPPORTED</span></div><div><span className="assumption-check"><Check size={12} /></span><span><strong>Surface</strong><small>Visible, mostly flat ground plane</small></span><span className="assumption-value">SUPPORTED</span></div><div><span className="assumption-pending"><Clock3 size={12} /></span><span><strong>Clip length</strong><small>Up to 15 seconds</small></span><span className="assumption-value pending">LIMIT</span></div><div><span className="assumption-pending"><AlertTriangle size={12} /></span><span><strong>Geometry</strong><small>Vertical dimensions and hidden areas are estimated</small></span><span className="assumption-value pending">ESTIMATE</span></div></div><button type="button" className="text-link" onClick={() => onNavigate('reconstruction')}>Open 3D reconstruction <ArrowRight size={14} /></button></section>
      </div>
      <div className="report-actions"><div><ShieldCheck size={16} /><span><strong>Scene data</strong><small>Exports include estimates and model limitations</small></span></div><button type="button" className="button button-primary" onClick={onExport}><Download size={15} />Export sample data</button></div>
    </div>
  )
}

function UploadDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, site: string, file: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [site, setSite] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inspectFile = (selected: File) => new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(selected)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      const duration = video.duration
      const width = video.videoWidth
      const height = video.videoHeight
      if (!Number.isFinite(duration) || duration <= 0 || !width || !height) reject(new Error('The video metadata is invalid or the file cannot be decoded.'))
      else if (duration > 15) reject(new Error(`This video is ${duration.toFixed(1)} seconds. BLACKBOX accepts clips up to 15 seconds.`))
      else if (Math.max(width, height) > 1920 || width * height > 1920 * 1080) reject(new Error('Video resolution must be 1,920 px or less on either side and no more than 2.1 megapixels.'))
      else resolve({ duration, width, height })
    }
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This video is malformed or uses a codec the browser cannot read. Use a standard MP4 or MOV.')) }
    video.src = url
  })
  const selectFile = async (selected: File | undefined) => {
    if (!selected) return
    if (!/\.(mp4|mov)$/i.test(selected.name)) { setFile(null); setError('Choose an MP4 or MOV video. WebM and other formats are not supported.'); return }
    if (selected.size > 100 * 1024 * 1024) { setFile(null); setError('Video is larger than 100 MB. Choose a smaller clip.'); return }
    setError('')
    try { await inspectFile(selected); setFile(selected) }
    catch (reason) { setFile(null); setError(reason instanceof Error ? reason.message : 'This video could not be validated.') ; return }
    if (!title) setTitle(selected.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '))
  }
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { void selectFile(event.target.files?.[0]); event.target.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files[0]) }
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!file) { setError('Add a valid video clip to continue.'); return } setSubmitting(true); setError(''); try { await onCreate(title.trim() || file.name, site.trim() || 'Location not specified', file) } catch (reason) { setError(reason instanceof Error ? reason.message : 'The video could not be uploaded.'); setSubmitting(false) } }
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="file"])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', trapFocus)
    return () => { window.removeEventListener('keydown', handleKey); window.removeEventListener('keydown', trapFocus); previouslyFocused?.focus() }
  }, [])
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={dialogRef} className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-heading"><div className="dialog-heading"><div><span className="section-kicker">NEW SCENE</span><h2 id="upload-heading">Turn a video into a 3D scene</h2><p>Upload a short clip from a fixed camera with a visible ground plane.</p></div><IconButton label="Close dialog" onClick={onClose}><X size={17} /></IconButton></div><form onSubmit={submit}>
      <div className={`dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><input ref={fileInput} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" onChange={onFileChange} aria-label="Select a video clip" /><div className="upload-symbol">{file ? <CheckCircle2 size={22} /> : <Upload size={22} />}</div>{file ? <><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB · validated</span><button type="button" className="replace-file" disabled={submitting} onClick={() => fileInput.current?.click()}>Replace video</button></> : <><strong>Drop a video file here</strong><span>MP4 or MOV · up to 100 MB · max 15 seconds</span><small>Up to 1,920 px · 60 FPS</small><button type="button" className="button button-outline browse-button" onClick={() => fileInput.current?.click()}>Browse files</button></>}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-field-grid"><label>Scene name<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Warehouse aisle" /></label><label>Location<input value={site} onChange={(event) => setSite(event.target.value)} placeholder="Road, junction, or facility" /></label></div>
      <div className="local-storage-note"><HardDrive size={15} /><span>BLACKBOX saves the source clip locally and uploads it to Meta for Muse Spark and SAM 3.1. SAM video calls are billed per processed frame under your Meta account. Response persistence is disabled, and the temporary Meta file is deleted after analysis when the API allows it; your Meta account’s data policy still applies.</span></div>
      <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="button button-primary" disabled={submitting}>{submitting ? <><span className="button-spinner" />Uploading…</> : <><Plus size={15} />Build 3D scene</>}</button></div>
    </form></div></div>
  )
}

function ConnectionBanner({ status, unavailable, testMessage }: { status: ServiceStatus | null; unavailable: boolean; testMessage: string }) {
  if (status?.ready && !testMessage) return null
  const connectionConfirmed = testMessage.startsWith('Connected to ')
  return <div className={`connection-banner ${status?.ready ? 'connection-ok' : ''}`} role="status"><div className="connection-banner-icon">{status?.ready ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</div><div className="connection-banner-copy"><strong>{connectionConfirmed ? 'Meta API connection confirmed' : status?.ready ? 'Meta key found · connection test failed' : unavailable ? 'BLACKBOX analysis service is not running' : 'Meta Model API key needed'}</strong><span>{testMessage || (status?.setup ? status.setup : unavailable ? 'Run npm run dev; first run installs the local service automatically.' : 'Add MODEL_API_KEY to the .env file in the project folder, then save.')}</span></div><div className="connection-banner-actions">{status?.models && <small>{status.models.scene_analysis} · {status.models.video_segmentation}</small>}</div></div>
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { if (!message) return; const timer = window.setTimeout(onClose, 3800); return () => window.clearTimeout(timer) }, [message, onClose])
  if (!message) return null
  return <div className="toast" role="status"><span className="toast-check"><Check size={14} /></span>{message}<button type="button" aria-label="Dismiss message" onClick={onClose}><X size={14} /></button></div>
}

function App() {
  const [page, setPage] = useState<Screen>('reconstruction')
  const [cases, setCases] = useState(initialCases)
  const [activeCaseId, setActiveCaseId] = useState(initialCases[0].id)
  const [modalOpen, setModalOpen] = useState(false)
  const [gridVisible, setGridVisible] = useState(false)
  const [tracksVisible, setTracksVisible] = useState(true)
  const [time, setTime] = useState(4.12)
  const [duration, setDuration] = useState(10.4)
  const [isPlaying, setIsPlaying] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null)
  const [serviceUnavailable, setServiceUnavailable] = useState(false)
  const [testingMeta, setTestingMeta] = useState(false)
  const [metaTestMessage, setMetaTestMessage] = useState('')
  const [retryingAnalysis, setRetryingAnalysis] = useState(false)
  const [savingCalibration, setSavingCalibration] = useState(false)
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [calibrationPoints, setCalibrationPoints] = useState<CalibrationPoint[]>([[15, 25], [84, 20], [87, 76], [12, 80]])
  const initialCasesLoaded = useRef(false)
  const [expandedScene, setExpandedScene] = useState<'source' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentCase = cases.find((item) => item.id === activeCaseId) ?? cases[0] ?? initialCases[0]
  const calibrationCornersKey = JSON.stringify(currentCase.analysis?.hypothesis.calibration.image_corners ?? null)
  const title = page === 'cases' ? 'Scene library' : page === 'counterfactual' ? 'Ask the scene' : page === 'findings' ? 'Motion data' : '3D reconstruction'

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const [statusResponse, casesResponse] = await Promise.all([fetch('/api/status'), fetch('/api/cases')])
        if (!statusResponse.ok || !casesResponse.ok) throw new Error('Local API unavailable')
        const status = await statusResponse.json() as ServiceStatus
        const remoteCases = await casesResponse.json() as IncidentCase[]
        if (!alive) return
        setServiceStatus(status); setServiceUnavailable(false)
        setCases([...remoteCases, ...initialCases])
        if (!initialCasesLoaded.current) {
          initialCasesLoaded.current = true
          if (remoteCases[0]) {
            setActiveCaseId(remoteCases[0].id)
            setDuration(remoteCases[0].duration_s ?? 10.4)
            setTime(0)
          }
        }
      } catch {
        if (alive) setServiceUnavailable(true)
      }
    }
    void refresh()
    const poll = window.setInterval(() => { void refresh() }, 2200)
    return () => { alive = false; window.clearInterval(poll) }
  }, [])

  useEffect(() => {
    const corners = currentCase.analysis?.hypothesis.calibration.image_corners
    const video = videoRef.current
    const frame = video?.parentElement
    const width = currentCase.width || video?.videoWidth
    const height = currentCase.height || video?.videoHeight
    if (!corners || !width || !height || !frame) { setCalibrationPoints([[15, 25], [84, 20], [87, 76], [12, 80]]); return }
    const bounds = frame.getBoundingClientRect()
    const scale = Math.min(bounds.width / width, bounds.height / height)
    const offsetX = (bounds.width - width * scale) / 2
    const offsetY = (bounds.height - height * scale) / 2
    setCalibrationPoints(corners.map(([x, y]) => [((offsetX + x * scale) / bounds.width) * 100, ((offsetY + y * scale) / bounds.height) * 100]))
  }, [currentCase.id, calibrationCornersKey, currentCase.width, currentCase.height])

  useEffect(() => {
    if (page === 'reconstruction' && currentCase.videoUrl && videoRef.current) {
      if (isPlaying) void videoRef.current.play().catch(() => setIsPlaying(false))
      else videoRef.current.pause()
      return
    }
    if (!isPlaying) return
    const timer = window.setInterval(() => setTime((value) => {
      if (value + 0.1 >= duration) { setIsPlaying(false); return duration }
      return value + 0.1
    }), 100)
    return () => window.clearInterval(timer)
  }, [isPlaying, currentCase.videoUrl, duration, page])

  useEffect(() => {
    const sourceExpand = () => setExpandedScene('source')
    window.addEventListener('blackbox-source-expand', sourceExpand)
    return () => { window.removeEventListener('blackbox-source-expand', sourceExpand) }
  }, [])

  const toast = (message: string) => setToastMessage(message)
  const closeToast = () => setToastMessage('')
  const openNewCase = () => setModalOpen(true)
  const createCase = async (caseTitle: string, site: string, file: File) => {
    const form = new FormData(); form.append('file', file); form.append('title', caseTitle); form.append('site', site)
    const response = await fetch('/api/cases', { method: 'POST', body: form })
    if (!response.ok) throw new Error(await responseError(response))
    const nextCase = await response.json() as IncidentCase
    setCases((existing) => [nextCase, ...existing.filter((item) => item.id !== nextCase.id)])
    setActiveCaseId(nextCase.id); setPage('reconstruction'); setTime(0); setDuration(nextCase.duration_s ?? 10.4); setIsPlaying(false); setGridVisible(false); setSimulationResult(null); setModalOpen(false); toast('Video uploaded. Scene reconstruction is starting.')
  }
  const selectCase = (item: IncidentCase) => { setActiveCaseId(item.id); setPage('reconstruction'); setTime(0); setIsPlaying(false); setGridVisible(false); setSimulationResult(null); setDuration(item.duration_s ?? 10.4) }
  const testMeta = async () => {
    setTestingMeta(true); setMetaTestMessage('')
    try {
      const response = await fetch('/api/status/test', { method: 'POST' })
      if (!response.ok) throw new Error(await responseError(response))
      const result = await response.json() as { model: string; reply?: string }
      setMetaTestMessage(`Connected to ${result.model}. Meta API key works.`)
    } catch (reason) { setMetaTestMessage(reason instanceof Error ? reason.message : 'Meta connection test failed.') }
    finally { setTestingMeta(false) }
  }
  const retryAnalysis = async () => {
    if (!currentCase.videoUrl) return
    setRetryingAnalysis(true)
    try {
      const response = await fetch(`/api/cases/${currentCase.id}/reanalyze`, { method: 'POST' })
      if (!response.ok) throw new Error(await responseError(response))
      const detailResponse = await fetch(`/api/cases/${currentCase.id}`)
      if (detailResponse.ok) { const updated = await detailResponse.json() as IncidentCase; setCases((items) => items.map((item) => item.id === updated.id ? updated : item)) }
      toast('Analysis retry queued.')
    } catch (reason) { toast(reason instanceof Error ? reason.message : 'Analysis could not be retried.') }
    finally { setRetryingAnalysis(false) }
  }
  const saveCalibration = async (width: number, length: number) => {
    const video = videoRef.current
    const frame = video?.parentElement
    const sourceWidth = currentCase.width || video?.videoWidth
    const sourceHeight = currentCase.height || video?.videoHeight
    if (!frame || !sourceWidth || !sourceHeight) throw new Error('Wait for the source video to load before setting scale.')
    const bounds = frame.getBoundingClientRect()
    const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight)
    const offsetX = (bounds.width - sourceWidth * scale) / 2
    const offsetY = (bounds.height - sourceHeight * scale) / 2
    const corners = calibrationPoints.map(([x, y]) => [(x / 100 * bounds.width - offsetX) / scale, (y / 100 * bounds.height - offsetY) / scale])
    if (corners.some(([x, y]) => x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight)) throw new Error('Move all four corners inside the visible video frame.')
    setSavingCalibration(true)
    try {
      const response = await fetch(`/api/cases/${currentCase.id}/calibration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corners, width_m: width, length_m: length }) })
      if (!response.ok) throw new Error(await responseError(response))
      const updated = await response.json() as IncidentCase
      setCases((items) => items.map((item) => item.id === updated.id ? updated : item))
      toast('Measured scale applied. Track speeds were recalculated; review the entered dimensions independently.')
    } finally { setSavingCalibration(false) }
  }
  const updateTime = (next: number) => { const safe = Math.max(0, Math.min(next, duration)); setTime(safe); if (videoRef.current && currentCase.videoUrl) videoRef.current.currentTime = safe }
  const togglePlay = () => { if (time >= duration) updateTime(0); setIsPlaying((playing) => !playing) }
  const stepFrame = (direction: number) => { setIsPlaying(false); updateTime(time + direction / (currentCase.fps ?? 30)) }
  const handleShare = () => toast('Scenes stay in this local workspace; sharing is not connected.')
  const exportSummary = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const analysis = currentCase.analysis
    const rows = analysis ? [
      ['BLACKBOX SCENE DATA'], ['Scene', currentCase.id], ['Title', currentCase.title], ['Location', currentCase.site],
      ['Data status', analysis.provenance.classification], ['Metric scale', analysis.provenance.metric_scale_available ? 'Available as a model hypothesis; review required' : 'Unavailable; coordinates remain relative'],
      ['Calibration source', analysis.hypothesis.calibration.source], ['Calibration evidence', analysis.hypothesis.calibration.evidence], ['Motion fit', analysis.tracking.fit_model],
      ['Mean fit residual m', analysis.tracking.mean_fit_residual_m ?? ''], ['Limitations', analysis.provenance.not_a_finding],
      ...analysis.tracking.actors.flatMap((actor) => [[`${actor.class_name} first tracked speed m/s`, actor.kinematics.first_observed_speed_mps ?? ''], [`${actor.class_name} speed near event mph`, actor.kinematics.speed_near_impact_mph ?? ''], [`${actor.class_name} braking candidate s`, actor.kinematics.braking_onset_candidate_s ?? '']]),
    ] : [['BLACKBOX SAMPLE SCENE'], ['Scene', currentCase.id], ['Title', currentCase.title], ['Location', currentCase.site], ['Data status', 'Illustrative geometry and motion; no video reconstruction']]
    const blob = new Blob([rows.map((row) => row.map(quote).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${currentCase.id}-${analysis ? 'scene-data' : 'sample-scene'}.csv`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); toast(analysis ? 'Scene data exported.' : 'Sample scene exported.')
  }
  const handleLoadedMetadata = (nextDuration: number) => { if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration) }
  const handleVideoTime = (nextTime: number) => setTime(nextTime)

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Sidebar page={page} cases={cases} activeCaseId={activeCaseId} onNavigate={setPage} onSelectCase={selectCase} onNewCase={openNewCase} onHelp={() => toast('Upload a short video, review the scale, then ask the scene to simulate a change.')} />
      <div className="app-main"><Topbar title={title} onNewCase={openNewCase} onShare={handleShare} onExport={exportSummary} onSearch={() => setPage('cases')} onNotifications={() => toast('You are up to date.')} serviceReady={Boolean(serviceStatus?.ready)} onTestMeta={testMeta} testingMeta={testingMeta} metaTestMessage={metaTestMessage} /><main id="main-content" className="page-content"><ConnectionBanner status={serviceStatus} unavailable={serviceUnavailable} testMessage={metaTestMessage} /><CaseHeader currentCase={currentCase} page={page} onNavigate={setPage} />{page === 'reconstruction' && <Workbench currentCase={currentCase} time={time} duration={duration} isPlaying={isPlaying} gridVisible={gridVisible} tracksVisible={tracksVisible} simulation={simulationResult} onGridToggle={() => setGridVisible(!gridVisible)} onTracksToggle={() => setTracksVisible(!tracksVisible)} onPlay={togglePlay} onTimeChange={updateTime} onStep={stepFrame} videoRef={videoRef} onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={handleVideoTime} onNavigate={setPage} onNewScene={openNewCase} onRetryAnalysis={retryAnalysis} retryingAnalysis={retryingAnalysis} calibrationPoints={calibrationPoints} onCalibrationPointsChange={setCalibrationPoints} onSaveCalibration={saveCalibration} savingCalibration={savingCalibration} />}{page === 'cases' && <CaseFiles cases={cases} onSelect={selectCase} onNewCase={openNewCase} />}{page === 'counterfactual' && <CounterfactualStudio time={time} duration={duration} isPlaying={isPlaying} onPlay={togglePlay} onTimeChange={updateTime} currentCase={currentCase} simulation={simulationResult} onSimulationChange={setSimulationResult} onNavigate={setPage} />}{page === 'findings' && <Findings onExport={exportSummary} onNavigate={setPage} currentCase={currentCase} />}</main><footer className="app-footer"><span>BLACKBOX <i /> Video-to-3D workspace</span><span><span className="footer-lock"><HardDrive size={12} /></span>Local media &amp; analysis <span className="footer-version">v0.3.0</span></span></footer></div>
      {modalOpen && <UploadDialog onClose={() => setModalOpen(false)} onCreate={createCase} />}
      {expandedScene === 'source' && <div className="modal-backdrop scene-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedScene(null) }}><div className="scene-modal" role="dialog" aria-modal="true" aria-label="Expanded source video"><div className="scene-modal-header"><div><span className="section-kicker">SOURCE VIDEO</span><strong>{currentCase.videoUrl ? 'Uploaded video' : 'Illustrative sample footage'}</strong></div><IconButton label="Close expanded video" onClick={() => setExpandedScene(null)}><X size={17} /></IconButton></div>{currentCase.videoUrl ? <video className="expanded-video" src={currentCase.videoUrl} muted controls playsInline /> : <div className="expanded-svg"><EvidenceScene time={time} gridVisible={gridVisible} tracksVisible={tracksVisible} /></div>}<div className="scene-modal-foot"><span><Crosshair size={14} />Synchronized at {formatTime(time)}</span><button type="button" className="button button-quiet" onClick={() => setExpandedScene(null)}>Close video</button></div></div></div>}
      <Toast message={toastMessage} onClose={closeToast} />
    </div>
  )
}

export default App
