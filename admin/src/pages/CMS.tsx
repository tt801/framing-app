import { useEffect, useState } from "react";
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  type Announcement,
} from "@/lib/api";
import { Plus, Trash2, Eye, EyeOff, RefreshCw, Pencil } from "lucide-react";

const SQL_SETUP = `-- Run this in your Supabase SQL editor:
CREATE TABLE platform_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  target_plan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_announcements ENABLE ROW LEVEL SECURITY;

-- Only service-role (API) can read/write
CREATE POLICY "service_role_only" ON platform_announcements
  USING (false);`;

export default function CMS() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [tableExists, setTableExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [creating, setCreating] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formPlan, setFormPlan] = useState<string>("");
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    listAnnouncements()
      .then((d) => {
        setTableExists(d.tableExists);
        setItems(d.announcements);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setFormTitle("");
    setFormBody("");
    setFormPlan("");
    setCreating(true);
  }

  function openEdit(a: Announcement) {
    setCreating(false);
    setFormTitle(a.title);
    setFormBody(a.body);
    setFormPlan(a.target_plan ?? "");
    setEditing(a);
  }

  function cancelForm() {
    setCreating(false);
    setEditing(null);
  }

  async function saveForm() {
    if (!formTitle.trim() || !formBody.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const d = await updateAnnouncement({
          id: editing.id,
          title: formTitle.trim(),
          body: formBody.trim(),
          targetPlan: formPlan || null,
        });
        setItems((prev) => prev.map((i) => (i.id === editing.id ? d.announcement : i)));
      } else {
        const d = await createAnnouncement({
          title: formTitle.trim(),
          body: formBody.trim(),
          isPublished: false,
          targetPlan: formPlan || null,
        });
        setItems((prev) => [d.announcement, ...prev]);
      }
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished(a: Announcement) {
    try {
      const d = await updateAnnouncement({ id: a.id, isPublished: !a.is_published });
      setItems((prev) => prev.map((i) => (i.id === a.id ? d.announcement : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await deleteAnnouncement(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (loading) return <div className="page-state">Loading…</div>;

  if (tableExists === false) {
    return (
      <div className="page">
        <div className="card">
          <h2 className="card-title">Setup Required</h2>
          <p className="text-muted" style={{ marginBottom: 12 }}>
            The <code>platform_announcements</code> table doesn't exist yet. Run the
            following SQL in your{" "}
            <a
              href="https://supabase.com/dashboard/project/jtohgliidkdexxajjgub/sql/new"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              Supabase SQL editor
            </a>{" "}
            to enable CMS:
          </p>
          <pre className="code-block">{SQL_SETUP}</pre>
          <button className="btn-primary mt-4" onClick={load}>
            Check again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <h2 className="toolbar-heading">Announcements</h2>
        <button className="btn-icon" onClick={load} title="Refresh">
          <RefreshCw size={14} />
        </button>
        <button className="btn-primary sm" onClick={openCreate}>
          <Plus size={14} /> New
        </button>
      </div>

      {/* Form panel */}
      {(creating || editing) && (
        <div className="card form-card">
          <h3 className="card-title">{editing ? "Edit announcement" : "New announcement"}</h3>
          <div className="form-grid">
            <div className="field-group full">
              <label className="field-label">Title</label>
              <input
                className="form-input"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Announcement title"
              />
            </div>
            <div className="field-group full">
              <label className="field-label">Body</label>
              <textarea
                className="form-textarea"
                rows={4}
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                placeholder="Announcement content…"
              />
            </div>
            <div className="field-group">
              <label className="field-label">Target plan (optional)</label>
              <select
                className="filter-select"
                value={formPlan}
                onChange={(e) => setFormPlan(e.target.value)}
              >
                <option value="">All users</option>
                <option value="trialing">Trialing</option>
                <option value="active">Active</option>
                <option value="past_due">Past due</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-ghost" onClick={cancelForm}>
              Cancel
            </button>
            <button
              className="btn-primary sm"
              onClick={() => void saveForm()}
              disabled={saving || !formTitle.trim() || !formBody.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Announcements list */}
      {items.length === 0 ? (
        <div className="page-state">No announcements yet. Create one above.</div>
      ) : (
        <div className="announcement-list">
          {items.map((a) => (
            <div key={a.id} className={`announcement-item${a.is_published ? " published" : ""}`}>
              <div className="announcement-content">
                <div className="announcement-title-row">
                  <span className="announcement-title">{a.title}</span>
                  {a.is_published ? (
                    <span className="badge badge-green">Published</span>
                  ) : (
                    <span className="badge badge-slate">Draft</span>
                  )}
                  {a.target_plan && (
                    <span className="badge badge-blue">{a.target_plan}</span>
                  )}
                </div>
                <p className="announcement-body">{a.body}</p>
                <p className="text-muted" style={{ fontSize: 11 }}>
                  Created {new Date(a.created_at).toLocaleDateString()} · Updated{" "}
                  {new Date(a.updated_at).toLocaleDateString()}
                </p>
              </div>
              <div className="announcement-actions">
                <button
                  className="btn-icon"
                  title={a.is_published ? "Unpublish" : "Publish"}
                  onClick={() => void togglePublished(a)}
                >
                  {a.is_published ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  className="btn-icon"
                  title="Edit"
                  onClick={() => openEdit(a)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="btn-icon danger"
                  title="Delete"
                  onClick={() => void remove(a.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
