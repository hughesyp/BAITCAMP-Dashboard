// Sends a post to Blotato, one submission per selected platform.
// Body: { post_id: string }
// Account mapping lives in integration_settings key "blotato":
//   { facebook: { accountId, pageId }, instagram: { accountId }, linkedin: { accountId, pageId? }, ... }
import { blotato, getCaller, getSetting, HttpError, serve } from "../_shared/common.ts";

const VIDEO = /\.(mp4|mov|m4v|webm)(\?|$)/i;

function buildTarget(platform: string, acct: any, t: any, hasVideo: boolean) {
  const opts = t.options ?? {};
  switch (platform) {
    case "facebook": {
      if (!acct.pageId) throw new Error("Facebook page is not chosen in Settings");
      const target: any = { targetType: "facebook", pageId: acct.pageId };
      if (hasVideo) target.mediaType = "reel";
      if (t.first_comment) target.firstComment = t.first_comment;
      return target;
    }
    case "instagram": {
      const target: any = { targetType: "instagram" };
      if (hasVideo) target.mediaType = "reel";
      if (t.first_comment) target.firstComment = t.first_comment;
      return target;
    }
    case "linkedin":
      return acct.pageId ? { targetType: "linkedin", pageId: acct.pageId } : { targetType: "linkedin" };
    case "threads":
      return { targetType: "threads" };
    case "twitter":
      return { targetType: "twitter" };
    case "tiktok":
      return {
        targetType: "tiktok",
        privacyLevel: opts.privacyLevel ?? "PUBLIC_TO_EVERYONE",
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: true,
        isAiGenerated: !!opts.isAiGenerated,
      };
    default:
      throw new Error(`Unsupported platform ${platform}`);
  }
}

serve(async (req, body, db) => {
  const caller = await getCaller(req, db);
  if (!body.post_id) throw new HttpError(400, "post_id is required");

  const { data: post } = await db.from("posts").select("*, post_targets(*)").eq("id", body.post_id).single();
  if (!post) throw new HttpError(404, "Post not found");
  if (caller.role !== "admin" && post.author_id !== caller.id) throw new HttpError(403, "Not your post");

  const accounts = await getSetting<Record<string, any>>(db, "blotato");
  const mediaUrls: string[] = post.media_urls ?? [];
  const hasVideo = mediaUrls.some((u) => VIDEO.test(u));
  const scheduled = post.scheduled_at && new Date(post.scheduled_at).getTime() > Date.now() + 60000;

  const results: any[] = [];
  for (const t of post.post_targets ?? []) {
    if (!["draft", "failed"].includes(t.status)) continue; // never double-post
    try {
      const acct = accounts[t.platform];
      if (!acct?.accountId) throw new Error(`No Blotato account is linked for ${t.platform} (admin: Settings)`);

      // Platforms without a native first comment get it as a reply in the thread where supported.
      const content: any = { text: t.caption, mediaUrls, platform: t.platform };
      if (t.first_comment && ["threads", "twitter"].includes(t.platform)) {
        content.additionalPosts = [{ text: t.first_comment, mediaUrls: [] }];
      }
      const payload: any = {
        post: { accountId: acct.accountId, content, target: buildTarget(t.platform, acct, t, hasVideo) },
      };
      if (scheduled) payload.scheduledTime = new Date(post.scheduled_at).toISOString();

      const res = await blotato("/posts", { method: "POST", body: JSON.stringify(payload) });
      await db.from("post_targets").update({
        status: scheduled ? "scheduled" : "in-progress",
        blotato_submission_id: res.postSubmissionId,
        error_message: null,
      }).eq("id", t.id);
      results.push({ platform: t.platform, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("post_targets").update({ status: "failed", error_message: msg }).eq("id", t.id);
      results.push({ platform: t.platform, ok: false, error: msg });
    }
  }

  const anyOk = results.some((r) => r.ok);
  const anyFail = results.some((r) => !r.ok);
  await db.from("posts").update({
    status: !anyOk ? "failed" : anyFail ? "partial" : scheduled ? "scheduled" : "queued",
  }).eq("id", post.id);

  return { ok: anyOk, results };
});
