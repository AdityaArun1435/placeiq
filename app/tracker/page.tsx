"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";

// ── Types ──────────────────────────────────────────────────────────────────

type Stage = "saved" | "applied" | "interview" | "offer" | "rejected";

type Card = {
  id: string;
  company: string;
  role: string;
  date: string;
  notes: string;
};

type Board = Record<Stage, Card[]>;

// ── Config ─────────────────────────────────────────────────────────────────

const COLUMNS: {
  id: Stage;
  label: string;
  textColor: string;
  dot: string;
  badgeBg: string;
}[] = [
  { id: "saved",     label: "Saved",     textColor: "text-gray-300",   dot: "bg-gray-400",   badgeBg: "bg-gray-700" },
  { id: "applied",   label: "Applied",   textColor: "text-blue-400",   dot: "bg-blue-500",   badgeBg: "bg-blue-900/60" },
  { id: "interview", label: "Interview", textColor: "text-yellow-400", dot: "bg-yellow-400", badgeBg: "bg-yellow-900/50" },
  { id: "offer",     label: "Offer",     textColor: "text-green-400",  dot: "bg-green-500",  badgeBg: "bg-green-900/50" },
  { id: "rejected",  label: "Rejected",  textColor: "text-red-400",    dot: "bg-red-500",    badgeBg: "bg-red-900/50" },
];

const STORAGE_KEY = "placeiq_tracker";

// ── Storage helpers ────────────────────────────────────────────────────────

function emptyBoard(): Board {
  return { saved: [], applied: [], interview: [], offer: [], rejected: [] };
}

function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBoard();
    const parsed = JSON.parse(raw);
    // Ensure all keys exist
    const b = emptyBoard();
    for (const col of COLUMNS) b[col.id] = Array.isArray(parsed[col.id]) ? parsed[col.id] : [];
    return b;
  } catch {
    return emptyBoard();
  }
}

function saveBoard(board: Board) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Modal ──────────────────────────────────────────────────────────────────

type ModalState = { stage: Stage } | null;
type FormValues = { company: string; role: string; date: string; notes: string };

function AddModal({
  stage,
  onAdd,
  onClose,
}: {
  stage: Stage;
  onAdd: (card: Card) => void;
  onClose: () => void;
}) {
  const col = COLUMNS.find((c) => c.id === stage)!;
  const [form, setForm] = useState<FormValues>({
    company: "",
    role: "",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const companyRef = useRef<HTMLInputElement>(null);
  useEffect(() => { companyRef.current?.focus(); }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company.trim() || !form.role.trim()) return;
    onAdd({
      id: genId(),
      company: form.company.trim(),
      role: form.role.trim(),
      date: form.date,
      notes: form.notes.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKey}
    >
      <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center gap-2 mb-5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${col.dot}`} />
          <h3 className="font-semibold text-white">Add to {col.label}</h3>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Company Name *</label>
            <input
              ref={companyRef}
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              placeholder="e.g. Google"
              required
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 transition"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Role *</label>
            <input
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              placeholder="e.g. Software Engineer"
              required
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 transition"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-gray-500 transition [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this application..."
              rows={3}
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 transition resize-none"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 rounded-lg py-2.5 text-sm transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium transition"
            >
              Add Card
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── KanbanCard ─────────────────────────────────────────────────────────────

function KanbanCard({
  card,
  col,
  index,
  onDelete,
  onNotesChange,
}: {
  card: Card;
  col: (typeof COLUMNS)[number];
  index: number;
  onDelete: (id: string) => void;
  onNotesChange: (id: string, notes: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [draft, setDraft] = useState(card.notes);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function startEdit() {
    setDraft(card.notes);
    setEditingNotes(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function commitEdit() {
    setEditingNotes(false);
    if (draft.trim() !== card.notes) onNotesChange(card.id, draft.trim());
  }

  const displayDate = card.date
    ? new Date(card.date + "T00:00:00").toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  return (
    <Draggable draggableId={card.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`group bg-[#1a1a1a] border rounded-xl p-4 select-none transition-shadow ${
            snapshot.isDragging
              ? "border-gray-600 shadow-xl shadow-black/40 rotate-1"
              : "border-gray-800 hover:border-gray-700"
          }`}
        >
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${col.dot}`} />
              <span className="font-semibold text-white text-sm truncate leading-snug">
                {card.company}
              </span>
            </div>
            <button
              onClick={() => onDelete(card.id)}
              className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-gray-700 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
              title="Delete card"
            >
              ×
            </button>
          </div>

          {/* Role */}
          <p className="text-gray-400 text-xs mb-1 pl-4 truncate">{card.role}</p>

          {/* Date */}
          {displayDate && (
            <p className="text-gray-600 text-xs pl-4 mb-2">{displayDate}</p>
          )}

          {/* Notes — inline editable */}
          <div className="pl-4">
            {editingNotes ? (
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === "Escape") { setEditingNotes(false); setDraft(card.notes); } }}
                rows={3}
                placeholder="Add notes..."
                className="w-full bg-[#111] border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 resize-none transition"
              />
            ) : (
              <button
                onClick={startEdit}
                className="w-full text-left"
                title="Click to edit notes"
              >
                {card.notes ? (
                  <p className="text-gray-500 text-xs leading-relaxed hover:text-gray-400 transition line-clamp-3">
                    {card.notes}
                  </p>
                ) : (
                  <p className="text-gray-700 text-xs italic hover:text-gray-600 transition">
                    Add notes...
                  </p>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function TrackerPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [board, setBoard] = useState<Board>(emptyBoard);
  const [mounted, setMounted] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    setBoard(loadBoard());
    setMounted(true);
  }, []);

  function addCard(stage: Stage, card: Card) {
    setBoard((prev) => {
      const next = { ...prev, [stage]: [card, ...prev[stage]] };
      saveBoard(next);
      return next;
    });
    setModal(null);
  }

  function deleteCard(stage: Stage, id: string) {
    setBoard((prev) => {
      const next = { ...prev, [stage]: prev[stage].filter((c) => c.id !== id) };
      saveBoard(next);
      return next;
    });
  }

  function updateNotes(stage: Stage, id: string, notes: string) {
    setBoard((prev) => {
      const next = {
        ...prev,
        [stage]: prev[stage].map((c) => (c.id === id ? { ...c, notes } : c)),
      };
      saveBoard(next);
      return next;
    });
  }

  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    setBoard((prev) => {
      const src = source.droppableId as Stage;
      const dst = destination.droppableId as Stage;
      const srcList = Array.from(prev[src]);
      const [moved] = srcList.splice(source.index, 1);

      if (src === dst) {
        srcList.splice(destination.index, 0, moved);
        const next = { ...prev, [src]: srcList };
        saveBoard(next);
        return next;
      }

      const dstList = Array.from(prev[dst]);
      dstList.splice(destination.index, 0, moved);
      const next = { ...prev, [src]: srcList, [dst]: dstList };
      saveBoard(next);
      return next;
    });
  }

  if (status === "loading") {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-gray-800 px-8 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-8">
          <h1
            className="text-xl font-bold cursor-pointer"
            onClick={() => router.push("/dashboard")}
          >
            Place<span className="text-blue-500">IQ</span>
          </h1>
          <div className="flex gap-4 flex-wrap">
            <button onClick={() => router.push("/dashboard")} className="text-sm text-gray-400 hover:text-white transition">
              Dashboard
            </button>
            <button onClick={() => router.push("/skills")} className="text-sm text-gray-400 hover:text-white transition">
              Skill Gap
            </button>
            <button onClick={() => router.push("/companies")} className="text-sm text-gray-400 hover:text-white transition">
              Companies
            </button>
            <button onClick={() => router.push("/roadmap")} className="text-sm text-gray-400 hover:text-white transition">
              Roadmap
            </button>
            <button onClick={() => router.push("/market")} className="text-sm text-gray-400 hover:text-white transition">
              Market
            </button>
            <button onClick={() => router.push("/resume")} className="text-sm text-gray-400 hover:text-white transition">
              Resume
            </button>
            <button className="text-sm text-white border-b border-blue-500 pb-0.5">
              Tracker
            </button>
            <button onClick={() => router.push("/oncampus")} className="text-sm text-gray-400 hover:text-white transition">
              On Campus
            </button>
            <button onClick={() => router.push("/offcampus")} className="text-sm text-gray-400 hover:text-white transition">
              Off Campus
            </button>
            <button onClick={() => router.push("/resources")} className="text-sm text-gray-400 hover:text-white transition">
              Resources
            </button>
            <button onClick={() => router.push("/coldemail")} className="text-sm text-gray-400 hover:text-white transition">
              Cold Email
            </button>
            <button onClick={() => router.push("/company-directory")} className="text-sm text-gray-400 hover:text-white transition">
              Directory
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <img src={session?.user?.image || ""} className="w-8 h-8 rounded-full" alt="" />
          <span className="text-gray-400 text-sm">{session?.user?.name}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-gray-500 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Page header */}
      <div className="px-8 py-6 shrink-0">
        <h2 className="text-2xl font-bold">Job Tracker</h2>
        <p className="text-gray-400 text-sm mt-1">
          Drag cards between columns to update application status.
        </p>
      </div>

      {/* Board */}
      {mounted && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex-1 overflow-x-auto px-8 pb-8">
            <div className="flex gap-4 h-full" style={{ minWidth: "max-content" }}>
              {COLUMNS.map((col) => {
                const cards = board[col.id];
                return (
                  <div
                    key={col.id}
                    className="flex flex-col bg-[#0d0d0d] border border-gray-800 rounded-2xl w-72 shrink-0"
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                        <span className={`text-sm font-semibold ${col.textColor}`}>
                          {col.label}
                        </span>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${col.badgeBg} text-gray-300`}>
                        {cards.length}
                      </span>
                    </div>

                    {/* Cards area */}
                    <Droppable droppableId={col.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 overflow-y-auto px-3 py-3 space-y-3 transition-colors min-h-[120px] ${
                            snapshot.isDraggingOver ? "bg-white/[0.02]" : ""
                          }`}
                        >
                          {cards.length === 0 && !snapshot.isDraggingOver && (
                            <div className="flex items-center justify-center h-20">
                              <p className="text-gray-700 text-xs text-center">
                                No companies here yet
                              </p>
                            </div>
                          )}
                          {cards.map((card, index) => (
                            <KanbanCard
                              key={card.id}
                              card={card}
                              col={col}
                              index={index}
                              onDelete={(id) => deleteCard(col.id, id)}
                              onNotesChange={(id, notes) => updateNotes(col.id, id, notes)}
                            />
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>

                    {/* Add card button */}
                    <div className="px-3 pb-3 shrink-0">
                      <button
                        onClick={() => setModal({ stage: col.id })}
                        className="w-full border border-dashed border-gray-700 hover:border-gray-500 text-gray-600 hover:text-gray-400 rounded-xl py-2.5 text-xs transition flex items-center justify-center gap-1.5"
                      >
                        <span className="text-base leading-none">+</span>
                        Add Card
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DragDropContext>
      )}

      {/* Modal */}
      {modal && (
        <AddModal
          stage={modal.stage}
          onAdd={(card) => addCard(modal.stage, card)}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  );
}
