// TerraVault — share-access
// Resolves a share link token and returns short-lived signed URLs.
// Private storage is never exposed directly: every request re-checks that the
// share is active, the signed-in user (if required) matches, and each asset
// is still shareable.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { token } = await req.json();
    if (typeof token !== "string" || token.length < 32 || token.length > 128) {
      return json({ error: "This link is invalid, expired or has been revoked." }, 404);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: share } = await admin.from("shares").select("*").eq("token", token).maybeSingle();
    if (
      !share || share.revoked_at ||
      (share.expires_at && new Date(share.expires_at).getTime() < Date.now())
    ) {
      return json({ error: "This link is invalid, expired or has been revoked." }, 404);
    }

    // Who is asking? (anonymous requests carry only the anon key, which is not a user JWT)
    let userEmail: string | null = null;
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (jwt) {
      const { data } = await admin.auth.getUser(jwt);
      userEmail = data?.user?.email?.toLowerCase() ?? null;
    }

    const named = !!share.shared_with_email;
    if (named) {
      if (!userEmail) {
        return json({ error: "sign_in_required", hint: maskEmail(share.shared_with_email) }, 401);
      }
      if (userEmail !== String(share.shared_with_email).toLowerCase()) {
        return json({ error: "wrong_account", hint: maskEmail(share.shared_with_email) }, 403);
      }
    } else if (share.require_auth && !userEmail) {
      return json({ error: "sign_in_required" }, 401);
    }

    const cols =
      "id,title,description,filename,storage_path,thumbnail_path,mime_type,file_size,category,confidentiality,status,deleted_at,creator,copyright_holder,usage_rights";
    let title = "";
    let kind: "asset" | "collection" = "asset";
    let rows: Record<string, any>[] = [];

    if (share.asset_id) {
      const { data } = await admin.from("assets").select(cols).eq("id", share.asset_id);
      rows = data ?? [];
      title = rows[0]?.title ?? "";
    } else {
      kind = "collection";
      const { data: col } = await admin.from("collections").select("name,description").eq("id", share.collection_id).maybeSingle();
      title = col?.name ?? "Shared collection";
      const { data: links } = await admin.from("collection_assets").select("asset_id").eq("collection_id", share.collection_id);
      const ids = (links ?? []).map((l: any) => l.asset_id);
      if (ids.length) {
        const { data } = await admin.from("assets").select(cols).in("id", ids);
        rows = data ?? [];
      }
    }

    // Open links never expose restricted or confidential files, even if they were
    // reclassified after the link was created.
    rows = rows.filter((a) =>
      !a.deleted_at && a.status !== "rejected" &&
      (named || ["public", "internal"].includes(a.confidentiality))
    );

    const items = [];
    for (const a of rows.slice(0, 200)) {
      const [view, thumb, dl] = await Promise.all([
        admin.storage.from("assets").createSignedUrl(a.storage_path, 900),
        a.thumbnail_path ? admin.storage.from("assets").createSignedUrl(a.thumbnail_path, 900) : Promise.resolve({ data: null }),
        share.allow_download
          ? admin.storage.from("assets").createSignedUrl(a.storage_path, 900, { download: a.filename })
          : Promise.resolve({ data: null }),
      ]);
      items.push({
        id: a.id,
        title: a.title,
        description: a.description,
        category: a.category,
        mime_type: a.mime_type,
        file_size: a.file_size,
        creator: a.creator,
        copyright_holder: a.copyright_holder,
        usage_rights: a.usage_rights,
        view_url: view.data?.signedUrl ?? null,
        thumbnail_url: (thumb as any).data?.signedUrl ?? null,
        download_url: (dl as any).data?.signedUrl ?? null,
      });
    }

    await admin.from("shares").update({ access_count: (share.access_count ?? 0) + 1 }).eq("id", share.id);
    await admin.from("activity_logs").insert({
      actor_name: userEmail ?? "Anonymous link visitor",
      action: "share.accessed",
      entity_type: kind,
      entity_id: share.asset_id ?? share.collection_id,
      entity_title: title,
      metadata: { named },
    });

    return json({
      share: {
        kind,
        title,
        note: share.note,
        allow_download: share.allow_download,
        expires_at: share.expires_at,
        named,
      },
      items,
    });
  } catch (_err) {
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
