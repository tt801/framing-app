import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requirePlatformAdmin, supabaseAdmin, platformAdminError } from "../_lib/platformAdmin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await requirePlatformAdmin(req);
  } catch (err) {
    const { status, message } = platformAdminError(err);
    return res.status(status).json({ error: message });
  }

  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("platform_announcements")
        .select("id,title,body,is_published,target_plan,created_at,updated_at")
        .order("created_at", { ascending: false });

      if (error) {
        // Table likely doesn't exist yet
        if (
          error.code === "42P01" ||
          error.message?.toLowerCase().includes("does not exist") ||
          error.message?.toLowerCase().includes("platform_announcements")
        ) {
          return res.status(200).json({ announcements: [], tableExists: false });
        }
        throw error;
      }

      return res.status(200).json({ announcements: data ?? [], tableExists: true });
    }

    if (req.method === "POST") {
      const { title, body, isPublished = false, targetPlan = null } = req.body || {};
      if (!title || !body) {
        return res.status(400).json({ error: "title and body are required" });
      }

      const { data, error } = await supabaseAdmin
        .from("platform_announcements")
        .insert({ title, body, is_published: isPublished, target_plan: targetPlan })
        .select("id,title,body,is_published,target_plan,created_at,updated_at")
        .single();

      if (error) throw error;
      return res.status(201).json({ announcement: data });
    }

    if (req.method === "PATCH") {
      const { id, title, body, isPublished, targetPlan } = req.body || {};
      if (!id) return res.status(400).json({ error: "id is required" });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title !== undefined) updates.title = title;
      if (body !== undefined) updates.body = body;
      if (isPublished !== undefined) updates.is_published = isPublished;
      if (targetPlan !== undefined) updates.target_plan = targetPlan;

      const { data, error } = await supabaseAdmin
        .from("platform_announcements")
        .update(updates)
        .eq("id", id)
        .select("id,title,body,is_published,target_plan,created_at,updated_at")
        .single();

      if (error) throw error;
      return res.status(200).json({ announcement: data });
    }

    if (req.method === "DELETE") {
      const rawId = req.query.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!id) return res.status(400).json({ error: "id is required" });

      const { error } = await supabaseAdmin
        .from("platform_announcements")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    const { status, message } = platformAdminError(err);
    return res.status(status).json({ error: message });
  }
}
