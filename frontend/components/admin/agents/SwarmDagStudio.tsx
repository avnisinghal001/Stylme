"use client";

import { useCallback, useMemo, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import {
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  GitBranch,
  GripVertical,
  LayoutDashboard,
  LockKeyhole,
  LoaderCircle,
  MousePointer2,
  Phone,
  Plus,
  Radio,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

import { saveSwarm } from "@/lib/api/agent-admin";
import type { AgentConfig, AgentSwarm, AgentToolDefinition } from "@/types/ai-agents";

type GraphNode = AgentSwarm["graph"]["nodes"][number];
type GraphEdge = AgentSwarm["graph"]["edges"][number];
type CanvasPosition = { x: number; y: number };

type AgentNodeData = Record<string, unknown> & {
  graphKey: string;
  title: string;
  description: string;
  status: string;
  channels: string[];
  tools: number;
  isEntry: boolean;
  hasOverride: boolean;
};

type HandoffEdgeData = Record<string, unknown> & {
  graphIndex: number;
};

const inputClass = "h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-100";
const textareaClass = "w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-xs leading-5 text-zinc-900 outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-100";
const supportedOperators = ["eq", "neq", "in", "exists", "truthy"];

function readPosition(node: GraphNode, index: number): CanvasPosition {
  const ui = node.metadata?.ui;
  if (ui && typeof ui === "object" && !Array.isArray(ui)) {
    const position = (ui as Record<string, unknown>).position;
    if (position && typeof position === "object" && !Array.isArray(position)) {
      const x = Number((position as Record<string, unknown>).x);
      const y = Number((position as Record<string, unknown>).y);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
  }
  return { x: 80 + (index % 3) * 340, y: 80 + Math.floor(index / 3) * 240 };
}

function writePosition(node: GraphNode, position: CanvasPosition): GraphNode {
  const currentUi = node.metadata?.ui;
  return {
    ...node,
    metadata: {
      ...(node.metadata ?? {}),
      ui: {
        ...(currentUi && typeof currentUi === "object" && !Array.isArray(currentUi) ? currentUi : {}),
        position,
      },
    },
  };
}

function edgeId(edge: GraphEdge, index: number) {
  return `handoff:${index}:${edge.from}:${edge.to}`;
}

function edgeLabel(edge: GraphEdge) {
  const field = edge.condition.field || "condition";
  if (["exists", "truthy"].includes(edge.condition.operator)) return `${field} ${edge.condition.operator}`;
  const value = Array.isArray(edge.condition.value) ? edge.condition.value.join(", ") : String(edge.condition.value ?? "…");
  return `${field} ${edge.condition.operator} ${value}`;
}

function toFlowNode(node: GraphNode, index: number, swarm: AgentSwarm, agents: AgentConfig[]): Node<AgentNodeData, "agent"> {
  const agent = agents.find((item) => item.id === node.agentId);
  return {
    id: node.key,
    type: "agent",
    position: readPosition(node, index),
    data: {
      graphKey: node.key,
      title: agent?.name ?? "Unassigned agent",
      description: agent?.description ?? "Choose an agent in the inspector.",
      status: agent?.status ?? "missing",
      channels: agent?.channels ?? [],
      tools: agent?.tools.filter((tool) => tool.enabled).length ?? 0,
      isEntry: swarm.graph.entryNodeKey === node.key,
      hasOverride: Boolean(node.instructionOverrides?.trim()),
    },
  };
}

function toFlowEdge(edge: GraphEdge, index: number): Edge<HandoffEdgeData> {
  return {
    id: edgeId(edge, index),
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    label: edgeLabel(edge),
    data: { graphIndex: index },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#e11d48" },
    style: { stroke: "#e11d48", strokeWidth: 2 },
    labelStyle: { fill: "#52525b", fontSize: 10, fontWeight: 700 },
    labelBgStyle: { fill: "#fff", fillOpacity: 0.96 },
    labelBgPadding: [7, 5],
    labelBgBorderRadius: 7,
  };
}

function compatibleAgent(agent: AgentConfig, swarm: AgentSwarm) {
  return agent.channels.some((channel) => swarm.channels.includes(channel)) && swarm.directions.includes(agent.direction);
}

export function validateSwarmGraph(swarm: AgentSwarm, agents: AgentConfig[] = []) {
  const errors: string[] = [];
  const keys = swarm.graph.nodes.map((node) => node.key.trim());
  const known = new Set(keys);
  if (!swarm.name.trim()) errors.push("Workflow name is required.");
  if (!swarm.graph.nodes.length) errors.push("Add at least one agent node.");
  if (keys.some((key) => !key)) errors.push("Every node needs a key.");
  if (new Set(keys).size !== keys.length) errors.push("Node keys must be unique.");
  if (swarm.graph.nodes.some((node) => !node.agentId)) errors.push("Every node must reference an agent.");
  if (!known.has(swarm.graph.entryNodeKey)) errors.push("Choose a valid entry node.");
  if (agents.length && swarm.graph.nodes.some((node) => { const agent = agents.find((item) => item.id === node.agentId); return !agent || !compatibleAgent(agent, swarm); })) errors.push("Every node agent must match the workflow channel and direction.");
  const humanNumber = swarm.telephony.humanHandoffNumber?.trim() ?? "";
  const needsHumanNumber = swarm.graph.nodes.some((node) => agents.find((agent) => agent.id === node.agentId)?.tools.some((tool) => tool.key === "warm_transfer" && tool.enabled));
  if (needsHumanNumber && !humanNumber) errors.push("Configure a human handoff number before using warm transfer.");
  if (humanNumber) {
    const digits = humanNumber.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) errors.push("Human handoff number must be a valid E.164 or 10-digit Indian number.");
  }

  swarm.graph.edges.forEach((edge, index) => {
    const label = `Handoff ${index + 1}`;
    if (!known.has(edge.from) || !known.has(edge.to)) errors.push(`${label} references a missing node.`);
    if (edge.from === edge.to) errors.push(`${label} cannot loop to the same node.`);
    if (!edge.condition.field.trim()) errors.push(`${label} needs a condition field.`);
    if (!supportedOperators.includes(edge.condition.operator)) errors.push(`${label} has an unsupported operator.`);
  });
  if (agents.length && swarm.graph.edges.some((edge) => { const node = swarm.graph.nodes.find((item) => item.key === edge.from); const agent = agents.find((item) => item.id === node?.agentId); return !agent?.tools.some((tool) => tool.key === "handoff" && tool.enabled); })) errors.push("Every node with outgoing routes must have the handoff tool enabled.");
  const routeKeys = swarm.graph.edges.map((edge) => `${edge.from}\u0000${edge.to}`);
  if (new Set(routeKeys).size !== routeKeys.length) errors.push("Each source and destination can have only one handoff edge.");

  const adjacency = new Map<string, string[]>();
  keys.forEach((key) => adjacency.set(key, []));
  swarm.graph.edges.forEach((edge) => adjacency.get(edge.from)?.push(edge.to));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const next of adjacency.get(key) ?? []) if (visit(next)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  }
  if (keys.some((key) => visit(key))) errors.push("The workflow contains a cycle. Handoffs must remain acyclic.");
  const reachable = new Set<string>();
  function markReachable(key: string) { if (reachable.has(key)) return; reachable.add(key); for (const next of adjacency.get(key) ?? []) markReachable(next); }
  if (known.has(swarm.graph.entryNodeKey)) markReachable(swarm.graph.entryNodeKey);
  if (reachable.size !== known.size) errors.push("Every node must be reachable from the entry node.");
  return [...new Set(errors)];
}

function AgentCanvasNode({ data, selected }: NodeProps<Node<AgentNodeData, "agent">>) {
  const isActive = data.status === "active";
  return (
    <div className={`group w-[272px] overflow-hidden rounded-2xl border bg-white shadow-[0_16px_45px_-22px_rgba(24,24,27,0.42)] transition ${selected ? "border-pink-500 ring-4 ring-pink-100" : "border-zinc-200 hover:border-pink-300"}`}>
      <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-white !bg-pink-500" />
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${data.isEntry ? "bg-pink-600 text-white" : "bg-zinc-950 text-white"}`}><Bot className="size-4" /></span>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-xs font-black text-zinc-950">{data.title}</p>{data.isEntry && <span className="rounded-full bg-pink-50 px-1.5 py-0.5 text-[8px] font-black uppercase text-pink-700">Entry</span>}</div><p className="mt-0.5 font-mono text-[9px] text-zinc-400">{data.graphKey}</p></div>
        <GripVertical className="size-4 text-zinc-300 transition group-hover:text-zinc-500" />
      </div>
      <div className="px-4 py-3"><p className="line-clamp-2 min-h-8 text-[10px] leading-4 text-zinc-500">{data.description}</p><div className="mt-3 flex flex-wrap items-center gap-1.5"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-black uppercase ${isActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}><span className={`size-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-amber-500"}`} />{data.status}</span>{data.channels.map((channel) => <span key={channel} className="rounded-full bg-zinc-100 px-2 py-1 text-[8px] font-black uppercase text-zinc-500">{channel}</span>)}<span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-[8px] font-black uppercase text-violet-700"><Zap className="size-2.5" /> {data.tools} tools</span></div>{data.hasOverride && <div className="mt-3 flex items-center gap-1.5 border-t border-zinc-100 pt-2.5 text-[9px] font-bold text-pink-700"><Sparkles className="size-3" /> Node prompt override</div>}</div>
      <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-white !bg-zinc-950" />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-black text-zinc-700"><span>{label}</span>{hint && <span className="font-medium text-zinc-400">{hint}</span>}</span>{children}</label>;
}

function uniqueNodeKey(nodes: GraphNode[]) {
  let index = nodes.length + 1;
  while (nodes.some((node) => node.key === `agent_${index}`)) index += 1;
  return `agent_${index}`;
}

function SwarmDagStudioInner({ source, agents, tools, onSaved, onCreateAgent }: { source: AgentSwarm; agents: AgentConfig[]; tools: AgentToolDefinition[]; onSaved: () => Promise<void>; onCreateAgent: (fromNodeKey: string) => void }) {
  const [value, setValue] = useState(() => structuredClone(source));
  const [nodes, setNodes] = useState<Array<Node<AgentNodeData, "agent">>>(() => source.graph.nodes.map((node, index) => toFlowNode(node, index, source, agents)));
  const [edges, setEdges] = useState<Array<Edge<HandoffEdgeData>>>(() => source.graph.edges.map(toFlowEdge));
  const [selectedNode, setSelectedNode] = useState(source.graph.entryNodeKey || source.graph.nodes[0]?.key || "");
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [inspector, setInspector] = useState<"selection" | "workflow">("selection");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad" | "neutral"; text: string } | null>(null);
  const flow = useReactFlow<Node<AgentNodeData, "agent">, Edge<HandoffEdgeData>>();

  const currentNode = value.graph.nodes.find((node) => node.key === selectedNode) ?? null;
  const currentEdge = selectedEdge === null ? null : value.graph.edges[selectedEdge] ?? null;
  const validationErrors = useMemo(() => validateSwarmGraph(value, agents), [value, agents]);
  const initialSignature = useMemo(() => JSON.stringify(source), [source]);
  const isDirty = JSON.stringify(value) !== initialSignature;

  const refreshFlowData = useCallback((next: AgentSwarm) => {
    setNodes((current) => next.graph.nodes.map((node, index) => {
      const existing = current.find((item) => item.id === node.key);
      const rebuilt = toFlowNode(node, index, next, agents);
      return existing ? { ...rebuilt, position: existing.position } : rebuilt;
    }));
    setEdges(next.graph.edges.map(toFlowEdge));
  }, [agents]);

  function updateValue(recipe: (current: AgentSwarm) => AgentSwarm) {
    const next = recipe(value);
    setValue(next);
    refreshFlowData(next);
    setNotice(null);
  }

  function patchNode(key: string, patch: Partial<GraphNode>) {
    updateValue((current) => ({ ...current, graph: { ...current.graph, nodes: current.graph.nodes.map((node) => node.key === key ? { ...node, ...patch } : node) } }));
  }

  function renameNode(previous: string, nextRaw: string) {
    const next = nextRaw.trim().replace(/\s+/g, "_");
    if (!next || next === previous) return;
    if (value.graph.nodes.some((node) => node.key === next)) {
      setNotice({ tone: "bad", text: `“${next}” is already used by another node.` });
      return;
    }
    updateValue((current) => ({
      ...current,
      graph: {
        ...current.graph,
        entryNodeKey: current.graph.entryNodeKey === previous ? next : current.graph.entryNodeKey,
        nodes: current.graph.nodes.map((node) => node.key === previous ? { ...node, key: next } : node),
        edges: current.graph.edges.map((edge) => ({ ...edge, from: edge.from === previous ? next : edge.from, to: edge.to === previous ? next : edge.to })),
      },
    }));
    setSelectedNode(next);
  }

  function patchEdge(index: number, patch: Partial<GraphEdge>) {
    updateValue((current) => ({ ...current, graph: { ...current.graph, edges: current.graph.edges.map((edge, itemIndex) => itemIndex === index ? { ...edge, ...patch } : edge) } }));
  }

  function addNode() {
    const key = uniqueNodeKey(value.graph.nodes);
    const available = agents.filter((agent) => compatibleAgent(agent, value));
    const position = flow.screenToFlowPosition({ x: window.innerWidth * 0.52, y: window.innerHeight * 0.52 });
    updateValue((current) => ({
      ...current,
      graph: {
        ...current.graph,
        entryNodeKey: current.graph.entryNodeKey || key,
        nodes: [...current.graph.nodes, writePosition({ key, agentId: available[0]?.id ?? "", instructionOverrides: "", metadata: {} }, position)],
      },
    }));
    setSelectedNode(key);
    setSelectedEdge(null);
    setInspector("selection");
    window.setTimeout(() => void flow.fitView({ padding: 0.25, duration: 350 }), 20);
  }

  function removeNode(key: string) {
    updateValue((current) => {
      const nodesNext = current.graph.nodes.filter((node) => node.key !== key);
      return {
        ...current,
        graph: {
          ...current.graph,
          nodes: nodesNext,
          edges: current.graph.edges.filter((edge) => edge.from !== key && edge.to !== key),
          entryNodeKey: current.graph.entryNodeKey === key ? nodesNext[0]?.key ?? "" : current.graph.entryNodeKey,
        },
      };
    });
    setSelectedNode(value.graph.nodes.find((node) => node.key !== key)?.key ?? "");
    setSelectedEdge(null);
  }

  function removeEdge(index: number) {
    updateValue((current) => ({ ...current, graph: { ...current.graph, edges: current.graph.edges.filter((_, itemIndex) => itemIndex !== index) } }));
    setSelectedEdge(null);
  }

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) {
      setNotice({ tone: "bad", text: "A node cannot hand off to itself." });
      return;
    }
    if (value.graph.edges.some((edge) => edge.from === connection.source && edge.to === connection.target)) {
      setNotice({ tone: "bad", text: "That handoff already exists." });
      return;
    }
    const nextEdge: GraphEdge = { from: connection.source, to: connection.target, priority: 10, condition: { field: "intent", operator: "exists" }, handoffMessage: "" };
    setValue((current) => ({ ...current, graph: { ...current.graph, edges: [...current.graph.edges, nextEdge] } }));
    setEdges((current) => addEdge(toFlowEdge(nextEdge, value.graph.edges.length), current));
    setSelectedEdge(value.graph.edges.length);
    setSelectedNode("");
    setInspector("selection");
    setNotice(null);
  }, [value.graph.edges]);

  function onNodesChange(changes: NodeChange<Node<AgentNodeData, "agent">>[]) {
    setNodes((current) => applyNodeChanges(changes, current));
  }

  function onEdgesChange(changes: EdgeChange<Edge<HandoffEdgeData>>[]) {
    setEdges((current) => applyEdgeChanges(changes, current));
  }

  function persistNodePosition(node: Node<AgentNodeData, "agent">) {
    setValue((current) => ({
      ...current,
      graph: { ...current.graph, nodes: current.graph.nodes.map((item) => item.key === node.id ? writePosition(item, node.position) : item) },
    }));
  }

  function autoLayout() {
    const indegree = new Map(value.graph.nodes.map((node) => [node.key, 0]));
    const outgoing = new Map(value.graph.nodes.map((node) => [node.key, [] as string[]]));
    value.graph.edges.forEach((edge) => { indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1); outgoing.get(edge.from)?.push(edge.to); });
    const queue = value.graph.nodes.filter((node) => (indegree.get(node.key) ?? 0) === 0).map((node) => node.key);
    const level = new Map(queue.map((key) => [key, key === value.graph.entryNodeKey ? 0 : 0]));
    while (queue.length) {
      const key = queue.shift()!;
      for (const target of outgoing.get(key) ?? []) {
        level.set(target, Math.max(level.get(target) ?? 0, (level.get(key) ?? 0) + 1));
        indegree.set(target, (indegree.get(target) ?? 1) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      }
    }
    const rows = new Map<number, number>();
    const positioned = value.graph.nodes.map((node) => {
      const column = level.get(node.key) ?? 0;
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return writePosition(node, { x: 70 + column * 360, y: 70 + row * 220 });
    });
    updateValue((current) => ({ ...current, graph: { ...current.graph, nodes: positioned } }));
    setNodes(positioned.map((node, index) => toFlowNode(node, index, { ...value, graph: { ...value.graph, nodes: positioned } }, agents)));
    window.setTimeout(() => void flow.fitView({ padding: 0.25, duration: 450 }), 30);
  }

  async function commit() {
    const currentPositions = new Map(nodes.map((node) => [node.id, node.position]));
    const next = {
      ...value,
      graph: { ...value.graph, nodes: value.graph.nodes.map((node) => writePosition(node, currentPositions.get(node.key) ?? readPosition(node, 0))) },
    };
    const errors = validateSwarmGraph(next, agents);
    if (errors.length) {
      setNotice({ tone: "bad", text: errors[0] });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await saveSwarm(next);
      setValue(next);
      setNotice({ tone: "good", text: "Workflow validated and saved as a new revision." });
      await onSaved();
    } catch (reason) {
      setNotice({ tone: "bad", text: reason instanceof Error ? reason.message : "Workflow save failed." });
    } finally {
      setSaving(false);
    }
  }

  function validateNow() {
    setNotice(validationErrors.length ? { tone: "bad", text: validationErrors[0] } : { tone: "good", text: "Graph is valid, connected safely, and ready to save." });
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-pink-100 bg-white shadow-[0_24px_70px_-55px_rgba(190,24,93,0.7)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 bg-white px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-950 text-white"><GitBranch className="size-4" /></span><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-black text-zinc-950">{value.name}</h2><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[8px] font-black uppercase text-zinc-500">rev {value.revision}</span></div><div className="mt-1 flex items-center gap-2 text-[9px] font-bold text-zinc-400"><span className="inline-flex items-center gap-1"><Radio className="size-2.5 text-emerald-500" /> {value.status}</span><span>•</span><span>{value.graph.nodes.length} agents</span><span>•</span><span>{value.graph.edges.length} handoffs</span></div></div></div>
        <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => { setInspector("workflow"); setSelectedEdge(null); setSelectedNode(""); }} className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[10px] font-black ${inspector === "workflow" ? "border-pink-300 bg-pink-50 text-pink-700" : "border-zinc-200 text-zinc-600"}`}><Settings2 className="size-3.5" /> Workflow</button><button type="button" onClick={autoLayout} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 px-3 text-[10px] font-black text-zinc-600"><LayoutDashboard className="size-3.5" /> Auto layout</button><button type="button" onClick={addNode} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-950 px-3 text-[10px] font-black text-white"><Plus className="size-3.5" /> Add agent</button><button type="button" onClick={validateNow} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 px-3 text-[10px] font-black text-zinc-600"><Check className="size-3.5" /> Validate</button><button type="button" onClick={() => void commit()} disabled={saving || !isDirty} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-pink-600 px-3 text-[10px] font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save workflow</button></div>
      </div>

      {notice && <div role="status" className={`flex items-center gap-2 border-b px-5 py-2.5 text-[10px] font-bold ${notice.tone === "good" ? "border-emerald-100 bg-emerald-50 text-emerald-800" : notice.tone === "bad" ? "border-red-100 bg-red-50 text-red-800" : "border-zinc-100 bg-zinc-50 text-zinc-700"}`}>{notice.tone === "good" ? <Check className="size-3.5" /> : notice.tone === "bad" ? <CircleAlert className="size-3.5" /> : null}<span className="flex-1">{notice.text}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X className="size-3.5" /></button></div>}

      <div className="grid min-h-[680px] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="relative min-h-[560px] overflow-hidden bg-[#fbfafb]">
          <ReactFlow<Node<AgentNodeData, "agent">, Edge<HandoffEdgeData>>
            nodes={nodes}
            edges={edges}
            nodeTypes={{ agent: AgentCanvasNode }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={(_, node) => persistNodePosition(node)}
            onNodeClick={(_, node) => { setSelectedNode(node.id); setSelectedEdge(null); setInspector("selection"); }}
            onEdgeClick={(_, edge) => { setSelectedEdge(edge.data?.graphIndex ?? null); setSelectedNode(""); setInspector("selection"); }}
            onPaneClick={() => { setSelectedNode(""); setSelectedEdge(null); }}
            onConnect={onConnect}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.25}
            maxZoom={1.65}
            defaultEdgeOptions={{ type: "smoothstep" }}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#e4d9dd" />
            <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.data?.isEntry ? "#e11d48" : "#18181b"} maskColor="rgba(250, 247, 248, .78)" className="!rounded-xl !border !border-zinc-200 !bg-white" />
            <Controls position="bottom-left" showInteractive={false} className="!overflow-hidden !rounded-xl !border-zinc-200 !shadow-sm" />
            <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 text-[9px] font-bold text-zinc-500 shadow-sm backdrop-blur"><MousePointer2 className="size-3 text-pink-600" /> Drag nodes · connect handles · click to configure</div>
          </ReactFlow>
        </div>

        <aside className="border-t border-zinc-100 bg-white xl:border-l xl:border-t-0">
          {inspector === "workflow" ? (
            <WorkflowInspector value={value} onChange={updateValue} />
          ) : currentNode ? (
            <NodeInspector key={currentNode.key} node={currentNode} agents={agents.filter((agent) => compatibleAgent(agent, value))} tools={tools} isEntry={value.graph.entryNodeKey === currentNode.key} onPatch={(patch) => patchNode(currentNode.key, patch)} onRename={(next) => renameNode(currentNode.key, next)} onMakeEntry={() => updateValue((current) => ({ ...current, graph: { ...current.graph, entryNodeKey: currentNode.key } }))} onRemove={() => removeNode(currentNode.key)} canRemove={value.graph.nodes.length > 1} canCreateAgent={Boolean(value.id) && !isDirty} onCreateAgent={() => { if (isDirty) setNotice({ tone: "bad", text: "Save this workflow before creating and attaching another agent." }); else onCreateAgent(currentNode.key); }} />
          ) : currentEdge && selectedEdge !== null ? (
            <EdgeInspector edge={currentEdge} nodes={value.graph.nodes} onPatch={(patch) => patchEdge(selectedEdge, patch)} onRemove={() => removeEdge(selectedEdge)} />
          ) : (
            <div className="grid min-h-80 place-items-center p-7 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-pink-50 text-pink-600"><MousePointer2 className="size-5" /></span><h3 className="mt-4 text-sm font-black text-zinc-950">Select an agent or handoff</h3><p className="mt-2 text-[11px] leading-5 text-zinc-500">Every canvas object has its own persistent configuration. Open Workflow for shared routing and SIP settings.</p></div></div>
          )}
        </aside>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-3 text-[9px] font-bold text-zinc-500"><span className="inline-flex items-center gap-1.5">{validationErrors.length ? <CircleAlert className="size-3 text-amber-500" /> : <Check className="size-3 text-emerald-500" />}{validationErrors.length ? `${validationErrors.length} validation issue${validationErrors.length === 1 ? "" : "s"}` : "DAG passes local validation"}</span><span>{isDirty ? "Unsaved canvas changes" : "All changes saved"}</span></div>
    </section>
  );
}

function InspectorHeader({ eyebrow, title, icon }: { eyebrow: string; title: string; icon: React.ReactNode }) {
  return <div className="border-b border-zinc-100 p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-950 text-white">{icon}</span><div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-pink-600">{eyebrow}</p><h3 className="mt-1 truncate text-base font-black text-zinc-950">{title}</h3></div></div></div>;
}

function NodeInspector({ node, agents, tools, isEntry, onPatch, onRename, onMakeEntry, onRemove, canRemove, canCreateAgent, onCreateAgent }: { node: GraphNode; agents: AgentConfig[]; tools: AgentToolDefinition[]; isEntry: boolean; onPatch: (patch: Partial<GraphNode>) => void; onRename: (next: string) => void; onMakeEntry: () => void; onRemove: () => void; canRemove: boolean; canCreateAgent: boolean; onCreateAgent: () => void }) {
  const [draftKey, setDraftKey] = useState(node.key);
  const [metadata, setMetadata] = useState(() => JSON.stringify(node.metadata ?? {}, null, 2));
  const selectedAgent = agents.find((agent) => agent.id === node.agentId);
  const enabledTools = tools.filter((definition) => definition.availability === "always_on" && definition.channels.some((channel) => selectedAgent?.channels.includes(channel)) || selectedAgent?.tools.some((tool) => tool.key === definition.key && tool.enabled));
  const availability = [...new Set(enabledTools.map((tool) => tool.availability))];
  return <div><InspectorHeader eyebrow="Agent node" title={node.key} icon={<Bot className="size-4" />} /><div className="space-y-5 p-5"><Field label="Node key" hint="Unique"><input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} onBlur={() => { onRename(draftKey); setDraftKey(draftKey.trim().replace(/\s+/g, "_")); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className={inputClass} /></Field><Field label="Reusable agent"><select value={node.agentId} onChange={(event) => onPatch({ agentId: event.target.value })} className={inputClass}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · rev {agent.revision}</option>)}</select></Field><button type="button" onClick={onCreateAgent} disabled={!canCreateAgent} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 text-[10px] font-black text-violet-700 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="size-3.5" /> Create & attach new agent</button><div className="border-t border-zinc-100 pt-5"><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-black text-zinc-800">Runtime tools</p><p className="mt-1 text-[9px] text-zinc-400">Inherited from {selectedAgent?.name ?? "the selected agent"}</p></div><span className="rounded-full bg-violet-50 px-2 py-1 text-[9px] font-black text-violet-700">{enabledTools.length}</span></div>{availability.length ? <div className="space-y-3">{availability.map((status) => <div key={status}><p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.12em] text-zinc-400">{status.replaceAll("_", " ")}</p><div className="space-y-1.5">{enabledTools.filter((tool) => tool.availability === status).map((tool) => <div key={tool.key} className="rounded-xl border border-violet-100 bg-violet-50/50 p-2.5"><div className="flex items-center gap-2"><Zap className="size-3 text-violet-600" /><p className="text-[10px] font-black text-zinc-800">{tool.name}</p></div><p className="mt-1 text-[9px] leading-4 text-zinc-500">{tool.description}</p></div>)}</div></div>)}</div> : <p className="rounded-xl border border-dashed border-zinc-200 p-3 text-[9px] leading-4 text-zinc-400">This agent has no assignable tools enabled.</p>}</div><Field label="Node instruction override" hint="Optional"><textarea rows={7} value={node.instructionOverrides ?? ""} onChange={(event) => onPatch({ instructionOverrides: event.target.value })} placeholder="Add instructions that apply only when this node is active…" className={textareaClass} /></Field><Field label="Metadata" hint="JSON"><div className="relative"><Braces className="absolute right-3 top-3 size-3.5 text-pink-400" /><textarea rows={8} value={metadata} onChange={(event) => setMetadata(event.target.value)} onBlur={() => { try { onPatch({ metadata: JSON.parse(metadata) as Record<string, unknown> }); } catch { /* keep draft visible until valid */ } }} spellCheck={false} className={`${textareaClass} font-mono text-[9px]`} /></div></Field><div className="grid gap-2"><button type="button" onClick={onMakeEntry} disabled={isEntry} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-pink-200 bg-pink-50 text-[10px] font-black text-pink-700 disabled:opacity-50"><WandSparkles className="size-3.5" /> {isEntry ? "Current entry node" : "Make entry node"}</button><button type="button" onClick={onRemove} disabled={!canRemove} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-100 text-[10px] font-black text-red-600 disabled:opacity-30"><Trash2 className="size-3.5" /> Remove node</button></div></div></div>;
}

function EdgeInspector({ edge, nodes, onPatch, onRemove }: { edge: GraphEdge; nodes: GraphNode[]; onPatch: (patch: Partial<GraphEdge>) => void; onRemove: () => void }) {
  return <div><InspectorHeader eyebrow="Conditional handoff" title={`${edge.from} → ${edge.to}`} icon={<ChevronRight className="size-4" />} /><div className="space-y-5 p-5"><div className="grid grid-cols-2 gap-3"><Field label="From"><select value={edge.from} onChange={(event) => onPatch({ from: event.target.value })} className={inputClass}>{nodes.map((node) => <option key={node.key}>{node.key}</option>)}</select></Field><Field label="To"><select value={edge.to} onChange={(event) => onPatch({ to: event.target.value })} className={inputClass}>{nodes.map((node) => <option key={node.key}>{node.key}</option>)}</select></Field></div><Field label="Context field" hint="Dot path"><input value={edge.condition.field} onChange={(event) => onPatch({ condition: { ...edge.condition, field: event.target.value } })} placeholder="intent" className={inputClass} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Operator"><select value={edge.condition.operator} onChange={(event) => onPatch({ condition: { ...edge.condition, operator: event.target.value } })} className={inputClass}>{supportedOperators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></Field><Field label="Priority"><input type="number" min={0} value={edge.priority} onChange={(event) => onPatch({ priority: Number(event.target.value) })} className={inputClass} /></Field></div>{!["exists", "truthy"].includes(edge.condition.operator) && <Field label="Expected value"><input value={Array.isArray(edge.condition.value) ? edge.condition.value.join(", ") : String(edge.condition.value ?? "")} onChange={(event) => onPatch({ condition: { ...edge.condition, value: edge.condition.operator === "in" ? event.target.value.split(",").map((item) => item.trim()).filter(Boolean) : event.target.value } })} placeholder={edge.condition.operator === "in" ? "sales, styling, support" : "styling"} className={inputClass} /></Field>}<Field label="Handoff message" hint="Spoken before transfer"><textarea rows={5} value={edge.handoffMessage ?? ""} onChange={(event) => onPatch({ handoffMessage: event.target.value })} placeholder="I’ll connect you with our styling specialist." className={textareaClass} /></Field><button type="button" onClick={onRemove} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-100 text-[10px] font-black text-red-600"><Trash2 className="size-3.5" /> Remove handoff</button></div></div>;
}

function WorkflowInspector({ value, onChange }: { value: AgentSwarm; onChange: (recipe: (current: AgentSwarm) => AgentSwarm) => void }) {
  function patch<K extends keyof AgentSwarm>(key: K, next: AgentSwarm[K]) { onChange((current) => ({ ...current, [key]: next })); }
  function patchHumanNumber(next: string) { onChange((current) => ({ ...current, telephony: { ...current.telephony, humanHandoffNumber: next } })); }
  return <div>
    <InspectorHeader eyebrow="Workflow settings" title={value.name} icon={<Settings2 className="size-4" />} />
    <div className="space-y-5 p-5">
      <Field label="Workflow name"><input value={value.name} onChange={(event) => patch("name", event.target.value)} className={inputClass} /></Field>
      <Field label="Workflow key" hint="Unique"><input value={value.key} onChange={(event) => patch("key", event.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"))} className={inputClass} /></Field>
      <Field label="Description"><textarea rows={4} value={value.description} onChange={(event) => patch("description", event.target.value)} className={textareaClass} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Channel"><select value={value.channels[0] ?? "voice"} onChange={(event) => { const channel = event.target.value; onChange((current) => ({ ...current, channels: [channel], directions: [channel === "web" ? "interactive" : current.directions[0] === "interactive" ? "inbound" : current.directions[0] ?? "inbound"] })); }} className={inputClass}><option value="voice">Voice</option><option value="web">Web</option></select></Field><Field label="Direction"><select value={value.directions[0] ?? "inbound"} onChange={(event) => patch("directions", [event.target.value])} className={inputClass}>{value.channels.includes("web") ? <option value="interactive">Interactive</option> : <><option value="inbound">Inbound</option><option value="outbound">Outbound</option></>}</select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Status"><select value={value.status} onChange={(event) => patch("status", event.target.value)} className={inputClass}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></Field><Field label="Default route"><button type="button" onClick={() => patch("isDefault", !value.isDefault)} className={`h-10 w-full rounded-xl border text-[10px] font-black ${value.isDefault ? "border-pink-300 bg-pink-50 text-pink-700" : "border-zinc-200 text-zinc-500"}`}>{value.isDefault ? "Enabled" : "Disabled"}</button></Field></div>
      <div className="space-y-3 border-t border-zinc-100 pt-5">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4" aria-label="Managed phone line"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><Phone className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">Managed caller line</p><span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[8px] font-black uppercase text-emerald-700"><LockKeyhole className="size-2.5" /> Read only</span></div><p className="mt-2 break-words text-lg font-black tracking-tight text-zinc-950">{formatPhoneNumber(value.telephony.phoneNumber)}</p><p className="mt-1 text-[9px] leading-4 text-zinc-500">LiveKit trunks and the public caller ID remain server-managed.</p></div></div></div>
        {value.channels.includes("voice") && value.directions.includes("inbound") && <div className="rounded-2xl border border-pink-200 bg-pink-50/70 p-4" aria-label="Human handoff settings">
          <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-pink-700 shadow-sm"><Phone className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-pink-700">Live human handoff</p><span className="rounded-full bg-pink-600 px-2 py-1 text-[8px] font-black uppercase text-white">Warm transfer</span></div><p className="mt-1 text-[9px] leading-4 text-zinc-600">Calls this person, gives them a private summary, then joins them to the caller&apos;s room.</p></div></div>
          <div className="mt-4"><Field label="Support phone number" hint="Admin editable"><input type="tel" inputMode="tel" value={value.telephony.humanHandoffNumber ?? ""} onChange={(event) => patchHumanNumber(event.target.value)} placeholder="+91 81266 79138" className={inputClass} /></Field><p className="mt-2 text-[9px] leading-4 text-zinc-500">Use E.164, or enter a 10-digit Indian mobile number. The server normalizes it before saving.</p></div>
        </div>}
      </div>
    </div>
  </div>;
}

function formatPhoneNumber(value?: string) {
  const normalized = value?.trim() ?? "";
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return normalized || "Not assigned";
}

export default function SwarmDagStudio(props: { source: AgentSwarm; agents: AgentConfig[]; tools: AgentToolDefinition[]; onSaved: () => Promise<void>; onCreateAgent: (fromNodeKey: string) => void }) {
  return <ReactFlowProvider><SwarmDagStudioInner {...props} /></ReactFlowProvider>;
}
