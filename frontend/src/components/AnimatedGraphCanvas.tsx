import {
  Maximize2,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AccessPath, GraphNode, GraphResponse } from "../types";
import { shortName } from "./Common";
import { ProvenanceBadge } from "./ProvenanceBadge";

interface CategoryStyle {
  label: string;
  color: string;
}

const DEFAULT_STYLE: CategoryStyle = { label: "Entity", color: "#a1a7b3" };

const TYPE_STYLES: Record<string, CategoryStyle> = {
  AIAgent: { label: "AI agent", color: "#38bdf8" },
  Task: { label: "Task", color: "#60a5fa" },
  Tool: { label: "Tool", color: "#2dd4bf" },
  Role: { label: "Role", color: "#2dd4bf" },
  ReadPermission: { label: "Permission", color: "#f59e0b" },
  WritePermission: { label: "Permission", color: "#f59e0b" },
  SendPermission: { label: "Permission", color: "#f59e0b" },
  AdminPermission: { label: "Admin perm", color: "#fb923c" },
  Database: { label: "Resource", color: "#818cf8" },
  FileStore: { label: "Resource", color: "#818cf8" },
  Mailbox: { label: "Resource", color: "#818cf8" },
  WebContent: { label: "Resource", color: "#818cf8" },
  PersonalDataCategory: { label: "Sensitive data", color: "#f43f5e" },
  AcademicDataCategory: { label: "Sensitive data", color: "#f43f5e" },
  FinancialDataCategory: { label: "Sensitive data", color: "#f43f5e" },
  HealthDataCategory: { label: "Sensitive data", color: "#f43f5e" },
  CommunicationDataCategory: { label: "Sensitive data", color: "#f43f5e" },
  SecurityPolicy: { label: "Policy", color: "#a78bfa" },
  SecurityControl: { label: "Control", color: "#a1a7b3" },
  HumanUser: { label: "Supervisor", color: "#34d399" },
};

const LEGEND_ITEMS = [
  { label: "AI agent", color: "#38bdf8" },
  { label: "Tool / Role", color: "#2dd4bf" },
  { label: "Permission", color: "#f59e0b" },
  { label: "Resource", color: "#818cf8" },
  { label: "Sensitive data", color: "#f43f5e" },
  { label: "Policy", color: "#a78bfa" },
  { label: "Supervisor", color: "#34d399" },
];

export function styleForNode(node?: GraphNode | null, fallbackId?: string): CategoryStyle {
  if (node?.type && TYPE_STYLES[node.type]) return TYPE_STYLES[node.type];
  if (fallbackId) {
    if (fallbackId.startsWith("agent:")) return TYPE_STYLES.AIAgent;
    if (fallbackId.startsWith("tool:") || fallbackId.startsWith("role:")) return TYPE_STYLES.Tool;
    if (fallbackId.startsWith("perm:")) return TYPE_STYLES.ReadPermission;
    if (fallbackId.startsWith("resource:")) return TYPE_STYLES.Database;
    if (fallbackId.startsWith("category:")) return TYPE_STYLES.PersonalDataCategory;
    if (fallbackId.startsWith("policy:")) return TYPE_STYLES.SecurityPolicy;
    if (fallbackId.startsWith("user:")) return TYPE_STYLES.HumanUser;
    if (fallbackId.startsWith("task:")) return TYPE_STYLES.Task;
  }
  return DEFAULT_STYLE;
}

export function humanPredicate(pred: string): string {
  const local = shortName(pred);
  const map: Record<string, string> = {
    usesTool: "uses tool",
    hasRole: "has role",
    hasPermission: "grants",
    accessesResource: "accesses",
    containsSensitiveData: "contains",
    assignedTask: "assigned task",
    requiresPermission: "requires",
    governedByPolicy: "governed by",
    implementsControl: "implements",
    supervisedBy: "supervised by",
    prohibitsPermission: "prohibits",
  };
  return map[local] ?? local;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Projected {
  sx: number;
  sy: number;
  z: number;
  scale: number;
  depthAlpha: number;
}

function project3D(
  p: Vec3,
  yaw: number,
  pitch: number,
  zoom: number,
  cx: number,
  cy: number,
  panX: number,
  panY: number
): Projected {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  // Rotate around Y (yaw)
  const x1 = p.x * cosY - p.z * sinY;
  const z1 = p.x * sinY + p.z * cosY;

  // Rotate around X (pitch)
  const y2 = p.y * cosP - z1 * sinP;
  const z2 = p.y * sinP + z1 * cosP;

  const fov = 780;
  const camDist = 780 / zoom;
  const denom = Math.max(150, camDist + z2);
  const scale = fov / denom;
  const depthAlpha = Math.max(0.62, Math.min(1, (440 - z2) / 620));

  return {
    sx: cx + panX + x1 * scale,
    sy: cy + panY + y2 * scale,
    z: z2,
    scale,
    depthAlpha,
  };
}

interface Node3D {
  id: string;
  pos: Vec3;
  index: number;
  depth: number;
  node?: GraphNode;
  style: CategoryStyle;
}

interface Edge3D {
  id: string;
  source: string;
  target: string;
  from: Vec3;
  to: Vec3;
  predicate: string;
  stageIndex: number;
  color: string;
}

/**
 * Generates evenly distributed 3D points on a sphere of radius `r` using the golden-angle spiral.
 */
function fibonacciSphere(count: number, r: number, phaseOffset: number): Vec3[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: r, y: 0, z: 0 }];
  const pts: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    // Keep polar band slightly compressed so nodes stay readable in 16:9 viewport
    const yNorm = 1 - (i / Math.max(1, count - 1)) * 2;
    const y = yNorm * 0.78;
    const radAtY = Math.sqrt(Math.max(0.08, 1 - y * y));
    const theta = golden * i + phaseOffset;
    pts.push({
      x: Math.cos(theta) * radAtY * r * 1.16,
      y: y * r * 0.84,
      z: Math.sin(theta) * radAtY * r,
    });
  }
  return pts;
}

export function AnimatedGraphCanvas({
  graphData,
  activePath,
  viewMode,
  onViewModeChange,
}: {
  graphData: GraphResponse;
  activePath: AccessPath | null;
  viewMode: "path" | "wave";
  onViewModeChange: (m: "path" | "wave") => void;
}) {
  const [speed, setSpeed] = useState<number>(1);
  const [hopLimit, setHopLimit] = useState<1 | 2 | 3>(2);
  const [playing, setPlaying] = useState(true);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [replaySeed, setReplaySeed] = useState(0);
  const [stage, setStage] = useState(0);
  const [settled, setSettled] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [waveOrigin, setWaveOrigin] = useState<string | null>(null);

  // 3D Orbit Camera State (stays still until user drags it)
  const [cam, setCam] = useState({ yaw: 0, pitch: 0.08, zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef({
    active: false,
    mode: "orbit" as "orbit" | "pan",
    startX: 0,
    startY: 0,
    origYaw: 0,
    origPitch: 0,
    origPanX: 0,
    origPanY: 0,
    velYaw: 0,
    velPitch: 0,
    moved: false,
  });

  const nodeLookup = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graphData.nodes) map.set(n.id, n);
    return map;
  }, [graphData]);

  // Mode 1: 3D Sweeping Access Path Layout
  const chain3D = useMemo(() => {
    if (!activePath || activePath.triples.length === 0) {
      return { nodes: [] as Node3D[], edges: [] as Edge3D[] };
    }
    const seqIds = [activePath.triples[0].triple[0], ...activePath.triples.map((f) => f.triple[2])];
    const count = seqIds.length;
    const spanX = Math.min(760, Math.max(460, (count - 1) * 195));

    const nodes: Node3D[] = seqIds.map((id, i) => {
      const gn = nodeLookup.get(id);
      const t = count > 1 ? i / (count - 1) : 0.5;
      const x = (t - 0.5) * spanX;
      // Clean readable 3D arc — legible head-on and smoothly rotatable in 3D
      const y = count >= 3 ? (i % 2 === 0 ? -30 : 30) : 0;
      const z = Math.sin(t * Math.PI) * 65;
      return {
        id,
        pos: { x, y, z },
        index: i,
        depth: i,
        node: gn,
        style: styleForNode(gn, id),
      };
    });

    const edges: Edge3D[] = activePath.triples.map((f, i) => {
      const isRisk = activePath.excessive_exposure && i >= activePath.triples.length - 2;
      return {
        id: `${f.triple[0]}|${f.triple[1]}|${f.triple[2]}|${i}`,
        source: f.triple[0],
        target: f.triple[2],
        from: nodes[i].pos,
        to: nodes[i + 1].pos,
        predicate: humanPredicate(f.triple[1]),
        stageIndex: i * 2 + 1,
        color: isRisk ? "#f43f5e" : nodes[i + 1].style.color,
      };
    });

    return { nodes, edges };
  }, [activePath, nodeLookup]);

  // Mode 2: 3D Spherical BFS Hop Wave Layout
  const effectiveOrigin = waveOrigin ?? activePath?.agent ?? graphData.nodes[0]?.id ?? "";

  const wave3D = useMemo(() => {
    if (!effectiveOrigin || !nodeLookup.has(effectiveOrigin)) {
      return { nodes: [] as Node3D[], edges: [] as Edge3D[], maxDepth: 0 };
    }

    const adj = new Map<string, string[]>();
    graphData.edges.forEach((e) => {
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    });

    const depthMap = new Map<string, number>([[effectiveOrigin, 0]]);
    const queue: string[] = [effectiveOrigin];
    const MAX_NODES = 46;

    while (queue.length > 0 && depthMap.size < MAX_NODES) {
      const cur = queue.shift()!;
      const d = depthMap.get(cur)!;
      if (d >= hopLimit) continue;
      for (const neighbor of adj.get(cur) ?? []) {
        if (!depthMap.has(neighbor) && depthMap.size < MAX_NODES) {
          depthMap.set(neighbor, d + 1);
          queue.push(neighbor);
        }
      }
    }

    const byDepth = new Map<number, string[]>();
    for (const [id, d] of depthMap.entries()) {
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(id);
    }

    const radii = [0, 148, 255, 345];
    const posMap = new Map<string, Vec3>();
    const waveNodes: Node3D[] = [];
    let maxDepth = 0;

    for (const [d, ids] of Array.from(byDepth.entries()).sort((a, b) => a[0] - b[0])) {
      maxDepth = Math.max(maxDepth, d);
      if (d === 0) {
        const pos = { x: 0, y: 0, z: 0 };
        posMap.set(ids[0], pos);
        const gn = nodeLookup.get(ids[0]);
        waveNodes.push({ id: ids[0], pos, index: 0, depth: 0, node: gn, style: styleForNode(gn, ids[0]) });
      } else {
        const pts = fibonacciSphere(ids.length, radii[d] ?? 316, d * 1.1);
        ids.forEach((id, idx) => {
          const pos = pts[idx];
          posMap.set(id, pos);
          const gn = nodeLookup.get(id);
          waveNodes.push({ id, pos, index: idx, depth: d, node: gn, style: styleForNode(gn, id) });
        });
      }
    }

    const waveEdges: Edge3D[] = [];
    graphData.edges.forEach((e, idx) => {
      const p1 = posMap.get(e.source);
      const p2 = posMap.get(e.target);
      if (!p1 || !p2) return;
      const d1 = depthMap.get(e.source) ?? 0;
      const d2 = depthMap.get(e.target) ?? 0;
      const outward = d1 <= d2;
      const from = outward ? p1 : p2;
      const to = outward ? p2 : p1;
      const childId = outward ? e.target : e.source;
      const childStyle = styleForNode(nodeLookup.get(childId), childId);
      waveEdges.push({
        id: `${e.source}-${e.predicate}-${e.target}-${idx}`,
        source: e.source,
        target: e.target,
        from,
        to,
        predicate: humanPredicate(e.predicate),
        stageIndex: Math.max(1, Math.max(d1, d2) * 2 - 1),
        color: childStyle.color,
      });
    });

    return { nodes: waveNodes, edges: waveEdges, maxDepth };
  }, [graphData, effectiveOrigin, hopLimit, nodeLookup]);

  const maxStage =
    viewMode === "path"
      ? Math.max(0, chain3D.nodes.length * 2 - 2)
      : Math.max(0, wave3D.maxDepth * 2);

  // Reset camera framing neatly when switching between Access Path (3D) and Full KG Sphere (3D)
  useEffect(() => {
    setStage(0);
    setSettled(false);
    setPlaying(true);
    setCam(
      viewMode === "path"
        ? { yaw: 0, pitch: 0.08, zoom: 1.0, panX: 0, panY: 0 }
        : { yaw: 0.16, pitch: 0.18, zoom: 0.92, panX: 0, panY: 0 }
    );
  }, [activePath?.path_id, viewMode, waveOrigin, hopLimit, replaySeed]);

  // Sequential Node -> Edge -> Next Node playback timer
  useEffect(() => {
    if (!playing || stage >= maxStage) return;
    const baseMs = stage % 2 === 0 ? 430 : 470;
    const delay = Math.max(180, Math.round(baseMs / speed));
    const timer = window.setTimeout(() => {
      setStage((s) => Math.min(maxStage, s + 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, stage, maxStage, speed]);

  // Mark spawn animations settled shortly after final hop so 3D rotation never restarts animations
  useEffect(() => {
    if (stage < maxStage) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), 520);
    return () => window.clearTimeout(timer);
  }, [stage, maxStage]);

  // Optional 3D Auto-Orbit (OFF by default — graph stays completely still unless user drags or toggles it on)
  useEffect(() => {
    if (!autoOrbit) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!dragRef.current.active && hoveredNodeId === null) {
        const autoSpeed = viewMode === "wave" ? 0.2 : 0.09;
        setCam((prev) => ({ ...prev, yaw: prev.yaw + autoSpeed * dt }));
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [autoOrbit, hoveredNodeId, viewMode]);

  const triggerReplay = () => setReplaySeed((n) => n + 1);
  const stepForward = () => {
    setPlaying(false);
    setSettled(false);
    setStage((s) => (s >= maxStage ? 0 : s + 1));
  };
  const resetCamera = () => {
    setCam(
      viewMode === "path"
        ? { yaw: 0, pitch: 0.08, zoom: 1.0, panX: 0, panY: 0 }
        : { yaw: 0.16, pitch: 0.18, zoom: 0.92, panX: 0, panY: 0 }
    );
  };

  // Pointer & Wheel 3D Orbit / Shift-Pan / Zoom handlers
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      mode: e.shiftKey || e.button === 2 ? "pan" : "orbit",
      startX: e.clientX,
      startY: e.clientY,
      origYaw: cam.yaw,
      origPitch: cam.pitch,
      origPanX: cam.panX,
      origPanY: cam.panY,
      velYaw: 0,
      velPitch: 0,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;

    if (drag.mode === "pan") {
      setCam((prev) => ({ ...prev, panX: drag.origPanX + dx, panY: drag.origPanY + dy }));
    } else {
      const targetYaw = drag.origYaw + dx * 0.0065;
      const targetPitch = Math.max(-1.2, Math.min(1.2, drag.origPitch + dy * 0.0055));
      setCam((prev) => ({ ...prev, yaw: targetYaw, pitch: targetPitch }));
    }
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    setCam((prev) => ({
      ...prev,
      zoom: Math.max(0.55, Math.min(2.1, +(prev.zoom * factor).toFixed(3))),
    }));
  };

  const selectedNode = selectedNodeId ? nodeLookup.get(selectedNodeId) ?? null : null;
  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return graphData.edges.filter((e) => e.source === selectedNodeId || e.target === selectedNodeId);
  }, [graphData, selectedNodeId]);

  // Project active scene (Mode 1 or Mode 2) to 2D SVG with True Depth Sorting
  const W = 1120;
  const H = viewMode === "path" ? 410 : 520;
  const CX = W / 2;
  const CY = H / 2;

  const activeNodes = viewMode === "path" ? chain3D.nodes : wave3D.nodes;
  const activeEdges = viewMode === "path" ? chain3D.edges : wave3D.edges;

  const projectedNodes = activeNodes
    .filter((n) => stage >= n.depth * 2)
    .map((n) => ({
      ...n,
      p: project3D(n.pos, cam.yaw, cam.pitch, cam.zoom, CX, CY, cam.panX, cam.panY),
    }))
    .sort((a, b) => b.p.z - a.p.z); // Painter's algorithm: far -> near

  const projectedEdges = activeEdges
    .filter((e) => stage >= e.stageIndex)
    .map((e) => {
      const p1 = project3D(e.from, cam.yaw, cam.pitch, cam.zoom, CX, CY, cam.panX, cam.panY);
      const p2 = project3D(e.to, cam.yaw, cam.pitch, cam.zoom, CX, CY, cam.panX, cam.panY);
      return { ...e, p1, p2, midZ: (p1.z + p2.z) / 2 };
    })
    .sort((a, b) => b.midZ - a.midZ);

  // Build projected 3D orbital rings (equator + tilted meridian) for Full KG 3D Sphere
  const orbitalRings = useMemo(() => {
    if (viewMode !== "wave") return [];
    const radii = [148, 255, 345].slice(0, hopLimit);
    const segs = 44;
    return radii.map((r, rIdx) => {
      const eqPts: string[] = [];
      const merPts: string[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const pEq = project3D(
          { x: Math.cos(a) * r * 1.16, y: 0, z: Math.sin(a) * r },
          cam.yaw,
          cam.pitch,
          cam.zoom,
          CX,
          CY,
          cam.panX,
          cam.panY
        );
        eqPts.push(`${i === 0 ? "M" : "L"} ${pEq.sx.toFixed(1)} ${pEq.sy.toFixed(1)}`);

        const pMer = project3D(
          { x: Math.cos(a) * r * 1.16, y: Math.sin(a) * r * 0.84, z: 0 },
          cam.yaw,
          cam.pitch,
          cam.zoom,
          CX,
          CY,
          cam.panX,
          cam.panY
        );
        merPts.push(`${i === 0 ? "M" : "L"} ${pMer.sx.toFixed(1)} ${pMer.sy.toFixed(1)}`);
      }
      const labelPos = project3D(
        { x: r * 1.16, y: 0, z: 0 },
        cam.yaw,
        cam.pitch,
        cam.zoom,
        CX,
        CY,
        cam.panX,
        cam.panY
      );
      return { r, rIdx, eqD: eqPts.join(" "), merD: merPts.join(" "), labelPos };
    });
  }, [viewMode, hopLimit, cam, CX, CY]);

  const yawDeg = Math.round((((cam.yaw * 180) / Math.PI) % 360 + 360) % 360);
  const pitchDeg = Math.round((cam.pitch * 180) / Math.PI);

  return (
    <div className="surface-card rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0f2f5]/[0.08] bg-[#11141b] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onViewModeChange("path")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ${
                viewMode === "path" ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
              }`}
            >
              3D access path
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("wave")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ${
                viewMode === "wave" ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
              }`}
            >
              3D KG hop sphere ({wave3D.nodes.length})
            </button>
          </div>

          {viewMode === "wave" && (
            <div className="inline-flex h-8 items-center rounded-lg border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-0.5 font-mono text-[11px]">
              {([1, 2, 3] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHopLimit(h)}
                  className={`rounded px-2 py-1 transition-colors duration-150 ${
                    hopLimit === h ? "surface-active text-[#38bdf8]" : "text-[#737a87] hover:text-[#f0f2f5]"
                  }`}
                >
                  {h} {h === 1 ? "hop" : "hops"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (stage >= maxStage ? triggerReplay() : setPlaying((p) => !p))}
            className="btn-press inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-3 text-xs font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white"
          >
            {playing && stage < maxStage ? (
              <>
                <Pause size={13} strokeWidth={1.75} />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play size={13} strokeWidth={1.75} />
                <span>{stage >= maxStage ? "Play again" : "Play"}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={stepForward}
            className="btn-press surface-raised inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#f0f2f5] transition-colors duration-150 hover:bg-[#252a36]"
          >
            <StepForward size={13} strokeWidth={1.5} />
            <span>Step</span>
          </button>

          <button
            type="button"
            onClick={triggerReplay}
            className="btn-press surface-raised inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#f0f2f5] transition-colors duration-150 hover:bg-[#252a36]"
          >
            <RotateCcw size={13} strokeWidth={1.5} />
            <span>Replay</span>
          </button>

          <button
            type="button"
            onClick={() => setAutoOrbit((o) => !o)}
            title="Toggle slow 3D auto-orbit"
            className={`btn-press inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors duration-150 ${
              autoOrbit
                ? "border-[#38bdf8]/40 bg-[#38bdf8]/12 text-[#38bdf8]"
                : "border-[#f0f2f5]/[0.09] bg-[#161920] text-[#737a87] hover:text-[#f0f2f5]"
            }`}
          >
            <Orbit size={13} strokeWidth={1.5} />
            <span>3D orbit</span>
          </button>

          <div className="inline-flex h-8 items-center rounded-lg border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-0.5 font-mono text-[11px]">
            {[0.75, 1, 1.5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`rounded px-2 py-1 transition-colors duration-150 ${
                  speed === s ? "bg-[#1e222b] text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="hidden sm:flex items-center gap-1 pl-1">
            <button
              type="button"
              onClick={() => setCam((c) => ({ ...c, zoom: Math.min(2.1, +(c.zoom * 1.15).toFixed(2)) }))}
              aria-label="Zoom in"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#f0f2f5]/[0.08] bg-[#161920] text-[#737a87] hover:text-[#f0f2f5]"
            >
              <ZoomIn size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => setCam((c) => ({ ...c, zoom: Math.max(0.55, +(c.zoom * 0.86).toFixed(2)) }))}
              aria-label="Zoom out"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#f0f2f5]/[0.08] bg-[#161920] text-[#737a87] hover:text-[#f0f2f5]"
            >
              <ZoomOut size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={resetCamera}
              aria-label="Reset 3D camera"
              title="Reset 3D camera"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#f0f2f5]/[0.08] bg-[#161920] text-[#737a87] hover:text-[#f0f2f5]"
            >
              <Maximize2 size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {/* Interactive 3D SVG Stage + Node Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div
          className={`relative graph-stage select-none overflow-hidden ${
            selectedNode ? "lg:col-span-9" : "lg:col-span-12"
          }`}
        >
          {/* Top-left Hop Status */}
          <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-3 font-mono text-[11px] text-[#737a87] tabular-nums">
            {viewMode === "path" && activePath && (
              <>
                <span>
                  3D Hop {Math.min(chain3D.nodes.length, Math.floor(stage / 2) + 1)} / {chain3D.nodes.length}
                </span>
                {activePath.excessive_exposure && stage >= maxStage && (
                  <span className="anim-verdict inline-flex items-center gap-1.5 text-[#f43f5e]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#f43f5e]" />
                    Excessive exposure
                  </span>
                )}
              </>
            )}
            {viewMode === "wave" && (
              <span>
                3D Wave {Math.min(wave3D.maxDepth, Math.floor(stage / 2))} / {wave3D.maxDepth} · Origin{" "}
                <span className="text-[#f0f2f5]">{shortName(effectiveOrigin)}</span>
              </span>
            )}
          </div>

          {/* Top-right Live 3D Camera Angle HUD */}
          <div className="pointer-events-none absolute right-4 top-3 z-10 hidden sm:flex items-center gap-2 font-mono text-[11px] text-[#737a87] tabular-nums">
            <span>yaw {yawDeg}°</span>
            <span>·</span>
            <span>pitch {pitchDeg}°</span>
            <span>·</span>
            <span>{Math.round(cam.zoom * 100)}%</span>
          </div>

          <svg
            key={`${viewMode}-${activePath?.path_id ?? "none"}-${waveOrigin ?? "def"}-${hopLimit}-${replaySeed}`}
            viewBox={`0 0 ${W} ${H}`}
            className={`w-full touch-none cursor-grab active:cursor-grabbing ${
              viewMode === "path" ? "h-[410px]" : "h-[520px]"
            }`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
          >
            <defs>
              {["#38bdf8", "#2dd4bf", "#f59e0b", "#818cf8", "#f43f5e", "#a78bfa", "#34d399", "#a1a7b3"].map(
                (col) => (
                  <marker
                    key={col}
                    id={`arrow3d-${col.slice(1)}`}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill={col} />
                  </marker>
                )
              )}
            </defs>

            {/* 3D Orbital Latitude & Meridian Guide Rings (Wave Mode) */}
            {viewMode === "wave" &&
              orbitalRings.map((ring) => (
                <g key={ring.r}>
                  <path
                    d={ring.eqD}
                    fill="none"
                    stroke="#38bdf8"
                    strokeOpacity={stage >= (ring.rIdx + 1) * 2 - 1 ? 0.12 : 0.03}
                    strokeDasharray="3 6"
                    strokeWidth={1}
                  />
                  <path
                    d={ring.merD}
                    fill="none"
                    stroke="#f0f2f5"
                    strokeOpacity={stage >= (ring.rIdx + 1) * 2 - 1 ? 0.05 : 0.015}
                    strokeDasharray="2 7"
                    strokeWidth={0.9}
                  />
                  <text
                    x={ring.labelPos.sx + 7}
                    y={ring.labelPos.sy + 3}
                    fill="#737a87"
                    fillOpacity={0.55}
                    fontSize={9}
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    h{ring.rIdx + 1}
                  </text>
                </g>
              ))}

            {/* 3D Depth-Sorted Edges */}
            {projectedEdges.map((e) => {
              const isHoverIncident =
                hoveredNodeId !== null && (e.source === hoveredNodeId || e.target === hoveredNodeId);
              const dimmed = hoveredNodeId !== null && !isHoverIncident;
              const avgAlpha = (e.p1.depthAlpha + e.p2.depthAlpha) / 2;

              if (viewMode === "path") {
                const dx = e.p2.sx - e.p1.sx;
                const dy = e.p2.sy - e.p1.sy;
                const dist = Math.max(1, Math.hypot(dx, dy));
                const ux = dx / dist;
                const uy = dy / dist;
                const startOffset = Math.min(dist * 0.35, 62 * e.p1.scale);
                const endOffset = Math.min(dist * 0.35, 68 * e.p2.scale);
                const sx = e.p1.sx + ux * startOffset;
                const sy = e.p1.sy + uy * startOffset;
                const tx = e.p2.sx - ux * endOffset;
                const ty = e.p2.sy - uy * endOffset;
                const mx = (sx + tx) / 2;
                const my = (sy + ty) / 2;
                const cx1 = sx + (tx - sx) * 0.45;
                const cx2 = sx + (tx - sx) * 0.55;
                const pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${cx1.toFixed(1)} ${sy.toFixed(1)}, ${cx2.toFixed(1)} ${ty.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`;
                const arrowId = `arrow3d-${e.color.slice(1)}`;
                const pillScale = Math.max(0.75, Math.min(1.15, (e.p1.scale + e.p2.scale) / 2));

                const isFreshEdge = !settled && e.stageIndex === stage;

                return (
                  <g key={e.id} opacity={avgAlpha}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={e.color}
                      strokeWidth={2.2 * pillScale}
                      strokeLinecap="round"
                      pathLength={isFreshEdge ? 100 : undefined}
                      markerEnd={`url(#${arrowId})`}
                      className={isFreshEdge ? "anim-edge-draw" : undefined}
                    />
                    <g transform={`translate(${mx.toFixed(1)}, ${(my - 18 * pillScale).toFixed(1)}) scale(${pillScale.toFixed(3)})`}>
                      <g className={isFreshEdge ? "anim-label-reveal" : undefined}>
                        <rect
                          x={-(e.predicate.length * 3.6 + 10)}
                          y={-11}
                          width={e.predicate.length * 7.2 + 20}
                          height={22}
                          rx={6}
                          fill="#161920"
                          stroke={e.color}
                          strokeOpacity={0.5}
                          strokeWidth={1}
                        />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#f0f2f5"
                          fontSize={11}
                          fontFamily="IBM Plex Mono, monospace"
                        >
                          {e.predicate}
                        </text>
                      </g>
                    </g>
                  </g>
                );
              }

              // Full KG 3D Sphere Edge
              const isFreshWaveEdge = !settled && e.stageIndex === stage;
              const pathD = `M ${e.p1.sx.toFixed(1)} ${e.p1.sy.toFixed(1)} L ${e.p2.sx.toFixed(1)} ${e.p2.sy.toFixed(1)}`;
              const mx = (e.p1.sx + e.p2.sx) / 2;
              const my = (e.p1.sy + e.p2.sy) / 2;

              return (
                <g key={e.id}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isHoverIncident ? "#f0f2f5" : e.color}
                    strokeWidth={isHoverIncident ? 2.4 : Math.max(1.1, 1.65 * avgAlpha)}
                    strokeOpacity={dimmed ? 0.12 : isHoverIncident ? 0.95 : avgAlpha * 0.58}
                    strokeLinecap="round"
                    pathLength={isFreshWaveEdge ? 100 : undefined}
                    className={isFreshWaveEdge ? "anim-edge-draw" : undefined}
                  />
                  {isHoverIncident && (
                    <g transform={`translate(${mx.toFixed(1)}, ${my.toFixed(1)})`}>
                      <rect
                        x={-(e.predicate.length * 3.1 + 7)}
                        y={-9}
                        width={e.predicate.length * 6.2 + 14}
                        height={18}
                        rx={4}
                        fill="#090b0f"
                        stroke="#f0f2f5"
                        strokeOpacity={0.25}
                        strokeWidth={0.8}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#f0f2f5"
                        fontSize={9.5}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {e.predicate}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* 3D Depth-Sorted Nodes (Far -> Near) */}
            {projectedNodes.map((n) => {
              const isSelected = selectedNodeId === n.id;
              const isHovered = hoveredNodeId === n.id;
              const labelText = shortName(n.id);

              if (viewMode === "path") {
                const isLastRisk =
                  activePath?.excessive_exposure && n.index === chain3D.nodes.length - 1;
                const displayLabel = labelText.length > 17 ? `${labelText.slice(0, 16)}…` : labelText;
                const s = Math.max(0.7, Math.min(1.25, n.p.scale));

                const isFreshNode = !settled && n.depth * 2 === stage;

                return (
                  <g
                    key={`${n.id}-${n.index}`}
                    transform={`translate(${n.p.sx.toFixed(1)}, ${n.p.sy.toFixed(1)}) scale(${s.toFixed(3)})`}
                    opacity={Math.max(0.75, n.p.depthAlpha)}
                    className="cursor-pointer"
                    onClick={() => {
                      if (!dragRef.current.moved) setSelectedNodeId(n.id);
                    }}
                    onMouseEnter={() => setHoveredNodeId(n.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    <g className={isFreshNode ? "anim-node-spawn" : undefined}>
                      <rect
                        x={-68}
                        y={-32}
                        width={136}
                        height={64}
                        rx={12}
                        fill="#161920"
                        stroke={n.style.color}
                        strokeOpacity={isSelected || isHovered || isLastRisk ? 1 : 0.7}
                        strokeWidth={isSelected || isHovered || isLastRisk ? 2.2 : 1.5}
                      />
                      <rect
                        x={-68}
                        y={-32}
                        width={136}
                        height={3.5}
                        rx={1.75}
                        fill={n.style.color}
                        fillOpacity={0.9}
                      />
                      <circle cx={-52} cy={-11} r={3.5} fill={n.style.color} />
                      <text
                        x={-43}
                        y={-11}
                        dominantBaseline="central"
                        fill="#a1a7b3"
                        fontSize={10.5}
                        fontFamily="IBM Plex Sans, sans-serif"
                      >
                        {n.style.label}
                      </text>
                      <text
                        x={56}
                        y={-11}
                        textAnchor="end"
                        dominantBaseline="central"
                        fill="#737a87"
                        fontSize={10}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        0{n.index + 1}
                      </text>
                      <text
                        x={0}
                        y={12}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#f0f2f5"
                        fontSize={12.5}
                        fontWeight={500}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {displayLabel}
                      </text>
                    </g>
                  </g>
                );
              }

              // Full KG 3D Sphere Node — crisp dark label pill so every name stays 100% readable (zero blinking)
              const isCenter = n.depth === 0;
              const isFreshWaveNode = !settled && n.depth * 2 === stage;
              const baseR = isCenter ? 19 : n.depth === 1 ? 13 : 10;
              const r = Math.max(7, baseR * n.p.scale);
              const shortLabel = labelText.length > 18 ? `${labelText.slice(0, 17)}…` : labelText;
              const fontSize = Math.max(10, (isCenter ? 12 : 10.5) * Math.min(1.12, Math.max(0.9, n.p.scale)));
              const pillW = shortLabel.length * (fontSize * 0.62) + 14;
              const pillH = fontSize + 8;

              return (
                <g
                  key={n.id}
                  transform={`translate(${n.p.sx.toFixed(1)}, ${n.p.sy.toFixed(1)})`}
                  opacity={isSelected || isHovered || isCenter ? 1 : n.p.depthAlpha}
                  className="cursor-pointer"
                  onClick={() => {
                    if (!dragRef.current.moved) setSelectedNodeId(n.id);
                  }}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                >
                  <g className={isFreshWaveNode ? "anim-node-spawn" : undefined}>
                    <circle
                      r={r}
                      fill="#161920"
                      stroke={n.style.color}
                      strokeWidth={isSelected || isHovered || isCenter ? 2.4 : 1.75}
                    />
                    <circle r={Math.max(3.5, r * 0.36)} fill={n.style.color} />
                    <circle
                      cx={-r * 0.28}
                      cy={-r * 0.28}
                      r={Math.max(1.2, r * 0.14)}
                      fill="#f0f2f5"
                      fillOpacity={0.55}
                    />
                    {/* Readable dark backing pill behind every label */}
                    <rect
                      x={-pillW / 2}
                      y={r + 5}
                      width={pillW}
                      height={pillH}
                      rx={5}
                      fill="#0c1017"
                      fillOpacity={0.94}
                      stroke={isSelected || isHovered || isCenter ? n.style.color : "#f0f2f5"}
                      strokeOpacity={isSelected || isHovered || isCenter ? 0.75 : 0.14}
                      strokeWidth={1}
                    />
                    <text
                      y={r + 5 + pillH / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={isCenter || isHovered || isSelected ? "#f0f2f5" : "#dce0e8"}
                      fontSize={fontSize}
                      fontWeight={isCenter || isHovered ? 500 : 400}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {shortLabel}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* Bottom Step Rail + Category Legend */}
          <div className="border-t border-[#f0f2f5]/[0.08] bg-[#11141b] px-4 py-3 space-y-2.5">
            {viewMode === "path" && activePath && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {chain3D.nodes.map((n, i) => {
                  const spawned = stage >= i * 2;
                  const edgeDrawn = i < chain3D.edges.length && stage >= i * 2 + 1;
                  return (
                    <div key={n.id} className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedNodeId(n.id)}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors duration-150 ${
                          spawned
                            ? "border-[#f0f2f5]/[0.12] bg-[#161920] text-[#f0f2f5]"
                            : "border-[#f0f2f5]/[0.05] bg-[#0f1115] text-[#4c5260]"
                        }`}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: spawned ? n.style.color : "#353b48" }}
                        />
                        <span>{shortName(n.id)}</span>
                      </button>
                      {i < chain3D.edges.length && (
                        <span className={`font-mono text-[10px] ${edgeDrawn ? "text-[#737a87]" : "text-[#353b48]"}`}>
                          —{chain3D.edges[i].predicate}→
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#737a87]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {LEGEND_ITEMS.map((item) => (
                  <span key={item.label} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span>{item.label}</span>
                  </span>
                ))}
              </div>
              <span className="hidden sm:inline">
                Drag to rotate 3D · Scroll to zoom · Shift+drag to pan · Click any node to inspect
              </span>
            </div>
          </div>
        </div>

        {/* Click-to-inspect Node Drawer */}
        {selectedNode && (
          <aside className="anim-rise border-t border-[#f0f2f5]/[0.08] bg-[#11141b] p-4 lg:col-span-3 lg:border-l lg:border-t-0 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-[#737a87]">{styleForNode(selectedNode).label}</div>
                <div className="mt-0.5 font-mono text-sm font-medium text-[#f0f2f5]">
                  {shortName(selectedNode.id)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="text-xs text-[#737a87] hover:text-[#f0f2f5]"
              >
                Close
              </button>
            </div>

            {selectedNode.provenance && <ProvenanceBadge kind={selectedNode.provenance} />}
            {selectedNode.label && <p className="text-xs text-[#a1a7b3]">{selectedNode.label}</p>}

            {viewMode === "wave" && selectedNode.id !== effectiveOrigin && (
              <button
                type="button"
                onClick={() => setWaveOrigin(selectedNode.id)}
                className="btn-press w-full rounded-lg bg-[#f0f2f5] px-3 py-1.5 text-xs font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white"
              >
                Spawn 3D sphere from here
              </button>
            )}

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[#a1a7b3] tabular-nums">
                Connected triples ({selectedEdges.length})
              </div>
              <div className="max-h-60 divide-y divide-[#f0f2f5]/[0.06] overflow-y-auto pr-1">
                {selectedEdges.map((e, i) => (
                  <div key={i} className="py-1.5 font-mono text-[11px] text-[#a1a7b3]">
                    <span className="text-[#f0f2f5]">{shortName(e.source)}</span>{" "}
                    <span className="text-[#737a87]">{shortName(e.predicate)}</span>{" "}
                    <span className="text-[#f0f2f5]">{shortName(e.target)}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
