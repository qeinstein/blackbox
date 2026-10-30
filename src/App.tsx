import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight,
  BarChart3, Bell, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Clock3, Crosshair, Download, Eye, FileVideo2, Gauge, Grid2X2, HardDrive,
  Layers3, Link2, Maximize2, MoreHorizontal, Pause, Play, Plus,
  RotateCcw, ScanLine, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Upload, Waypoints, X, Zap, type LucideIcon,
} from 'lucide-react'

type Screen = 'cases' | 'reconstruction' | 'counterfactual' | 'findings'
type AnalysisTab = 'summary' | 'physics' | 'sightline'

type IncidentCase = {
  id: string
  title: string
  site: string
  date: string
  category: string
  status: string
  videoName?: string
  videoUrl?: string
}

const initialCases: IncidentCase[] = [
  { id: 'WB-0248', title: 'Westbridge Avenue', site: 'Junction 04 · North approach', date: '18 Oct 2026', category: 'Vehicle collision', status: 'Reference scenario' },
  { id: 'WH-0112', title: 'North dock near-miss', site: 'Distribution centre · Bay 06', date: '11 Oct 2026', category: 'Forklift / pedestrian', status: 'In review' },
  { id: 'RT-0086', title: 'Riverside turn-in', site: 'Riverside Road · Eastbound', date: '03 Oct 2026', category: 'Vehicle / cyclist', status: 'Draft' },
]

const navItems: { id: Screen; label: string; icon: LucideIcon }[] = [
  { id: 'cases', label: 'Case files', icon: Layers3 },
  { id: 'reconstruction', label: 'Reconstruction', icon: Crosshair },
  { id: 'counterfactual', label: 'Counterfactuals', icon: Waypoints },
  { id: 'findings', label: 'Findings', icon: BarChart3 },
]

function formatTime(time: number) {
  const mins = Math.floor(time / 60)
  const secs = (time % 60).toFixed(2).padStart(5, '0')
  return `${String(mins).padStart(2, '0')}:${secs}`
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
        <div className="workspace-copy"><strong>Field investigations</strong><span>Workspace</span></div>
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
      <div className="sidebar-section-title"><span>Recent cases</span><button type="button" aria-label="Add a case" onClick={onNewCase}><Plus size={15} /></button></div>
      <div className="recent-cases">
        {cases.slice(0, 4).map((item, index) => (
          <button type="button" key={item.id} className={`recent-case ${item.id === activeCaseId && page !== 'cases' ? 'selected' : ''}`} onClick={() => onSelectCase(item)}>
            <span className={`case-dot dot-${index}`} /><span className="recent-case-text"><strong>{item.title}</strong><small>{item.id}</small></span>
          </button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="storage-card"><div className="storage-heading"><HardDrive size={14} /><span>Local workspace</span></div><div className="storage-meter"><span /></div><small>Demo mode · files stay on device</small></div>
        <button type="button" className="nav-item utility-item" onClick={onHelp}><CircleHelp size={17} /><span>Help &amp; documentation</span></button>
        <button type="button" className="profile-button"><span className="profile-avatar">AM</span><span className="profile-copy"><strong>Alex Morgan</strong><small>Forensic analyst</small></span><MoreHorizontal size={17} /></button>
      </div>
    </aside>
  )
}

function Topbar({ title, onNewCase, onShare, onExport, onSearch, onNotifications }: { title: string; onNewCase: () => void; onShare: () => void; onExport: () => void; onSearch: () => void; onNotifications: () => void }) {
  return (
    <header className="topbar">
      <div className="breadcrumb"><span>Field investigations</span><ChevronRight size={14} /><strong>{title}</strong></div>
      <div className="topbar-actions">
        <span className="demo-mode-chip"><span className="demo-dot" />DEMO WORKSPACE</span>
        <IconButton label="Search cases" onClick={onSearch}><Search size={17} /></IconButton>
        <IconButton label="Notifications" onClick={onNotifications}><Bell size={17} /></IconButton>
        <span className="topbar-divider" />
        <button type="button" className="button button-quiet top-share" onClick={onShare}><Link2 size={15} />Share</button>
        <button type="button" className="button button-primary top-new" onClick={onNewCase}><Plus size={16} />New case</button>
        {title === 'Findings' && <button type="button" className="button button-quiet top-export" onClick={onExport}><Download size={15} />Export</button>}
      </div>
    </header>
  )
}

function CaseHeader({ currentCase, page, onNavigate }: { currentCase: IncidentCase; page: Screen; onNavigate: (screen: Screen) => void }) {
  return (
    <div className="case-header">
      <div className="case-heading-main">
        <div className="case-meta-line"><span className="case-id-tag">{currentCase.id}</span><span className="meta-dot" /><span>{currentCase.category}</span><span className="meta-dot" /><span>{currentCase.date}</span></div>
        <h1>{page === 'cases' ? 'Case files' : page === 'counterfactual' ? 'Counterfactual studio' : page === 'findings' ? 'Findings & telemetry' : 'Reconstruction'}</h1>
        <p className="case-subtitle">{page === 'cases' ? 'Review incidents and continue an investigation.' : <>{currentCase.title}<span className="inline-separator">/</span>{currentCase.site}</>}</p>
      </div>
      <div className="case-heading-actions">
        {page !== 'cases' && <span className="reference-badge"><ShieldCheck size={14} />{currentCase.videoUrl ? 'Uncalibrated demo view' : 'Reference scenario'}</span>}
        {page !== 'cases' && <button type="button" className="button button-outline" onClick={() => onNavigate('findings')}><FileVideo2 size={15} />Case record</button>}
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

function CalibrationOverlay() {
  const [points, setPoints] = useState([[15, 25], [84, 20], [87, 76], [12, 80]])
  const dragging = useRef<number | null>(null)
  const movePoint = (index: number, clientX: number, clientY: number, target: HTMLElement) => {
    const frame = target.closest('.evidence-viewport')
    if (!frame) return
    const bounds = frame.getBoundingClientRect()
    const x = Math.max(2, Math.min(98, ((clientX - bounds.left) / bounds.width) * 100))
    const y = Math.max(3, Math.min(97, ((clientY - bounds.top) / bounds.height) * 100))
    setPoints((current) => current.map((point, pointIndex) => pointIndex === index ? [x, y] : point))
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current !== null) movePoint(dragging.current, event.clientX, event.clientY, event.target as HTMLElement)
  }
  const keyMove = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const delta = directions[event.key]
    if (!delta) return
    event.preventDefault()
    setPoints((current) => current.map((point, pointIndex) => pointIndex === index ? [Math.max(2, Math.min(98, point[0] + delta[0])), Math.max(3, Math.min(97, point[1] + delta[1]))] : point))
  }
  return (
    <div className="calibration-overlay" onPointerMove={handlePointerMove} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }}>
      <svg className="calibration-plane" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={points.map((point) => point.join(',')).join(' ')} fill="rgba(130,205,175,.09)" stroke="#a5ddc1" strokeWidth=".45" strokeDasharray="1.2 1" /><path d={`M${points[0][0]} ${points[0][1]} L${points[2][0]} ${points[2][1]} M${points[1][0]} ${points[1][1]} L${points[3][0]} ${points[3][1]}`} fill="none" stroke="#b2e4ca" strokeWidth=".35" strokeDasharray="1 1" /></svg>
      {points.map((point, index) => <button type="button" key={index} className="calibration-handle" style={{ left: `${point[0]}%`, top: `${point[1]}%` }} aria-label={`Move calibration grid corner ${index + 1}; use arrow keys for fine adjustment`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragging.current = index }} onPointerUp={() => { dragging.current = null }} onKeyDown={(event) => keyMove(event, index)}><span /></button>)}
    </div>
  )
}

function Vehicle({ x, y, angle, fill, outline = '#d8e6e4', ghost = false }: { x: number; y: number; angle: number; fill: string; outline?: string; ghost?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity={ghost ? '.42' : '1'}>
      <rect x="-21" y="-39" width="42" height="78" rx="10" fill={fill} stroke={outline} strokeWidth="2" />
      <path d="M-15-17q15-8 30 0v18q-15 7-30 0Z" fill="#c5d9d6" opacity=".66" />
      <path d="M-14-29q14-7 28 0" fill="none" stroke="#e6eee9" strokeWidth="2" opacity=".6" />
      <rect x="-22" y="-28" width="5" height="14" rx="2" fill="#172b2e" /><rect x="17" y="-28" width="5" height="14" rx="2" fill="#172b2e" />
      <rect x="-22" y="18" width="5" height="14" rx="2" fill="#172b2e" /><rect x="17" y="18" width="5" height="14" rx="2" fill="#172b2e" />
      <path d="M-13 34h7m12 0h7" stroke="#f3ba83" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
}

function DigitalTwinScene({ time, showGhost, tracksVisible = true, projection = 'isometric', ghostSpeed, ghostStopDistance }: { time: number; showGhost?: boolean; tracksVisible?: boolean; projection?: 'isometric' | 'top-down'; ghostSpeed?: number; ghostStopDistance?: number }) {
  const t = Math.min(time / 5.2, 1)
  const aX = 190 + t * 300
  const bY = 365 - t * 127
  const ghostProgress = ghostSpeed ? Math.min(time / (5.2 * (42 / ghostSpeed)), 1) : t
  const maxGhostProgress = ghostStopDistance !== undefined && ghostStopDistance <= 46 ? Math.max(0, 1 - ghostStopDistance / 46) : 1
  const ghostY = 365 - Math.min(ghostProgress, maxGhostProgress) * 127
  const afterImpact = Math.max(0, Math.min((time - 5.1) / 2.6, 1))
  return (
    <svg className="twin-svg" viewBox="0 0 760 450" role="img" aria-label="Interactive digital twin scene showing vehicle paths and a marked impact point">
      <defs>
        <pattern id="ground-grid" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="skewY(13)"><path d="M32 0H0v32" fill="none" stroke="#345156" strokeWidth=".75" opacity=".5" /></pattern>
        <linearGradient id="road-face" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#34484b" /><stop offset="1" stopColor="#263a3d" /></linearGradient>
        <linearGradient id="building-top" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#77918a" /><stop offset="1" stopColor="#516a67" /></linearGradient>
        <filter id="soft-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7" /></filter>
      </defs>
      <rect width="760" height="450" rx="0" fill="#15292d" />
      <path d="M55 90 647 41l57 273-579 85Z" fill="#1c3337" />
      <path d="M55 90 647 41l57 273-579 85Z" fill="url(#ground-grid)" />
      <g transform={projection === 'top-down' ? 'matrix(.72 0 0 .72 126 39)' : 'matrix(.77 .21 -.31 .68 159 -18)'}>
        <path d="M70 185H650v112H70z" fill="#66766e" opacity=".52" />
        <path d="M70 190H650v107H70z" fill="url(#road-face)" stroke="#75847d" strokeWidth="3" />
        <path d="M310 72h117v352H310z" fill="#66766e" opacity=".52" />
        <path d="M310 72h117v352H310z" fill="url(#road-face)" stroke="#75847d" strokeWidth="3" />
        <path d="M76 201H646M76 286H646" stroke="#acb39d" strokeWidth="3" opacity=".6" />
        <path d="M317 78v340m102-340v340" stroke="#acb39d" strokeWidth="3" opacity=".6" />
        <path d="M75 244h576M368 73v348" stroke="#d8d9c4" strokeWidth="2" strokeDasharray="17 15" opacity=".62" />
        {Array.from({ length: 5 }, (_, i) => <path key={i} d={`M${324 + i * 19} 187v45h10v-45`} fill="#d3d5c5" opacity=".72" />)}
        <path d="M275 185h24v112h-24zm160 0h24v112h-24z" fill="#75847d" />
        <path d="M196 115h76v51h-76z" fill="#748881" stroke="#9aac9e" strokeWidth="2" />
        <path d="m196 115 18-23h76l-18 23Z" fill="url(#building-top)" />
        <path d="m272 115 18-23v51l-18 23Z" fill="#405b58" />
        <path d="M476 326h103v47H476z" fill="#748881" stroke="#9aac9e" strokeWidth="2" />
        <path d="m476 326 19-24h103l-19 24Z" fill="url(#building-top)" />
        <path d="m579 326 19-24v47l-19 24Z" fill="#405b58" />
        {tracksVisible && <path d="M272 218 368 176l100 44" fill="none" stroke="#f0a66e" strokeWidth="2.5" strokeDasharray="6 5" />}
        {tracksVisible && <path d="M300 156 367 218l43 1" fill="none" stroke="#64c5b4" strokeWidth="2" strokeDasharray="4 6" opacity=".8" />}
        <path d="M369 225 354 239l14 14 14-14Z" fill="#e48d58" stroke="#ffe1bd" strokeWidth="2" />
        <circle cx="368" cy="239" r="18" fill="#e48d58" opacity=".24" filter="url(#soft-glow)" />
        <circle cx="368" cy="239" r="5" fill="#f4b27e" />
        <g transform={`translate(${aX} ${240 + afterImpact*22})`}><Vehicle x={0} y={0} angle={90 - afterImpact*40} fill="#4f8e8b" /></g>
        <g transform={`translate(${365 + afterImpact*28} ${bY + afterImpact*24})`}><Vehicle x={0} y={0} angle={0 + afterImpact*42} fill="#a2a993" /></g>
        {showGhost && <g transform={`translate(${365 + afterImpact*11} ${ghostY})`}><Vehicle x={0} y={0} angle={0} fill="#74c7b4" outline="#78d8c1" ghost /></g>}
        {tracksVisible && <path d="M368 239 237 239" stroke="#dce9dd" strokeWidth="1.5" strokeDasharray="4 5" opacity=".58" />}
        {tracksVisible && <path d="M368 239 368 342" stroke="#dce9dd" strokeWidth="1.5" strokeDasharray="4 5" opacity=".58" />}
      </g>
      <g className="scene-annotation"><rect x="33" y="31" width="119" height="27" rx="4" fill="#223b3f" stroke="#526b6d" /><circle cx="47" cy="44.5" r="3.5" fill="#eaa16c" /><text x="58" y="48" fill="#dfe8df" fontSize="10" fontFamily="monospace">IMPACT · 05.12 s</text></g>
      <g transform="translate(692 38)"><path d="M0 14V0m0 0-5 7m5-7 5 7" stroke="#d2dfd6" strokeWidth="1.5" fill="none" /><text x="-3" y="28" fill="#b5c6bd" fontSize="8" fontFamily="monospace">N</text></g>
      {showGhost && <g transform="translate(34 410)"><circle cx="4" cy="4" r="4" fill="#75cbb5" opacity=".65" /><text x="14" y="7" fill="#d2ded7" fontSize="9" fontFamily="monospace">COUNTERFACTUAL PATH</text></g>}
    </svg>
  )
}

function EvidencePanel({ time, gridVisible, tracksVisible, onGridToggle, onMaximize, videoUrl, videoRef, onLoadedMetadata, onTimeUpdate }: {
  time: number; gridVisible: boolean; tracksVisible: boolean; onGridToggle: () => void; onMaximize: () => void;
  videoUrl?: string; videoRef: RefObject<HTMLVideoElement>; onLoadedMetadata: (duration: number) => void; onTimeUpdate: (time: number) => void
}) {
  return (
    <section className="visual-panel evidence-panel" aria-label="Source video evidence">
      <div className="visual-panel-header">
        <div className="panel-title-group"><span className="panel-kicker">SOURCE EVIDENCE</span><strong>Camera 04 · Northbound</strong></div>
        <div className="panel-header-actions"><StatusDot tone="orange">{videoUrl ? 'Local video' : 'Sample footage'}</StatusDot><IconButton label="Expand source video" onClick={onMaximize}><Maximize2 size={15} /></IconButton></div>
      </div>
      <div className="evidence-viewport">
        {videoUrl ? <video ref={videoRef} className="uploaded-video" src={videoUrl} muted playsInline onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget.duration)} onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)} aria-label="Uploaded incident video" /> : <EvidenceScene time={time} gridVisible={gridVisible} tracksVisible={tracksVisible} />}
      {gridVisible && <CalibrationOverlay />}
        <div className="camera-stamp"><span>CAM 04</span><span>{formatTime(time)}</span><span className="record-led">REC</span></div>
        {gridVisible && <div className="grid-state-label"><Grid2X2 size={12} />GROUND PLANE · 8 m GRID</div>}
        {!videoUrl && <div className="footage-note"><span>Reference footage · illustrative</span></div>}
      </div>
      <div className="visual-panel-footer"><div className="legend-item"><span className="legend-line legend-orange" />Vehicle A</div><div className="legend-item"><span className="legend-line legend-teal" />Vehicle B</div><button type="button" className={`tool-toggle ${gridVisible ? 'tool-active' : ''}`} onClick={onGridToggle} aria-pressed={gridVisible}><Grid2X2 size={14} />{gridVisible ? 'Grid on' : 'Calibrate'}</button></div>
    </section>
  )
}

function TwinPanel({ time, showGhost, onToggleTracks, tracksVisible, projection, onToggleProjection, onMaximize }: { time: number; showGhost: boolean; onToggleTracks: () => void; tracksVisible: boolean; projection: 'isometric' | 'top-down'; onToggleProjection: () => void; onMaximize: () => void }) {
  return (
    <section className="visual-panel twin-panel" aria-label="3D digital twin">
      <div className="visual-panel-header twin-header">
        <div className="panel-title-group"><span className="panel-kicker">RECONSTRUCTED SCENE</span><strong>Ground plane · {projection === 'isometric' ? 'isometric' : 'top-down'}</strong></div>
        <div className="panel-header-actions"><StatusDot>3D twin</StatusDot><IconButton label="Expand digital twin" onClick={onMaximize}><Maximize2 size={15} /></IconButton></div>
      </div>
      <div className="twin-viewport"><DigitalTwinScene time={time} showGhost={showGhost} tracksVisible={tracksVisible} projection={projection} /><div className="scene-scale"><span /><span>10 m</span></div><div className="scene-tools"><IconButton label={tracksVisible ? 'Hide trajectories' : 'Show trajectories'} onClick={onToggleTracks}><Waypoints size={15} /></IconButton><IconButton label={`Switch to ${projection === 'isometric' ? 'top-down' : 'isometric'} view`} onClick={onToggleProjection}><Settings2 size={15} /></IconButton></div></div>
      <div className="visual-panel-footer twin-footer"><div className="legend-item"><span className="legend-dot legend-orange-dot" />Impact point</div><div className="legend-item"><span className="legend-line legend-teal" />Sightline</div><span className="coordinate-readout">X 12.4&nbsp;&nbsp; Y 08.7 m</span></div>
    </section>
  )
}

function Timeline({ time, duration, isPlaying, onPlay, onTimeChange, onStep, impactTime }: { time: number; duration: number; isPlaying: boolean; onPlay: () => void; onTimeChange: (time: number) => void; onStep: (direction: number) => void; impactTime?: number }) {
  const safeDuration = duration > 0 ? duration : 10.4
  const visibleImpactTime = impactTime !== undefined && impactTime <= safeDuration ? impactTime : undefined
  const ticks = visibleImpactTime === undefined
    ? [0, safeDuration * .2, safeDuration * .4, safeDuration * .6, safeDuration * .8, safeDuration]
    : [0, safeDuration * .2, safeDuration * .35, visibleImpactTime, safeDuration * .78, safeDuration]
  return (
    <section className="timeline-panel" aria-label="Synchronized incident timeline">
      <div className="timeline-toolbar"><div className="timeline-controls"><IconButton label="Step back one frame" onClick={() => onStep(-1)}><ArrowLeft size={15} /></IconButton><button type="button" className="play-button" aria-label={isPlaying ? 'Pause playback' : 'Play synchronized playback'} onClick={onPlay}>{isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><IconButton label="Step forward one frame" onClick={() => onStep(1)}><ArrowRight size={15} /></IconButton></div><div className="timeline-time"><strong>{formatTime(time)}</strong><span>/</span><span>{formatTime(safeDuration)}</span><span className="timeline-fps">30 FPS</span></div><div className="timeline-actions"><button type="button" className="timeline-action" onClick={() => onTimeChange(0)}><RotateCcw size={14} />Reset playback</button></div></div>
      <div className="timeline-range-wrap"><div className="timeline-markers">{ticks.map((tick, index) => <span key={`${index}-${tick}`}>{formatTime(tick)}{visibleImpactTime !== undefined && Math.abs(tick - visibleImpactTime) < .001 && <b>IMPACT</b>}</span>)}</div><div className="timeline-visual"><div className="timeline-track"><span className="timeline-progress" style={{ width: `${Math.max(0, Math.min((time / safeDuration) * 100, 100))}%` }} /></div>{visibleImpactTime !== undefined && <div className="timeline-impact-marker" style={{ left: `${Math.min((visibleImpactTime / safeDuration) * 100, 100)}%` }}><span /></div>}<input aria-label="Scrub synchronized video and simulation" type="range" min={0} max={safeDuration} step={0.04} value={Math.min(time, safeDuration)} onChange={(event) => onTimeChange(Number(event.target.value))} /></div></div>
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

function Workbench({ currentCase, time, duration, isPlaying, gridVisible, tracksVisible, onGridToggle, onTracksToggle, onPlay, onTimeChange, onStep, videoRef, onLoadedMetadata, onTimeUpdate, onNavigate }: {
  currentCase: IncidentCase; time: number; duration: number; isPlaying: boolean; gridVisible: boolean; tracksVisible: boolean;
  onGridToggle: () => void; onTracksToggle: () => void; onPlay: () => void; onTimeChange: (time: number) => void; onStep: (direction: number) => void;
  videoRef: RefObject<HTMLVideoElement>; onLoadedMetadata: (duration: number) => void; onTimeUpdate: (time: number) => void; onNavigate: (screen: Screen) => void
}) {
  const [tab, setTab] = useState<AnalysisTab>('summary')
  const [running, setRunning] = useState(false)
  const [previewed, setPreviewed] = useState(false)
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null)
  const [projection, setProjection] = useState<'isometric' | 'top-down'>('isometric')
  const toggleProjection = () => setProjection((current) => current === 'isometric' ? 'top-down' : 'isometric')
  const runReconstruction = () => { setRunning(true); setPreviewed(false); window.setTimeout(() => { setRunning(false); setPreviewed(true) }, 2200) }
  return (
    <>
      <div className="workbench-layout">
        <div className="workbench-main">
          <div className="scene-toolbar"><div className="scene-status"><span className="live-simulation-dot" />{currentCase.videoUrl ? 'Local video loaded' : 'Reference scenario loaded'}<span className="toolbar-divider" /><span>{duration.toFixed(1)} s · 30 fps</span></div><div className="scene-toolbar-actions"><button type="button" className="view-select" onClick={toggleProjection}><Layers3 size={14} />{projection === 'isometric' ? 'Isometric view' : 'Top-down view'}<ChevronDown size={13} /></button><IconButton label="Case options" onClick={() => onNavigate('cases')}><MoreHorizontal size={17} /></IconButton></div></div>
          <div className="visual-pair">
            <EvidencePanel time={time} gridVisible={gridVisible} tracksVisible={tracksVisible} onGridToggle={onGridToggle} onMaximize={() => window.dispatchEvent(new Event('blackbox-source-expand'))} videoUrl={currentCase.videoUrl} videoRef={videoRef} onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} />
            <TwinPanel time={time} showGhost={false} onToggleTracks={onTracksToggle} tracksVisible={tracksVisible} projection={projection} onToggleProjection={toggleProjection} onMaximize={() => window.dispatchEvent(new Event('blackbox-twin-expand'))} />
          </div>
          <Timeline time={time} duration={duration} isPlaying={isPlaying} onPlay={onPlay} onTimeChange={onTimeChange} onStep={onStep} impactTime={currentCase.videoUrl ? undefined : 5.2} />
          <section className="telemetry-panel">
            <div className="section-heading"><div><span className="section-kicker">MOTION PROFILE · DEMO</span><h2>Velocity over time</h2></div><div className="chart-controls"><div className="playhead-reading"><small>SAMPLE SPEED AT PLAYHEAD</small><strong>{sampleSpeedKmh(time).toFixed(1)} <em>km/h</em></strong></div><button type="button" className="chart-select">Vehicle A <ChevronDown size={13} /></button></div></div>
            <div className="chart-plot"><div className="chart-y-axis"><span>60</span><span>40</span><span>20</span><span>0</span></div><div className="chart-content"><TelemetryChart time={time} duration={duration} /><div className="chart-x-axis">{Array.from({ length: 6 }, (_, index) => <span key={index}>{formatTime((duration * index) / 5)}</span>)}</div></div></div>
          </section>
        </div>
        <aside className="analysis-rail">
          <div className="analysis-card analysis-overview">
            <div className="analysis-card-heading"><div><span className="section-kicker">SCENARIO ANALYSIS</span><h2>Reconstruction</h2></div><IconButton label="Analysis options"><MoreHorizontal size={16} /></IconButton></div>
            <StatusDot>Reference model · illustrative</StatusDot>
            <div className="fit-summary"><div className="fit-value">93<span>%</span></div><div className="fit-description"><strong>Trajectory fit</strong><small>Sample reference score</small></div><div className="fit-sparkline"><svg viewBox="0 0 70 30" aria-hidden="true"><path d="m2 24 12-5 10 3 11-13 12 7 11-9 10 2" fill="none" stroke="#55a194" strokeWidth="2" /></svg></div></div>
            <div className="residual-line"><span>Mean position residual</span><strong>0.18 m</strong><span className="residual-indicator"><Check size={12} />Within demo threshold</span></div>
            <div className="analysis-divider" />
            <div className="analysis-tabs" role="tablist" aria-label="Analysis details">{(['summary','physics','sightline'] as AnalysisTab[]).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item === 'summary' ? 'Summary' : item === 'physics' ? 'Physics' : 'Sightline'}</button>)}</div>
            {tab === 'summary' && <div className="analysis-tab-content"><div className="metric-row"><span className="metric-icon"><Gauge size={15} /></span><span className="metric-copy"><strong>Entry speed</strong><small>Vehicle A · reconstructed</small></span><strong className="metric-value">42 <small>mph</small></strong></div><div className="metric-row"><span className="metric-icon"><Activity size={15} /></span><span className="metric-copy"><strong>Braking onset</strong><small>Vehicle A · before impact</small></span><strong className="metric-value">−1.6 <small>s</small></strong></div><div className="metric-row"><span className="metric-icon"><Crosshair size={15} /></span><span className="metric-copy"><strong>Impact speed</strong><small>Vehicle A · estimated</small></span><strong className="metric-value">31 <small>mph</small></strong></div><button type="button" className="text-link" onClick={() => onNavigate('findings')}>View full findings <ArrowRight size={14} /></button></div>}
            {tab === 'physics' && <div className="analysis-tab-content"><div className="metric-row"><span className="metric-icon"><Gauge size={15} /></span><span className="metric-copy"><strong>Surface friction</strong><small>Dry asphalt · assumed</small></span><strong className="metric-value">0.72 <small>μ</small></strong></div><div className="metric-row"><span className="metric-icon"><Activity size={15} /></span><span className="metric-copy"><strong>Initial velocity</strong><small>Vehicle A · eastbound</small></span><strong className="metric-value">18.8 <small>m/s</small></strong></div><div className="metric-row"><span className="metric-icon"><Clock3 size={15} /></span><span className="metric-copy"><strong>Model iterations</strong><small>Demonstration run</small></span><strong className="metric-value">24</strong></div></div>}
            {tab === 'sightline' && <div className="analysis-tab-content"><div className="sightline-result"><div className="sightline-icon"><Eye size={17} /></div><div><strong>Clear view at 04.31 s</strong><small>Estimated first visible moment</small></div></div><div className="sightline-bar"><span style={{ width: '68%' }} /></div><div className="sightline-scale"><span>Occluded</span><span>Clear</span></div><div className="sightline-note"><AlertTriangle size={14} /><span>Reaction window is a scenario input. Review camera calibration before relying on timing.</span></div><button type="button" className="text-link" onClick={() => onNavigate('counterfactual')}>Compare reaction times <ArrowRight size={14} /></button></div>}
            <button type="button" className={`button run-button ${running ? 'is-running' : ''}`} onClick={runReconstruction} disabled={running}>{running ? <><span className="button-spinner" />Previewing sample iterations…</> : <><Sparkles size={15} />{previewed ? 'Replay sample preview' : 'Preview refinement loop'}<ArrowRight size={14} /></>}</button>
            <p className="assumption-note"><AlertTriangle size={13} />Demonstration values only. This model has not been calibrated to an uploaded clip.</p>
          </div>
          <div className="analysis-card event-card"><div className="event-card-heading"><span className="section-kicker">{currentCase.videoUrl ? 'REFERENCE MOMENTS · DEMO' : 'KEY MOMENTS'}</span><button type="button" className="small-link" onClick={() => setExpandedMetric(expandedMetric === 'events' ? null : 'events')}>{expandedMetric === 'events' ? 'Hide' : 'View all'}</button></div><button type="button" className="event-row" onClick={() => onTimeChange(3.48)}><span className="event-glyph event-sight"><Eye size={14} /></span><span className="event-copy"><strong>Hazard enters sightline</strong><small>Visibility clears</small></span><time>03.48 s</time></button><button type="button" className="event-row" onClick={() => onTimeChange(4.62)}><span className="event-glyph event-brake"><Zap size={14} /></span><span className="event-copy"><strong>Braking begins</strong><small>Vehicle A · decelerates</small></span><time>04.62 s</time></button><button type="button" className="event-row" onClick={() => onTimeChange(5.2)}><span className="event-glyph event-impact"><Crosshair size={14} /></span><span className="event-copy"><strong>First contact</strong><small>Impact marker</small></span><time>05.20 s</time></button>{expandedMetric === 'events' && <div className="event-extra">Post-impact rest <button type="button" onClick={() => onTimeChange(9.18)}>09.18 s</button></div>}</div>
          <div className="calibration-reminder"><div className="reminder-icon"><ScanLine size={16} /></div><div><strong>Camera calibration</strong><p>Confirm the ground plane to improve metric estimates.</p><button type="button" className="text-link" onClick={onGridToggle}>Adjust calibration <ArrowRight size={13} /></button></div></div>
        </aside>
      </div>
    </>
  )
}

function CaseFiles({ cases, onSelect, onNewCase }: { cases: IncidentCase[]; onSelect: (item: IncidentCase) => void; onNewCase: () => void }) {
  const [filter, setFilter] = useState('All cases')
  return (
    <div className="case-files-page">
      <div className="case-files-toolbar"><div className="filter-tabs">{['All cases','In review','Draft'].map((label) => <button key={label} type="button" className={filter === label ? 'active' : ''} onClick={() => setFilter(label)}>{label}<span>{label === 'All cases' ? cases.length.toString().padStart(2, '0') : label === 'In review' ? cases.filter((item) => item.status === 'In review').length.toString().padStart(2, '0') : cases.filter((item) => item.status === 'Draft').length.toString().padStart(2, '0')}</span></button>)}</div><div className="case-file-actions"><button type="button" className="button button-outline"><SlidersHorizontal size={15} />Filter</button><button type="button" className="button button-primary" onClick={onNewCase}><Plus size={16} />New investigation</button></div></div>
      <div className="case-table-card"><div className="case-table-head"><span>Incident</span><span>Type</span><span>Last updated</span><span>Status</span><span /></div>{cases.filter((item) => filter === 'All cases' || item.status === filter).map((item, index) => <button type="button" key={item.id} className="case-table-row" onClick={() => onSelect(item)}><span className="case-table-title"><span className={`case-file-icon case-file-${index % 3}`}><FileVideo2 size={17} /></span><span><strong>{item.title}</strong><small>{item.id} <span className="table-separator">/</span> {item.site}</small></span></span><span className="table-type">{item.category}</span><span className="table-date">{item.date}</span><span><span className={`case-status status-case-${item.status === 'Draft' ? 'draft' : item.status === 'In review' ? 'review' : 'reference'}`}><span />{item.status}</span></span><ChevronRight className="table-chevron" size={16} /></button>)}{cases.length === 0 && <div className="empty-cases"><div className="empty-icon"><FileVideo2 size={21} /></div><strong>No cases here yet</strong><p>Upload an incident video to start a reconstruction.</p><button type="button" className="button button-primary" onClick={onNewCase}><Plus size={15} />Create a case</button></div>}</div>
      <div className="case-files-footnote"><ShieldCheck size={15} /><span>Case media remains in this browser session. No files are sent to a server in this demo workspace.</span></div>
      <div className="case-summary-strip"><div><span className="summary-strip-icon"><Layers3 size={16} /></span><span><strong>{cases.length} active case files</strong><small>Across vehicle and workplace incidents</small></span></div><div><span className="summary-strip-icon"><HardDrive size={16} /></span><span><strong>Local demo storage</strong><small>Uploads are held in this browser only</small></span></div><button type="button" onClick={onNewCase}>Start an investigation <ArrowRight size={14} /></button></div>
    </div>
  )
}

function estimateStoppingDistance(speedMph: number, reactionSeconds: number, friction: number) {
  const speedMps = speedMph * 0.44704
  const reactionDistance = speedMps * reactionSeconds
  const brakingDistance = (speedMps * speedMps) / (2 * friction * 9.81)
  return { total: reactionDistance + brakingDistance, reaction: reactionDistance, braking: brakingDistance }
}

function CounterfactualStudio({ time, duration, isPlaying, onPlay, onTimeChange, onStep }: { time: number; duration: number; isPlaying: boolean; onPlay: () => void; onTimeChange: (time: number) => void; onStep: (direction: number) => void }) {
  const [speed, setSpeed] = useState(42)
  const [reaction, setReaction] = useState(1.5)
  const [surface, setSurface] = useState(0.72)
  const [showGhost, setShowGhost] = useState(true)
  const [showMethod, setShowMethod] = useState(false)
  const distance = useMemo(() => estimateStoppingDistance(speed, reaction, surface), [speed, reaction, surface])
  const clearDistance = 46
  const withinDistance = distance.total <= clearDistance
  return (
    <div className="counterfactual-layout">
      <div className="counterfactual-main">
        <div className="counterfactual-toolbar"><div className="scenario-switch"><span className="scenario-dot" /><span><strong>Scenario A</strong><small>Illustrative baseline · not fitted to clip</small></span><ChevronDown size={15} /></div><button type="button" className={`ghost-toggle ${showGhost ? 'active' : ''}`} onClick={() => setShowGhost(!showGhost)} aria-pressed={showGhost}><Eye size={15} />{showGhost ? 'Ghost path on' : 'Show ghost path'}</button></div>
        <div className="counterfactual-scene"><DigitalTwinScene time={time} showGhost={showGhost} ghostSpeed={speed} ghostStopDistance={distance.total} /><div className="cf-scene-key"><span><i className="key-line-original" />Sample baseline</span>{showGhost && <span><i className="key-line-ghost" />Counterfactual</span>}</div></div>
        <Timeline time={time} duration={duration} isPlaying={isPlaying} onPlay={onPlay} onTimeChange={onTimeChange} onStep={onStep} impactTime={5.2} />
        <div className="counterfactual-method"><div className="method-icon"><Activity size={16} /></div><div><strong>How this estimate is calculated</strong><p>Reaction distance + braking distance using the selected speed, response time, and friction. Assumes a level road and constant friction; it does not model collision dynamics.</p>{showMethod && <div className="method-details"><code>d = v × t<sub>r</sub> + v² / (2 μ g)</code><span>Speed is converted to m/s. The sightline is a fixed 46 m demonstration input.</span></div>}</div><button type="button" aria-label={showMethod ? 'Hide calculation details' : 'Show calculation details'} aria-expanded={showMethod} onClick={() => setShowMethod(!showMethod)}><ChevronDown size={16} /></button></div>
      </div>
      <aside className="cf-controls-rail">
        <div className="cf-panel-heading"><div><span className="section-kicker">EDIT VARIABLES</span><h2>Scenario inputs</h2></div><IconButton label="Reset scenario" onClick={() => { setSpeed(42); setReaction(1.5); setSurface(.72) }}><RotateCcw size={15} /></IconButton></div>
        <div className="cf-control-group"><div className="cf-control-heading"><label htmlFor="cf-speed">Entry speed</label><span className="cf-value">{speed}<small>mph</small></span></div><input id="cf-speed" className="range-control range-teal" type="range" min="10" max="60" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /><div className="range-labels"><span>10 mph</span><span>60 mph</span></div><div className="preset-buttons"><button type="button" onClick={() => setSpeed(25)}>Posted limit <strong>25</strong></button><button type="button" onClick={() => setSpeed(42)}>Reconstructed <strong>42</strong></button></div></div>
        <div className="cf-control-group"><div className="cf-control-heading"><label htmlFor="cf-reaction">Perception + reaction</label><span className="cf-value">{reaction.toFixed(1)}<small>s</small></span></div><input id="cf-reaction" className="range-control range-orange" type="range" min="0.5" max="3" step="0.1" value={reaction} onChange={(event) => setReaction(Number(event.target.value))} /><div className="range-labels"><span>0.5 s</span><span>3.0 s</span></div><div className="reaction-note"><Clock3 size={14} />Typical reference: 1.5 s <button type="button" onClick={() => setReaction(1.5)}>Use</button></div></div>
        <div className="cf-control-group"><div className="cf-control-heading"><label htmlFor="cf-surface">Road surface</label><span className="cf-value">μ {surface.toFixed(2)}</span></div><input id="cf-surface" className="range-control range-teal" type="range" min="0.15" max="0.9" step="0.01" value={surface} onChange={(event) => setSurface(Number(event.target.value))} /><div className="surface-options"><button type="button" className={surface >= .65 ? 'active' : ''} onClick={() => setSurface(.72)}><span className="surface-swatch dry" />Dry asphalt <small>.72</small></button><button type="button" className={surface < .65 && surface > .3 ? 'active' : ''} onClick={() => setSurface(.42)}><span className="surface-swatch wet" />Wet pavement <small>.42</small></button><button type="button" className={surface <= .3 ? 'active' : ''} onClick={() => setSurface(.18)}><span className="surface-swatch ice" />Ice <small>.18</small></button></div></div>
        <div className={`cf-verdict ${withinDistance ? 'verdict-clear' : 'verdict-risk'}`}><div className="verdict-topline"><span className="verdict-icon">{withinDistance ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span><span className="section-kicker">ILLUSTRATIVE ESTIMATE</span><span className="verdict-demo-tag">DEMO</span></div><h3>{withinDistance ? 'Within clear distance' : 'Exceeds clear distance'}</h3><p>{withinDistance ? 'The estimated stopping distance falls within the 46 m clear sightline for these inputs.' : 'The estimated stopping distance extends beyond the 46 m clear sightline for these inputs.'}</p><div className="distance-comparison"><div><small>Stopping distance</small><strong>{distance.total.toFixed(1)} <span>m</span></strong></div><span className="distance-divider" /><div><small>Clear sightline</small><strong>46.0 <span>m</span></strong></div></div><div className="distance-bar"><span className={withinDistance ? 'distance-in-range' : ''} style={{ width: `${Math.min((distance.total / 62) * 100, 100)}%` }} /><i style={{ left: `${(clearDistance / 62) * 100}%` }} /></div><div className="distance-detail"><span>Reaction {distance.reaction.toFixed(1)} m</span><span>Braking {distance.braking.toFixed(1)} m</span></div></div>
        <p className="cf-disclaimer"><AlertTriangle size={13} />A simplified stopping-distance comparison. It is not a finding of preventability or a substitute for a calibrated reconstruction.</p>
      </aside>
    </div>
  )
}

function Findings({ onExport, onNavigate }: { onExport: () => void; onNavigate: (screen: Screen) => void }) {
  return (
    <div className="findings-page">
      <div className="findings-banner"><div className="findings-banner-icon"><AlertTriangle size={18} /></div><div><strong>Demonstration findings</strong><p>These values illustrate the report layout. No source clip has been calibrated or independently verified.</p></div><span>REFERENCE DATA</span></div>
      <div className="findings-grid"><section className="findings-card verdict-card"><div className="findings-card-heading"><div><span className="section-kicker">KINEMATIC SUMMARY</span><h2>Reference scenario</h2></div><span className="status-pill status-orange"><span className="status-pip" />Illustrative</span></div><div className="verdict-summary"><div className="verdict-graphic"><div className="verdict-ring"><span><Activity size={22} /></span></div></div><div><span className="verdict-kicker">ESTIMATED PRE-IMPACT</span><strong>42 <small>mph</small></strong><p>Vehicle A · eastbound approach</p></div></div><div className="findings-metric-grid"><div><span>Impact speed</span><strong>31 <small>mph</small></strong><small>Vehicle A · estimated</small></div><div><span>Braking onset</span><strong>04.62 <small>s</small></strong><small>1.6 s before impact</small></div><div><span>Impact timestamp</span><strong>05.20 <small>s</small></strong><small>First contact marker</small></div><div><span>Mean residual</span><strong>0.18 <small>m</small></strong><small>Reference model fit</small></div></div></section>
      <section className="findings-card preventability-card"><div className="findings-card-heading"><div><span className="section-kicker">COUNTERFACTUAL CHECK</span><h2>Stopping distance</h2></div><button type="button" className="small-link" onClick={() => onNavigate('counterfactual')}>Edit scenario <ArrowRight size={13} /></button></div><div className="preventability-number"><strong>37.2</strong><span>m</span><small>Estimated at 25 mph · 1.5 s response · dry asphalt</small></div><div className="comparison-meter"><div className="meter-scale"><span>0 m</span><span>46 m clear sightline</span><span>60 m</span></div><div className="meter-track"><span style={{ width: '62%' }} /><i style={{ left: '76.6%' }} /></div></div><div className="finding-conclusion"><span className="conclusion-indicator"><Check size={15} /></span><span><strong>Inside the illustrative clear distance</strong><small>This simplified comparison omits collision dynamics and uncertainty bounds.</small></span></div></section>
      <section className="findings-card telemetry-findings"><div className="findings-card-heading"><div><span className="section-kicker">SYNCHRONIZED TELEMETRY</span><h2>Motion profile</h2></div><button type="button" className="chart-select">Vehicle A <ChevronDown size={13} /></button></div><div className="findings-chart-legend"><span><i className="legend-line legend-teal" />Speed <small>km/h</small></span><span><i className="legend-line legend-orange" />Distance <small>m</small></span></div><div className="findings-chart"><div className="chart-y-axis"><span>60</span><span>40</span><span>20</span><span>0</span></div><div className="chart-content"><TelemetryChart time={4.6} kind="both" /><div className="chart-x-axis">{Array.from({ length: 6 }, (_, index) => <span key={index}>{formatTime((10.4 * index) / 5)}</span>)}</div></div></div><div className="telemetry-footnote">Impact marker <span>05.20 s</span><span className="telemetry-footnote-line" /></div></section>
      <section className="findings-card assumptions-card"><div className="findings-card-heading"><div><span className="section-kicker">MODEL RECORD</span><h2>Inputs &amp; assumptions</h2></div><Settings2 size={17} /></div><div className="assumption-list"><div><span className="assumption-check"><Check size={12} /></span><span><strong>Ground plane</strong><small>Planar, level road · demo geometry</small></span><span className="assumption-value">ASSUMED</span></div><div><span className="assumption-check"><Check size={12} /></span><span><strong>Road friction</strong><small>Dry asphalt · μ = 0.72</small></span><span className="assumption-value">ASSUMED</span></div><div><span className="assumption-check"><Check size={12} /></span><span><strong>Vehicle mass</strong><small>Passenger vehicle · 1,500 kg</small></span><span className="assumption-value">ESTIMATED</span></div><div><span className="assumption-pending"><Clock3 size={12} /></span><span><strong>Camera calibration</strong><small>No uploaded footage calibrated</small></span><span className="assumption-value pending">PENDING</span></div></div><button type="button" className="text-link" onClick={() => onNavigate('reconstruction')}>Review reconstruction <ArrowRight size={14} /></button></section></div>
      <div className="report-actions"><div><ShieldCheck size={16} /><span><strong>Report integrity</strong><small>Download is labeled as demonstration data</small></span></div><button type="button" className="button button-primary" onClick={onExport}><Download size={15} />Export case summary</button></div>
    </div>
  )
}

function UploadDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, site: string, file: File) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [site, setSite] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const selectFile = (selected: File | undefined) => {
    if (!selected) return
    if (!selected.type.startsWith('video/')) { setError('Choose a video file in MP4, MOV, or WebM format.'); return }
    setError(''); setFile(selected)
    if (!title) setTitle(selected.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '))
  }
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { selectFile(event.target.files?.[0]); event.target.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]) }
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!file) { setError('Add an incident video to continue.'); return } onCreate(title.trim() || file.name, site.trim() || 'Site not specified', file) }
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
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={dialogRef} className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-heading"><div className="dialog-heading"><div><span className="section-kicker">NEW INVESTIGATION</span><h2 id="upload-heading">Add incident footage</h2><p>Start a local demo case from an existing video clip.</p></div><IconButton label="Close dialog" onClick={onClose}><X size={17} /></IconButton></div><form onSubmit={submit}>
      <div className={`dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" onChange={onFileChange} aria-label="Select incident video" /><div className="upload-symbol">{file ? <CheckCircle2 size={22} /> : <Upload size={22} />}</div>{file ? <><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB · selected locally</span><button type="button" className="replace-file" onClick={() => fileInput.current?.click()}>Replace video</button></> : <><strong>Drop a video file here</strong><span>MP4, MOV, or WebM · stored in this browser session</span><button type="button" className="button button-outline browse-button" onClick={() => fileInput.current?.click()}>Browse files</button></>}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-field-grid"><label>Case name<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Westbridge intersection" /></label><label>Location<input value={site} onChange={(event) => setSite(event.target.value)} placeholder="Road, junction, or facility" /></label></div>
      <div className="local-storage-note"><HardDrive size={15} /><span>In this demo, the video stays on your device. It is not uploaded or analyzed by a server.</span></div>
      <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Plus size={15} />Create case</button></div>
    </form></div></div>
  )
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
  const [expandedScene, setExpandedScene] = useState<'source' | 'twin' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentCase = cases.find((item) => item.id === activeCaseId) ?? cases[0] ?? initialCases[0]
  const title = page === 'cases' ? 'Case files' : page === 'counterfactual' ? 'Counterfactuals' : page === 'findings' ? 'Findings' : 'Reconstruction'

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
    const twinExpand = () => setExpandedScene('twin')
    window.addEventListener('blackbox-source-expand', sourceExpand)
    window.addEventListener('blackbox-twin-expand', twinExpand)
    return () => { window.removeEventListener('blackbox-source-expand', sourceExpand); window.removeEventListener('blackbox-twin-expand', twinExpand) }
  }, [])

  const toast = (message: string) => setToastMessage(message)
  const closeToast = () => setToastMessage('')
  const openNewCase = () => setModalOpen(true)
  const createCase = (caseTitle: string, site: string, file: File) => {
    const nextCase: IncidentCase = { id: `BB-${Math.floor(1000 + Math.random() * 8999)}`, title: caseTitle, site, date: new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()), category: 'Video incident', status: 'Draft', videoName: file.name, videoUrl: URL.createObjectURL(file) }
    setCases((existing) => [nextCase, ...existing]); setActiveCaseId(nextCase.id); setPage('reconstruction'); setTime(0); setDuration(10.4); setIsPlaying(false); setGridVisible(false); setModalOpen(false); toast('Case created. Your local video is ready to review.')
  }
  const selectCase = (item: IncidentCase) => { setActiveCaseId(item.id); setPage('reconstruction'); setTime(0); setIsPlaying(false); setGridVisible(false); setDuration(10.4) }
  const updateTime = (next: number) => { const safe = Math.max(0, Math.min(next, duration)); setTime(safe); if (videoRef.current && currentCase.videoUrl) videoRef.current.currentTime = safe }
  const togglePlay = () => { if (time >= duration) updateTime(0); setIsPlaying((playing) => !playing) }
  const stepFrame = (direction: number) => { setIsPlaying(false); updateTime(time + direction / 30) }
  const handleShare = async () => { try { await navigator.clipboard.writeText(window.location.href); toast('Workspace link copied.') } catch { toast('Share links are available when cloud workspaces are connected.') } }
  const exportSummary = () => {
    const lines = ['BLACKBOX DEMONSTRATION CASE SUMMARY', `Case,${currentCase.id}`, `Incident,${currentCase.title}`, `Location,${currentCase.site}`, 'Data status,Illustrative only; not a calibrated forensic reconstruction', 'Vehicle A entry speed,42 mph (illustrative)', 'Braking onset,04.62 s (illustrative)', 'Impact marker,05.20 s (illustrative)', 'Reference mean residual,0.18 m (illustrative)', 'Assumptions,Level ground; dry asphalt; passenger vehicle class']
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${currentCase.id}-demonstration-summary.csv`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); toast('Demonstration summary exported.')
  }
  const handleLoadedMetadata = (nextDuration: number) => { if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration) }
  const handleVideoTime = (nextTime: number) => setTime(nextTime)

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Sidebar page={page} cases={cases} activeCaseId={activeCaseId} onNavigate={setPage} onSelectCase={selectCase} onNewCase={openNewCase} onHelp={() => toast('Help: upload a clip, review calibration, then adjust scenario inputs.')} />
      <div className="app-main"><Topbar title={title} onNewCase={openNewCase} onShare={handleShare} onExport={exportSummary} onSearch={() => setPage('cases')} onNotifications={() => toast('You are up to date.')} /><main id="main-content" className="page-content"><CaseHeader currentCase={currentCase} page={page} onNavigate={setPage} />{page === 'reconstruction' && <Workbench currentCase={currentCase} time={time} duration={duration} isPlaying={isPlaying} gridVisible={gridVisible} tracksVisible={tracksVisible} onGridToggle={() => setGridVisible(!gridVisible)} onTracksToggle={() => setTracksVisible(!tracksVisible)} onPlay={togglePlay} onTimeChange={updateTime} onStep={stepFrame} videoRef={videoRef} onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={handleVideoTime} onNavigate={setPage} />}{page === 'cases' && <CaseFiles cases={cases} onSelect={selectCase} onNewCase={openNewCase} />}{page === 'counterfactual' && <CounterfactualStudio time={time} duration={duration} isPlaying={isPlaying} onPlay={togglePlay} onTimeChange={updateTime} onStep={stepFrame} />}{page === 'findings' && <Findings onExport={exportSummary} onNavigate={setPage} />}</main><footer className="app-footer"><span>BLACKBOX <i /> Forensic reconstruction workspace</span><span><span className="footer-lock"><HardDrive size={12} /></span>Local demo environment <span className="footer-version">v0.1.0</span></span></footer></div>
      {modalOpen && <UploadDialog onClose={() => setModalOpen(false)} onCreate={createCase} />}
      {expandedScene && <div className="modal-backdrop scene-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedScene(null) }}><div className="scene-modal" role="dialog" aria-modal="true" aria-label={expandedScene === 'source' ? 'Expanded source video' : 'Expanded digital twin'}><div className="scene-modal-header"><div><span className="section-kicker">{expandedScene === 'source' ? 'SOURCE EVIDENCE' : 'RECONSTRUCTED SCENE'}</span><strong>{expandedScene === 'source' ? 'Camera 04 · Northbound' : 'Digital twin · metric ground plane'}</strong></div><IconButton label="Close expanded view" onClick={() => setExpandedScene(null)}><X size={17} /></IconButton></div>{expandedScene === 'source' ? currentCase.videoUrl ? <video className="expanded-video" src={currentCase.videoUrl} muted controls playsInline /> : <div className="expanded-svg"><EvidenceScene time={time} gridVisible={gridVisible} tracksVisible={tracksVisible} /></div> : <div className="expanded-svg expanded-twin"><DigitalTwinScene time={time} /></div>}<div className="scene-modal-foot"><span><Crosshair size={14} />Synchronized at {formatTime(time)}</span><button type="button" className="button button-quiet" onClick={() => setExpandedScene(null)}>Close view</button></div></div></div>}
      <Toast message={toastMessage} onClose={closeToast} />
    </div>
  )
}

export default App
