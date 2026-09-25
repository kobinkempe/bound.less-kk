# -*- coding: utf-8 -*-
"""Per-function entries for the cloud: canvasSync.js (the kobin-2 mirror, the lease
transactions, the old lz1 copy), canvasSession.js (one editor at a time), syncCore.js,
store2.js, gzip.js and lzWorker.js."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/cloud/canvasSync.js ----
add("cld.isDevBuild", "isDevBuild(env, host)",
    "Whether this is a development build, which reads and writes `dev-canvases` instead of the deployed app's `canvases`.",
    ["Real only for a `production` build served from the deployed app's own hosts (`REAL_HOSTS`: bound-less-kk.web.app, bound-less-kk.firebaseapp.com); every other build or host (the dev server, a test, localhost, a LAN address, a Hosting preview channel) is development. Evaluated once at load to fix `CANVAS_COLLECTION`, which every manifest, part and collection builder uses (DESIGN.md §13).",
     "The dev server and the deployed app share one Firebase project, so this is what keeps a development build out of the real collection. The gallery skips its bulk catch-up when it is true, and the editor's dev panel offers Copy real."],
    "§13")
add("cld.realCanvasDoc", "realCanvasDoc(uid, id)",
    "A canvas's manifest in the REAL collection, for a development build's read-only Copy real.",
    ["The one manifest builder that names `canvases` whatever the build. Only `cloudPullCanvas2` with `real` reads through it; nothing writes through it (DESIGN.md §13)."],
    "§13")
add("cld.realPartDoc2", "realPartDoc2(uid, id, chunkId, i)",
    "One kobin-2 chunk part in the REAL collection, read by Copy real in a development build.",
    ["-"], "§13")
add("cld.chunk", "chunk(u8)",
    "Cuts lz1-compressed bytes into 700 KiB parts for the old lz1 copy, always at least one.",
    ["Returns `{ codec: \"lz1\", chunks }`, each chunk a `subarray` view of the input: the shared tail of `encodeCanvasPayload` and `encodeCanvasPayloadAsync`."],
    "§13")
add("cld.encodeCanvasPayloadAsync", "encodeCanvasPayloadAsync(json)",
    "The lz1 encoder with the lz-string compression in a worker where one loads; what `saveCanvasLz1` writes.",
    ["Compresses through `lzWorker.compressToUint8Array`, then cuts with `chunk`. The code records the reason: on the phone the compressor was 97% of a multi-second save freeze (F33).",
     "A job the worker ran and failed is not retried on the main thread (OPEN-FLAGS F64); only a missing worker falls back."],
    "§13")
add("cld.decodeCanvasPayloadAsync", "decodeCanvasPayloadAsync(parts, codec)",
    "Turns an lz1 copy's parts back into kobin-1 JSON, decompressing in the worker; legacy string parts are joined as text.",
    ["`codec` comes from the parent doc: `lz1` joins the byte parts and decompresses them through `lzWorker`; anything else takes the parts as plain strings, a non-string part reading as empty. `cloudLoadCanvas` calls it."],
    "§13")
add("cld.cloudSaveCanvas", "cloudSaveCanvas(uid, entry, json, thumbs, { laneMs })",
    "Writes the old lz1 whole copy of a canvas still in the v1 local store, in the page's one push lane.",
    ["Queues `saveCanvasLz1` in `inLane` with the lane's deadline (`laneMs`), so it never runs beside a kobin-2 push. Its one caller is the production gallery's catch-up, for a local canvas the account does not know and that is not in the kobin-2 store; the first kobin-2 push replaces the lz1 copy (DESIGN.md §13)."],
    "§13")
add("cld.saveCanvasLz1", "saveCanvasLz1(uid, entry, json, thumbs, run)",
    "The lz1 whole-copy write: lz-string parts one a commit, then the parent in a transaction that refuses a kobin-2 copy.",
    ["**Parts first, the parent LAST.** Readers key off the parent's part count and codec, so a torn save never looks complete: it looks like the previous save. `SyncConflict` when the copy is kobin-2, checked before the parts go up and again in the parent's transaction, which also deletes parts beyond the new count. The thumbnails are merged over the stored set within the parent's budget.",
     "Each part commit marks progress on its lane run (`run.tick`); once the lane has let it go past its deadline it throws `PushDead` and writes nothing more."],
    "§13")
add("cld.perfNow", "perfNow()",
    "A millisecond clock for the save timings: `performance.now()`, or `Date.now()` where there is none.",
    ["-"], "")
add("cld.partDoc2", "partDoc2(uid, id, chunkId, i)",
    "One part of a kobin-2 chunk: `parts/<chunkId>~<i>` under the canvas's manifest, in this build's collection.",
    ["-"], "§13")
add("cld.chunkKey", "chunkKey(s)",
    "Makes a frame id or an epoch safe inside a Firestore document id, for the chunk ids a push names.",
    ["`/` becomes `.`, `,` becomes `_`, and any other character outside `A-Za-z0-9_-` becomes `-`, so a frame id such as `0/3,-1#1` names a part document without a path separator."],
    "§13")
add("cld.SyncConflict", "SyncConflict",
    "The error a push throws when the cloud head is no longer this device's base: the copy moved under it.",
    ["Carries the cloud's `head`. `pushCanvas2` checks before any part is written and again inside the manifest's transaction, so a refused push has touched nothing a manifest names. `saveCanvasLz1` throws it rather than write an lz1 copy over a kobin-2 one.",
     "The session answers it by giving up the pen (`CanvasSession._lose`)."],
    "§13")
add("cld.SyncConflict.constructor", "SyncConflict.constructor(why, head)",
    "Names the error and keeps the cloud head it was refused against (null when none).",
    ["-"], "§13")
add("cld.LeaseLost", "LeaseLost",
    "The error a push throws when the manifest's lease is not the epoch this device holds: another device or tab has the pen.",
    ["Carries the lease it found (`holder`), which the session names on the chip when it goes read-only. `pushCanvas2` also throws it with no holder when the local store refuses the push's bookkeeping as another tab's (`\"fenced\"`), or when `source.alive()` says another tab claimed the store mid-push."],
    "§13")
add("cld.LeaseLost.constructor", "LeaseLost.constructor(holder)",
    "Names the error and keeps the lease that holds the pen (null when none).",
    ["-"], "§13")
add("cld.commitAll", "commitAll(items, per, fn, before)",
    "Applies one write per item in sequential batches of `per`, each committed before the next starts.",
    ["`before`, when given, runs ahead of each commit and may throw to stop the rest: the push uses it to mark lane progress and to stop once the store is another tab's or the lane has let it go.",
     "Parts go up one a commit (`PARTS_PER_COMMIT`), deletes 400 a commit. Measured 2026-09-08 on the 12,849-object canvas: six parts a batch had Firestore's write stream answering `resource-exhausted` on every batch (DESIGN.md §13)."],
    "§13")
add("cld.inLane", "inLane(fn, opts)",
    "Runs a cloud write in the page's one push lane: one at a time, from any session or canvas, each queued behind the last.",
    ["Firestore's write stream refuses overlapping uploads (DESIGN.md §13), and a session restarted mid-push (Fast Refresh, a remount) queues behind the old one. `fn(run)` gets a `run` whose `tick()` marks progress; after `ms` (5 min) without one the run is marked `dead` and the next write goes, so a slow push that keeps committing keeps the lane and a stuck one does not. `onStart` is called as the write leaves the queue. Resolves or rejects as `fn` does."],
    "§13")
add("cld.pushDead", "pushDead()",
    "The error (named `PushDead`) a push throws once the lane has let it go, so a commit that answers late writes nothing more.",
    ["-"], "§13")
add("cld.chunksOf", "chunksOf(m)",
    "Every chunk a kobin-2 manifest names, frame snapshots then log runs, as `{ chunk, parts }`.",
    ["What a push keeps, sweeps and deletes is computed against it: a chunk the written manifest does not list is garbage."],
    "§13")
add("cld.partsOf", "partsOf(uid, id, chunks)",
    "The document reference of every part of the given chunks, for a batched delete.",
    ["-"], "§13")
add("cld.cloudPushCanvas2", "cloudPushCanvas2(uid, entry, source, opts)",
    "Mirrors the local kobin-2 store into the cloud: queues `pushCanvas2` in the page's one push lane.",
    ["`opts.laneMs` is the lane's no-progress limit (5 min by default; the session passes its push deadline) and `opts.onStart` is called when the push leaves the queue; the other options go to `pushCanvas2`. Resolves or throws as it does. Callers: the session's `_push` and the production gallery's catch-up."],
    "§13")
add("cld.pushCanvas2", "pushCanvas2(uid, entry, source, opts, run)",
    "One push of the local kobin-2 store: changed frames and new log entries as gzipped chunks, then the manifest in a checked transaction.",
    ["In order: reads the manifest; reads from the local store, in one transaction (`source.read`), the header, the frames whose snapshot seq differs from the cloud's and the entries past the cloud's seq; checks the manifest (the cloud head must be the local `base`, else `SyncConflict`; the lease must be `epoch`, else `LeaseLost`; no copy or an lz1 copy is not checked); gzips each frame and the run of entries, one chunk each, split into 700 KiB parts; adds the chunks to `pending` and records the `intent`; writes the parts one a commit; writes the manifest in a transaction that repeats the check; records the new `base`; deletes the parts of the chunks it replaced, and an lz1 copy's parts, then drops them from `pending`.",
     "**A push never overwrites** (DESIGN.md §13). Every chunk id is this push's alone, its epoch and a random nonce (`f_<frame>_<seq>_<epoch>_<nonce>`, `l_<from>_<to>_<epoch>_<nonce>`), so a refused push leaves only parts no manifest names, which the next push sweeps from `pending`. An intent that landed (`intentLanded`: a push whose manifest was written after its tab closed) counts as the base.",
     "Before each part commit it ticks the lane and stops with `LeaseLost` when `source.alive()` says another tab claimed the store, or with `PushDead` once the lane has let it go; a store fenced at the bookkeeping step stops it before any part. A push let go after its manifest landed skips the deletes, leaving them pending for the next push's sweep.",
     "The head is kept only when nothing went up and the seq has not moved (a rename, a camera); chunks uploaded at an unchanged seq get a head of their own (epoch `<epoch>.<nonce>`). The manifest keeps the cloud's lease; `lease` is written only when this push creates the copy or replaces an lz1 one. A transaction that throws re-reads the manifest: when its head is this push's the commit landed and the push goes on, otherwise it sweeps its parts and rethrows. Log chunks wholly below `dropBelow` (the saver's compaction floor) leave the manifest. The older source shape (`header`, `readFrames`, `readLog`) is still accepted."],
    "§13")
add("cld.sweep", "sweep(uid, id, pending, manifest, setSync)",
    "Deletes a refused push's pending chunks that the current manifest does not name, and drops them from `pending`.",
    ["The chunks the manifest names stay pending. A failed delete leaves every one in `pending` for the next push to try again."],
    "§13")
add("cld.cloudPullCanvas2", "cloudPullCanvas2(uid, id, opts)",
    "Reads the kobin-2 cloud copy in the local store's shape; with `have`, only the changed frames and the entries past its seq.",
    ["Reads the manifest (null when there is none or it is not kobin-2), then each frame chunk whose snapshot seq differs from `have.frameSeq`, then the log chunks in seq order, keeping the entries past `have.seq`. A chunk's parts are read in parallel, joined, decompressed by the manifest's codec (`gunzipAs`) and unpacked. Returns `{ header, frames, entries, head, full, thumbs, meta }`; `full` is true without `have`.",
     "A missing part throws, naming it. `real` reads the real collection from a development build (Copy real); nothing is written there."],
    "§13")
add("cld.cloudLoadCanvas2", "cloudLoadCanvas2(uid, id, opts)",
    "The whole kobin-2 cloud copy, every frame and entry: `cloudPullCanvas2` without a local copy.",
    ["The dev panel's Copy real calls it with `real` to bring a canvas from the deployed app's collection in as a new local canvas."],
    "§13")
add("cld.leaseFor", "leaseFor({ ... }, now, ttl)",
    "A new lease for a device and tab: a fresh epoch and an expiry `ttl` past this device's clock.",
    ["Every take mints a new epoch; the holder's pushes name it, which is what tells two histories at the same seq apart (DESIGN.md §13)."],
    "§13")
add("cld.cloudTakeLease", "cloudTakeLease(uid, id, who, opts)",
    "Takes the pen in a transaction when `leaseState` calls the lease free, when forced, or when it is still the stale one a follower watched.",
    ["No cloud copy answers `{ ok: true, absent }` and an lz1 copy `{ ok: true, legacy }`, with no lease written. Otherwise it writes a new lease (`leaseFor`) and returns it with the head, or `{ ok: false, holder, head }` while another device holds it. Another device's live lease is free only `skewMs` (5 min) past its `until`, which is the holder's clock.",
     "`ifLease` is a lease a read-only follower saw unchanged for a whole TTL of its own clock; it is taken only if the same epoch and `until` are still there, so a renewal that landed meanwhile wins. A lease let go to an asker (`to`) who never took it falls back the same way (SYNC-PLAN §6)."],
    "§13")
add("cld.cloudRenewLease", "cloudRenewLease(uid, id, epoch, opts)",
    "The holder's beat: extends its lease `ttl` past now in a transaction and reports another device's `want`.",
    ["Refuses (`{ ok: false, lost, holder }`) when the lease is no longer `epoch` or was let go (`until` 0), and answers `absent` when the copy is gone. The session calls it every 20 s while visible; each renewal sets `until` 90 s past the holder's clock (`LEASE_TTL_MS`), and another device treats the lease as dead unasked only 5 min past that (`leaseState`) or after watching it unchanged for 90 s of its own clock (`CanvasSession._maybeTake`)."],
    "§13")
add("cld.cloudReleaseLease", "cloudReleaseLease(uid, id, epoch, opts)",
    "Lets go of the pen by setting the lease's `until` to 0, if the lease is still `epoch`; `to` reserves it for the device that asked.",
    ["The lease record stays, `want` included, so the device that asked sees the release on its manifest watch. The session's hand-over (`_handToDevice`) passes the asker as `to`, and `leaseState` then answers `reserved` (not free) to every other device, the releasing one included. Returns whether it wrote."],
    "§13")
add("cld.cloudAskLease", "cloudAskLease(uid, id, who, opts)",
    "\"Edit here\" from another device: takes the pen at once when free, otherwise writes `want` onto the holder's lease.",
    ["Free is `leaseState`'s: another device's live lease counts as free only 5 min past its `until`. The holder sees `want` on its manifest watch or its next beat, pushes and lets go; the asker takes the lease anyway after a wait (`CanvasSession.takeOver`). Returns `{ ok, lease, head }` or `{ ok: false, asked, holder, head }`."],
    "§13")
add("cld.cloudWatchManifest", "cloudWatchManifest(uid, id, onChange, onError)",
    "Subscribes to one canvas's manifest, calling `onChange` with it (or null) on every change; returns the unsubscribe.",
    ["How the holder sees a `want` or a lost lease, and a read-only device sees the head move, between beats."],
    "§13")

# ---- src/cloud/canvasSession.js ----
add("css.editorFromHook", "editorFromHook(get)",
    "Adapts the editor hook's API to the session's `editor` interface, reading the hook afresh on every call.",
    ["`get()` returns the hook's latest object, a new one each render. The methods map to the hook's `setReadOnly`, `setSaving`, `setWriter`, `flushSave`, `idle`, `reloadFromStore`, `refreshMetaFromStore` (as `refreshMeta`), `hasUnsaved`, `keepUnsaved`, `knownSeq`, `cloudPushSource` and `stats`, each a no-op or a resolved default when the hook lacks it."],
    "§13")
add("css.withTimeout", "withTimeout(p, ms, why)",
    "Rejects with a `Timeout` error after `ms` unless the promise (or plain value) settles first; the work itself runs on.",
    ["-"], "")
add("css.perfNow", "perfNow()",
    "A millisecond clock for the session's perf log: `performance.now()`, or `Date.now()` where there is none.",
    ["-"], "")
add("css.who", "who(s)",
    "The session's identity as a lease holder: device id, tab id and the device's display name.",
    ["-"], "§13")
add("css.shownName", "shownName(entry, local)",
    "A canvas's name for notices and kept copies: the gallery's, then the stored header's, never the engine's default \"untitled\".",
    ["-"], "§13")
add("css.isNetwork", "isNetwork(err)",
    "Whether an error means the cloud is out of reach (a timeout, unavailable, offline, a failed fetch) rather than something wrong.",
    ["An open or a catch-up that fails this way goes on editing offline and retries; any other failure blocks it (`_blocked`)."],
    "§13")
add("css.CanvasSession", "CanvasSession",
    "One open editor's part in one editor at a time: holds or follows the device lock and the cloud lease, reconciles versions, pushes.",
    ["On the device the pen is the lock `boundless:canvas:<id>` (Web Locks, or `storageLocks.js` without them); in the cloud it is the manifest's lease. A tab or device without it is read-only and follows the holder: a same-device tab reloads the store when the holder posts \"saved\" (only the header when the write moved no data), another device pulls when the manifest's head moves (DESIGN.md §13).",
     "**The fence.** Every grant bumps a generation and claims the local store with a writer token (`claimStore`); every store write carries the token and is refused once another tab has claimed; every flow checks its generation after each `await` (`_live`); a lost lock is dropped synchronously (`_drop`). The saver stays off from the grant until `_edit`.",
     "Work that cannot be written here is kept as a new canvas (`_keepUnsaved`); a local copy that cannot be kept blocks the pull that would replace it. `CanvasEditor` creates the session once the document is restored and sign-in has resolved; `env` injects `locks`, `Channel`, `now` and `visible` for the two-tab and two-device tests."],
    "§13")
add("css.CanvasSession.constructor", "CanvasSession.constructor(opts)",
    "Stores the canvas, device and tab ids, the editor adapter and the environment, and starts in mode `starting` at generation 0.",
    ["`env.locks` defaults to `navigator.locks`, else `makeStorageLocks()` over localStorage. `opts` overrides `SESSION_DEFAULTS`: beat 20 s, lease 90 s, skew margin 5 min, background push 30 s, \"Edit here\" forced after 6 min, tab steal after 5 s, open timeout 4 s, open retry 20 s doubling to 10 min, push deadline 5 min (also the push lane's no-progress limit), a follow at most every 2 s or ten times the last reload. It also sets up the follow bookkeeping: whether a same-device write moved data since the last reload, and a follow asked for while one runs."],
    "§13")
add("css.start", "start()",
    "Opens the channel and asks for the device lock without waiting: with it the tab holds the device, without it follows.",
    ["-"], "§13")
add("css.stop", "stop()",
    "Leaving the editor: a last flush while the tab still holds the store, a last push, the lease let go, then the device lock.",
    ["In order: an editing (or handing-over) lock holder flushes (10 s at most) and keeps the document as a new canvas if the flush reports failure; timers, the manifest watch and a queued lock request are cleared; the last push runs for dirty edits (never for a discarded canvas) and the lease is released after it, which `stop` does not wait for; the hook's whole write chain is awaited (`idle`, 10 s at most); the lock is let go.",
     "The lock goes last because a new holder reading the store earlier would continue the log at seqs the old holder's last write then overwrites."],
    "§13")
add("css.markDirty", "markDirty()",
    "Notes that the document changed, so the cloud copy is behind.",
    ["-"], "§13")
add("css.onLocalSaved", "onLocalSaved(seq, opts)",
    "The saver wrote the store: marks the cloud behind and posts \"saved\" so same-device read-only tabs follow.",
    ["`data: false` (a camera, a name) tells the followers to read only the header rather than reload the drawing."],
    "§13")
add("css.onRefused", "onRefused(kind)",
    "The saver's write was refused: the work in memory is kept as a new canvas, then the tab follows or reloads.",
    ["`fenced` (another tab has claimed the store): after keeping the work, a tab that still thinks it holds the lock drops it (`_lockLost`) and follows. `stale` (the store is ahead of this document): the saver goes off, the store is reloaded keeping the camera, and the saver comes back on if the tab is still editing."],
    "§13")
add("css.onVisibility", "onVisibility(visible)",
    "Tab shown: runs a follow owed while hidden and beats at once. Tab hidden: pushes an editing tab's unpushed edits.",
    ["-"], "§13")
add("css.pushNow", "pushNow(opts)",
    "An explicit Save: a forced push with the thumbnails; refused signed out, read-only, or with a push in flight.",
    ["Returns `{ ok: false }` with `local`, `readOnly` or `busy` in those cases. Forced, it ignores the failure backoff."],
    "§13")
add("css.takeOver", "takeOver()",
    "\"Edit here\": asks whoever has the pen to save and let go, and takes it anyway after a wait.",
    ["Refused while starting, editing or already taking; clears the chip's error. A tab follower posts `want` on the channel and steals the lock after 5 s of silence. A device follower calls `cloudAskLease`: a free lease is taken at once and the session promoted; otherwise it waits in mode `taking`, watching the manifest, while the holder keeps renewing as it saves, pushes and lets go to it.",
     "The wait ends when `_maybeTake` sees the lease let go to this device, or unchanged for a TTL (a holder gone silent; the beat polls the manifest for that), or with a forced take after 6 min. A failure to reach the cloud leaves it read-only with an error."],
    "§13")
add("css._openChannel", "_openChannel()",
    "Opens the BroadcastChannel named after the lock: the same-device tabs' line for \"want\", \"saved\" and \"released\".",
    ["-"], "§13")
add("css._post", "_post(msg)",
    "Posts a message on the channel stamped with this tab's id; nothing when there is no channel.",
    ["-"], "§13")
add("css._onMessage", "_onMessage(msg)",
    "Answers another tab: \"want\" makes the lock holder hand over at once; \"saved\" schedules a follower's `_reloadFollow`.",
    ["A \"saved\" that moved data marks a whole reload owed until one runs, whatever header-only writes come after. The hand-over does not wait behind the serial chain."],
    "§13")
add("css._requestLock", "_requestLock({ ... })",
    "Requests the device lock: now or not at all, queued until the holder lets go, or stolen; resolves whether it was granted.",
    ["Each request has an id; a queued one also carries an AbortController and a `done` promise that settles `granted`, `none` or `aborted`. A granted lock is held by a promise `_letGoOfLock` resolves. A grant that lands after `stop()`, or while this tab already holds the lock through another request, is let go at once (seen in Chrome after a Fast Refresh).",
     "When the held request rejects, the lock was stolen: `_lockLost` runs at once, not behind the serial chain."],
    "§13")
add("css._drop", "_drop()",
    "Drops the lock and everything that rode on it at once: generation bumped, token cleared, saver off, read-only, cloud work stopped.",
    ["Synchronous, so a flow still inside an `await` finds its generation stale (`_live`) and stops, and nothing it does afterwards writes."],
    "§13")
add("css._letGoOfLock", "_letGoOfLock()",
    "Drops everything held on the lock, then releases it by resolving the promise that holds it.",
    ["-"], "§13")
add("css._lockLost", "_lockLost(why)",
    "The lock went to another tab (stolen, or the store fenced): everything dropped at once, a notice, unsaved work kept, then follow.",
    ["Whether there is unsaved work is read before the drop; that work is kept as a new canvas before the tab becomes a follower."],
    "§13")
add("css._stealLock", "_stealLock()",
    "Takes the device lock from a holder that did not answer \"want\" within 5 s, then holds the device.",
    ["Aborts this tab's own queued request first and waits for its outcome: if that request was granted meanwhile, nothing is stolen. The tab it is taken from drops everything (`_lockLost`) and writes nothing more."],
    "§13")
add("css._tabFollower", "_tabFollower()",
    "A tab without the device lock: read-only, saver off, following the holder through the store, queued for the lock.",
    ["When the queued lock is granted (the holder closed or handed over) the tab holds the device, reloading the store first."],
    "§13")
add("css._live", "_live(g)",
    "Whether a flow started at generation `g` may go on: not stopped, still holding the lock, the generation unchanged.",
    ["Checked after every `await` in the flows that write."],
    "§13")
add("css._holdDevice", "_holdDevice({ ... })",
    "This tab holds the device lock: claims the store with a new token, catches up with it, then lets the cloud decide whether it edits.",
    ["Bumps the generation, sets the token `<tab>.<generation>` on the hook (`setWriter`) and on the stored header (`claimStore`), with the saver off and the editor read-only. Reloads from the store when the lock came from another tab or the stored seq differs from the editor's. Signed out it edits at once; signed in it starts the lease beat, the 30 s background push while dirty and the manifest watch, then `_openCloud`."],
    "§13")
add("css._handToTab", "_handToTab()",
    "Another tab asked for the pen: read-only, flush, let go of the lock, post \"released\", follow.",
    ["Runs at once, one at a time. A failed flush keeps the document as a new canvas first; a tab that lost the lock meanwhile stops there. The cloud lease is not released: it is this device's, and the device lock decides which of its tabs holds it."],
    "§13")
add("css._stopCloud", "_stopCloud()",
    "Clears the session's timers and the manifest watch, and forgets a scheduled follow whose timer went with them.",
    ["-"], "§13")
add("css._openCloud", "_openCloud(g)",
    "At open: reads the manifest, takes the lease if it can, reconciles versions, then edits or follows another device.",
    ["The manifest read has 4 s; any failure of it counts as offline, and the tab edits with `needOpen` set so a later beat reopens. With no kobin-2 copy (none, or an lz1 one) it mints `createLease`, which the first push writes. A lease taken by a flow that went stale meanwhile is released again.",
     "Any other failure, or a reconcile that could not keep the local copy, blocks the open (`_blocked`). A live lease on another device leaves the tab read-only after reconciling, naming the holder."],
    "§13")
add("css._blocked", "_blocked(message)",
    "The cloud open cannot finish (an error, or a local copy that could not be kept): read-only, saver off, shown, retried.",
    ["Sets `needOpen` and the next try 20 s later, doubling per failure up to 10 min; the beat reopens then."],
    "§13")
add("css._reconcile", "_reconcile(g, opts)",
    "Compares the local base with the cloud head through `decideOpen` and acts; answers `ok`, `blocked` or `gone`.",
    ["A base `decideOpen` recovers is written to the local header first, under the token. `push` only marks the session dirty; `pull` is incremental unless `full`; `stash` and `conflict` keep the local store (`_keepStore`) and then pull the cloud's whole, and are `blocked` when it could not be kept; `legacy` takes the lz1 path. The camera is kept except at open."],
    "§13")
add("css._pull", "_pull(g, { ... })",
    "Downloads the cloud head into the local store and reloads the editor from it; incremental unless `full`.",
    ["An incremental pull passes the local frame seqs and seq as `have`; a refused incremental apply is repeated whole, and a fenced store or a refused whole apply blocks. Records the cloud head as the new `base`, saves the thumbnails, updates the gallery row (the cloud's name unless it is \"untitled\"), reloads, and posts \"saved\" so same-device tabs follow."],
    "§13")
add("css._keepStore", "_keepStore(g, kind, local)",
    "Before a pull replaces the local store, keeps it whole: in the recycle bin (`stash`) or as a new canvas (`conflict`).",
    ["Flushes first (a failed flush keeps the document in memory as a new canvas). `stash` copies the store to \"<name> (overwritten)\" in the bin; `conflict` forks it as \"<name> — edits from <device>, <date>\" without its cloud lineage. Answers true, false when nothing landed (the open is blocked and the pull must not happen), or `gone`."],
    "§13")
add("css._pullLz1", "_pullLz1(g, local, m)",
    "An lz1 cloud copy: the newer of it and the local copy wins by `savedAt`, and the other is kept as a canvas of its own.",
    ["Local newer: the older cloud copy, if it has strokes, is kept as \"<name> — the older cloud copy, <date>\", and the session is marked dirty so the first push replaces the lz1 copy. Cloud newer: an empty cloud copy never replaces a local one; otherwise the local store goes to the recycle bin (`_keepStore`), then the lz1 drawing is written with its gallery name and the editor reloaded without keeping the camera. A copy that could not be kept blocks."],
    "§13")
add("css._keepUnsaved", "_keepUnsaved()",
    "The document in memory as a new canvas, \"<name> — unsaved edits from <device>, <date>\", when it could not be written here.",
    ["Nothing when there is nothing unsaved. When even that copy fails, the notice points at downloading from the ⋮ menu. Returns the new index entry or null."],
    "§13")
add("css._edit", "_edit(g)",
    "Lets the tab edit: saver on, read-only off, mode `editing`, with the chip's cloud state; nothing for a stale generation.",
    ["The cloud state is `off` signed out, `offline` while the open is owed (its error kept), `local` for a canvas not yet in the gallery, otherwise `saving` or `saved`."],
    "§13")
add("css.discard", "discard()",
    "The canvas was deleted: nothing more goes up, not even the last push on leaving.",
    ["-"], "§13")
add("css._readOnlyDevice", "_readOnlyDevice(holder)",
    "Another device has the pen: read-only, saver off, the epoch dropped, the chip naming the holder.",
    ["-"], "§13")
add("css._offline", "_offline(err)",
    "Marks the cloud unreachable on the chip, with the error's first 120 characters.",
    ["-"], "§13")
add("css._beat", "_beat()",
    "The visible lock holder's periodic cloud step: watch an asked-for lease, reopen, follow, or renew the lease and answer a `want`.",
    ["Runs every 20 s and when the tab is shown; skipped hidden, signed out or without the lock. While \"Edit here\" waits it reads the manifest for `_maybeTake`. An owed open waits for its retry time, flushes an editing tab (keeping unsaved work if that fails) and reopens. A read-only device schedules a follow. An editor renews: a refusal means the pen was taken (`_lose`), a vanished copy mints a new `createLease`, a renewal clears the offline state, and another device's `want` starts `_handToDevice`."],
    "§13")
add("css._watch", "_watch()",
    "Subscribes to the manifest once, sending each change to `_onManifest`.",
    ["-"], "§13")
add("css._onManifest", "_onManifest(m)",
    "Reacts to a manifest change: the editor loses the pen or hands it over; a read-only device may take it, or follows the new head.",
    ["Only the lock holder listens. Editing, a lease with another epoch means the pen was taken (`_lose`), and another device's `want` on a live lease starts the hand-over at once. A device follower (not mid-hand-over) tries `_maybeTake`, updates the holder's name, and schedules a follow when the head moved."],
    "§13")
add("css._maybeTake", "_maybeTake(L)",
    "A visible device follower takes the pen unasked when `leaseState` calls the lease free, or it sat unchanged for a TTL of this device's clock.",
    ["Free covers a lease let go to this device or to nobody, and one past `until` by the skew margin. The TTL is timed from when this device first saw that epoch, `until` and `to`, so a skewed clock elsewhere cannot make a live lease look dead; a lease let go to another device is taken after a TTL too.",
     "Acts in mode `readonly` or `taking` and never once an epoch is held (each take mints an epoch and a promote). The take passes the watched lease as `ifLease`."],
    "§13")
add("css._lose", "_lose(holder)",
    "The pen was taken (a refused push, a beat or the manifest said so): read-only, flush locally, a notice, follow the cloud.",
    ["A failed flush keeps the document as a new canvas. Unpushed edits stay in the local store; once the new holder's head moves, the follow's reconcile keeps them as a conflict copy (DESIGN.md §13)."],
    "§13")
add("css._handToDevice", "_handToDevice(want)",
    "Another device asked for the pen: flush, push what is left, let go of the lease to the asker, follow.",
    ["One at a time. A failed flush keeps the document as a new canvas; the saver goes off; a push in flight is awaited, then what is still dirty is pushed (forced) and awaited. The beat keeps renewing meanwhile, so the asker waits. The release names the asker (`to`), which reserves the pen for it."],
    "§13")
add("css._takeLease", "_takeLease(force, ifLease)",
    "Takes the cloud lease (forced after \"Edit here\" has waited 6 min, or `ifLease` for a watched stale one) and promotes the session.",
    ["One take at a time; the promote runs on the serial chain; a failure marks the cloud offline."],
    "§13")
add("css._promote", "_promote()",
    "The pen taken from another device: reconciles to catch up with what it left, then edits and watches the manifest.",
    ["Saver off and read-only until the reconcile answers `ok`. A network failure edits offline with the open owed; any other failure blocks."],
    "§13")
add("css._followCloud", "_followCloud()",
    "A read-only device catches up: reads the manifest, reconciles (pulling the new head), and checks whether it may take the pen.",
    ["The take is considered only after a reconcile that answered `ok`."],
    "§13")
add("css._reloadFollow", "_reloadFollow()",
    "A read-only tab catches up with what the holder saved: the whole store when data moved, otherwise the header alone.",
    ["A whole reload keeps the camera; one that throws leaves the reload owed for the next follow. Answers false when nothing was reloaded. The code records the reason: a whole reload is 5-7 s of main thread on the Magnum Opus (measured 2026-09-23)."],
    "§13")
add("css._scheduleFollow", "_scheduleFollow(fn)",
    "Runs a follow while visible, at most every 2 s or ten times the last reload's cost, whichever is longer.",
    ["A hidden tab owes the latest follow until it is shown. One follow is pending at a time, run on the serial chain; one asked for while a follow runs waits and is scheduled when that one ends, gap included. The gap is timed from the end of the last follow, except one that answers false (a header-only refresh)."],
    "§13")
add("css._push", "_push({ ... })",
    "One push at a time of the local store to the cloud, with the failure backoff and the refused-push path.",
    ["Refused signed out, while a push is in flight, when not editing or handing over, and in backoff unless forced. A canvas not in the gallery index stays local; one not in the kobin-2 store is skipped. Otherwise it clears `dirty` and calls `cloudPushCanvas2` with the held epoch (or `createLease` when the push creates the copy), passing its 5 min deadline as the lane's limit.",
     "The deadline runs from when the push leaves the page's push lane, not while it queues, and only reports the failure: `busy` settles when the push itself settles, so a timed-out push is never doubled. A push that lands, even after its deadline was reported, makes the created copy's lease this tab's and records the head, or the next push would read its own lease as another's.",
     "`SyncConflict` or `LeaseLost` gives up the pen (`_lose`); any other failure keeps the edits dirty and backs off 1, 2, 4 ... min up to 30 min, shown on the chip."],
    "§13")
add("css._set", "_set(patch)",
    "Merges a patch into the session state and reports it to the UI.",
    ["-"], "")
add("css._serial", "_serial(fn)",
    "Runs losses, promotions and follows one at a time on a promise chain; skipped after stop.",
    ["Hand-overs and a stolen lock do not wait here. A failure does not break the chain."], "")
add("css._after", "_after(ms, fn)",
    "A tracked timeout, cleared with the session's timers and skipped after stop.",
    ["-"], "")
add("css._every", "_every(ms, fn)",
    "A tracked interval, cleared with the session's timers and skipped after stop.",
    ["-"], "")

# ---- src/cloud/storageLocks.js ----
add("slk.abortError", "abortError()",
    "An Error named `AbortError`, as Web Locks rejects an aborted or stolen request.",
    ["-"], "")
add("slk.sleep", "sleep(ms)",
    "A promise that resolves after `ms`.",
    ["-"], "")
add("slk.makeStorageLocks", "makeStorageLocks(opts)",
    "The part of `navigator.locks` the session uses (exclusive; `ifAvailable`, `steal`, `signal`) over localStorage, for a browser without Web Locks.",
    ["A lock is the key `boundless.lock.<name>` holding `{ owner, at }`, renewed every heartbeat (1 s) while held; a key not renewed for 10 s is free (a closed tab). With no compare-and-set, a taker writes its owner, waits 60 ms and reads it back: the last writer holds it, the others poll every 250 ms. A holder that finds another owner in its key rejects with `AbortError` (stolen).",
     "`ifAvailable` calls back with null when the lock is taken; `steal` writes over the holder; an abort before the grant rejects. The lock is held until the callback's promise settles, then its key is removed if still its own."],
    "§13")

# ---- src/cloud/syncCore.js ----
add("syn.newEpoch", "newEpoch()",
    "A fresh epoch id: five base-36 digits of the clock and five random ones, safe in a Firestore document id.",
    ["Minted for every lease take and as a tab's id; a manifest from before versions reads as epoch 0."],
    "§13")
add("syn.headOf", "headOf(manifest)",
    "A cloud manifest's head `{ epoch, seq }`; one from before versions reads as epoch 0 at its seq.",
    ["-"], "§13")
add("syn.sameHead", "sameHead(a, b)",
    "Whether two heads name the same point of history: both present, the same epoch and the same seq.",
    ["Epochs compare as strings."], "§13")
add("syn.leaseState", "leaseState(lease, { ... })",
    "Who may take the pen unasked, from a manifest's lease at `now` on this device's clock: `{ free, mine, holder }`.",
    ["A lease let go (`until` 0) is free, unless it was let go `to` another device: then it answers `reserved` to every device but that one, the device that let it go included. Otherwise free: no lease; this device's own live lease (the device lock arbitrates its tabs, so another tab's lease here is ours to take); another device's live lease only `skewMs` (`LEASE_SKEW_MS`, 5 min) past its `until`.",
     "`until` is the holder's clock, so the margin keeps a clock running ahead from taking a live lease. A follower that watched a lease sit unchanged for a TTL of its own clock takes it sooner (`CanvasSession._maybeTake`)."],
    "§13")
add("syn.chunkNames", "chunkNames(m)",
    "The set of chunk ids a manifest names, frame snapshots and log runs, for `intentLanded`.",
    ["-"], "§13")
add("syn.intentLanded", "intentLanded(intent, manifest, col)",
    "Whether a push this device recorded as its `intent` landed, though its tab closed before recording it.",
    ["True when the intent is for this collection and the cloud head is the intent's, or the manifest still names one of the intent's chunks (another device has pushed on top since). The recovered base is the intent's head, at the next push (`cloudPushCanvas2`) and at the next open (`decideOpen`)."],
    "§13")
add("syn.decideOpen", "decideOpen({ ... })",
    "The open decision: compares the local base with the cloud head and answers none, legacy, sync, push, pull, stash or conflict.",
    ["Versions, never clocks: local ops past the base with the head unmoved is a fast-forward push, the head moved with nothing unpushed a fast-forward pull, both a conflict. A base from another collection counts as none; a local `intent` that landed (`intentLanded`: a push whose manifest was written after its tab closed) is the base.",
     "With no base: an empty local copy pulls whole; a legacy manifest this device pushed, or the same frames at the same seqs (`sameFrames`), gives one. Otherwise the ancestry is unknown and `savedAt` decides, the one time a clock does: the cloud newer (or a local copy not in the kobin-2 store) is `stash`, this copy newer is `conflict`. Both keep both copies (DESIGN.md §13)."],
    "§13")
add("syn.sameFrames", "sameFrames(local, cloud)",
    "Whether a local copy holds exactly the manifest's frames at the same snapshot seqs: a copy pulled from it.",
    ["-"], "§13")
add("syn.conflictName", "conflictName(name, deviceName, at)",
    "The name of a conflict's copy: \"<name> — edits from <device>, <month day>\".",
    ["-"], "§13")
add("syn.defaultDeviceName", "defaultDeviceName(ua)",
    "The default device name other devices see: \"<browser> on <OS>\", read from the user agent.",
    ["Used until the device is named from the sync chip (`localStorage[\"kobin.deviceName\"]`)."],
    "§13")

# ---- src/cloud/store2.js ----
add("st2.packFrameChunk", "packFrameChunk({ ... })",
    "One frame snapshot as a cloud chunk: the frame id, its seq and the object headers, then the frame's doubles.",
    ["A `format2.packChunk` of kind FRAME. Lossless: the doubles that come back are the ones that went in."],
    "§13")
add("st2.unpackFrameChunk", "unpackFrameChunk(u8)",
    "A frame chunk back to `{ frameId, seq, objects, geo }`, throwing on a chunk of another kind.",
    ["-"], "§13")
add("st2.packLogChunk", "packLogChunk(entries)",
    "A run of op-log entries as one cloud chunk: a header per entry with its span into one concatenated Float64Array.",
    ["Each header keeps `seq`, `t`, `op` and `touches`, with `g: [offset, length]` into the shared array."],
    "§13")
add("st2.unpackLogChunk", "unpackLogChunk(u8)",
    "A log chunk back to its entries, each entry's geometry a view into the chunk's one array.",
    ["Throws on a chunk of another kind, or on an entry whose span falls outside the array."],
    "§13")
add("st2.splitParts", "splitParts(u8, size)",
    "Cuts a gzipped chunk into parts of at most 700 KiB for Firestore's 1 MiB document cap; always at least one.",
    ["-"], "§13")
add("st2.joinParts", "joinParts(parts)",
    "Concatenates parts back into one byte array.",
    ["The one copy: `canvasSync.js` imports it for the lz1 decoders and `cloudPullCanvas2`'s chunk reader."],
    "§13")
# ---- src/cloud/gzip.js ----
add("gz.pipe", "pipe(u8, stream)",
    "Runs bytes through a compression or decompression stream and collects the output.",
    ["-"], "§13")
add("gz.compression", "compression()",
    "The codec in use, chosen once: `gz1` through the browser's `CompressionStream`, or `raw` where it is missing.",
    ["Never lz-string, whose JS-object dictionary fails on a 100 MB drawing (OPEN-FLAGS F64). The name is written on each manifest; the diagnostic report uses the same codec."],
    "§13")
add("gz.setCompression", "setCompression(c)",
    "Replaces the codec, for tests that inject Node's zlib; `null` restores the default.",
    ["-"], "")
add("gz.gunzipAs", "gunzipAs(name, u8)",
    "Decompresses a stored chunk by the codec name it was written with; `raw` passes through.",
    ["A `gz1` chunk in a browser without `DecompressionStream` throws a readable error rather than returning compressed bytes."],
    "§13")

# ---- src/cloud/lzWorker.js ----
add("lzw.workerUrl", "workerUrl()",
    "The lz worker's script path, `lz-worker.js` under the app's public URL.",
    ["-"], "")
add("lzw.getWorker", "getWorker()",
    "The lz worker, created on first use; null for good once there is no Worker or the script failed to load.",
    ["Replies resolve or reject the waiting job by id. A load failure (a 404, a CSP) or an error outside a job rejects every waiting job as \"lz worker unavailable\" and marks the worker broken, so those jobs and every later one run on the main thread."],
    "§13")
add("lzw.run", "run(op, data, transfer)",
    "Posts one compress or decompress job to the worker and returns its promise, or null when there is no worker.",
    ["-"], "§13")
add("lzw.unavailable", "unavailable(err)",
    "Whether an error means the worker is missing: the one case that falls back to the main thread.",
    ["A job the worker ran and failed is not retried on the main thread: it would fail the same way after freezing the tab (OPEN-FLAGS F64)."],
    "§13")
add("lzw.compressToUint8Array", "compressToUint8Array(json)",
    "lz-string-compresses kobin-1 JSON to bytes in the worker, on the main thread only when the worker is missing.",
    ["Used only for the old lz1 copy (`encodeCanvasPayloadAsync`); the kobin-2 chunks go through `gzip.js`."],
    "§13")
add("lzw.decompressFromUint8Array", "decompressFromUint8Array(u8)",
    "Decompresses lz1 bytes to the JSON string (\"\" for nothing) in the worker, posting it a copy of the bytes.",
    ["Falls back to the main thread only when the worker is missing. Reads the old lz1 copies (`decodeCanvasPayloadAsync`)."],
    "§13")


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
    "cld.canvasesCol": {
        "why": "says the user's `canvases` collection; every builder uses the build's `CANVAS_COLLECTION`, which is `dev-canvases` in a development build",
        "what": "The user's canvas collection for this build: `canvases`, or `dev-canvases` in a development build.",
        "long": ["Every path is built from the signed-in uid, which is what the security rules match on: a user owns exactly their own subtree and nothing is public.",
                 "The collection is `CANVAS_COLLECTION`, fixed at load by `isDevBuild`: the dev server and the deployed app share one Firebase project, and a development build never writes the real collection (DESIGN.md §13)."],
    },
    "cld.partDoc": {
        "why": "says a chunk of the drawing in general; it addresses only the old lz1 copy's numbered parts, and a kobin-2 chunk's parts are `partDoc2`",
        "what": "One numbered part of a canvas's old lz1 copy (`parts/<i>`).",
        "long": ["-"],
    },
    "cld.cloudSaveCanvas": {
        "why": "says six parts a commit and that the presence heartbeat is carried through; there is no heartbeat, and it is now a wrapper that queues the old lz1 copy's writer (`saveCanvasLz1`: one part a commit, refuses a kobin-2 copy) in the page's push lane",
        "what": "Writes the old lz1 whole copy of a canvas still in the v1 local store, in the page's one push lane.",
        "long": ["Queues `saveCanvasLz1` in `inLane` with the lane's deadline (`laneMs`), so it never runs beside a kobin-2 push. Its one caller is the production gallery's catch-up, for a local canvas the account does not know and that is not in the kobin-2 store; the first kobin-2 push replaces the lz1 copy (DESIGN.md §13)."],
    },
    "cld.cloudGetCanvasMeta": {
        "why": "says the presence heartbeat reads it and the freshest-wins pull compares against it; there is no heartbeat, and a kobin-2 copy is reconciled by its head, not by time",
        "what": None,
        "long": ["The manifest (or an lz1 copy's parent) alone, no drawing. The session reads it at open (with a 4 s timeout), to reconcile, when a read-only device follows, and each beat while \"Edit here\" waits: the head and lease `decideOpen` and `_maybeTake` compare."],
    },
    "cld.cloudLoadCanvas": {
        "why": "says it reads every part and decodes; a kobin-2 copy is pulled whole and folded, its log tail included (F86)",
        "what": "A cloud canvas's drawing as kobin-1 JSON, with its thumbnails and metadata: an lz1 copy's parts decoded, a kobin-2 copy pulled whole and folded.",
        "long": ["A kobin-2 manifest goes through `cloudPullCanvas2` and `docFromStore`, so edits only in the log are in the result; null when the pull finds nothing. An lz1 copy's parts are read in parallel and decoded in the lz worker. The parent's name outranks the one embedded in the drawing, because a gallery rename only touches the parent.",
                 "Callers: the session's lz1 pull, and the gallery's download and duplicate of a canvas with no local copy."],
    },
    "cld.cloudDeleteCanvas": {
        "why": "says one batch; it deletes the parts in commits of 400 and the parent after, on its own, and a kobin-2 copy's chunk parts too",
        "what": None,
        "long": ["Deletes every part (each chunk's parts for a kobin-2 manifest, the numbered parts for an lz1 copy) in commits of 400, then the parent last, so a failure part-way leaves the canvas listed in the bin, where the purge can be run again."],
    },
    # Replaced by the lease: cloudTakeLease / cloudRenewLease, driven by CanvasSession._beat.
    "cld.cloudSetEditing": {"why": "gone", "by": "cloudTakeLease, cloudRenewLease (CanvasSession._beat)", "what": None, "long": None},
    # Replaced by cloudReleaseLease (CanvasSession.stop, _handToDevice).
    "cld.cloudClearEditing": {"why": "gone", "by": "cloudReleaseLease", "what": None, "long": None},
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]

# One or two sentences per FILE in the batch: the file's article heading on the Code Map.
ROLE = {
    "src/cloud/canvasSync.js":
        "Firestore persistence for canvases: the kobin-2 mirror (gzipped frame and log chunks, then the manifest "
        "in a transaction that checks the head and the lease), pushed one at a time per page through one push lane; "
        "the lease transactions, the gallery's listing, trash and rename, and the old lz1 copy. A development build "
        "uses `dev-canvases`, never the deployed app's `canvases` (DESIGN.md §13).",
    "src/cloud/canvasSession.js":
        "One open editor's part in one editor at a time: the device lock (Web Locks, or storageLocks.js without "
        "them) and the cloud lease decide which tab edits, and the others are read-only and follow the holder. Each "
        "grant claims the local store with a writer token, so a tab that lost the lock cannot write. It reconciles "
        "versions at open and whenever the pen changes hands, pushes, hands the pen over on request, and keeps work "
        "that cannot be written as a new canvas (DESIGN.md §13).",
    "src/cloud/storageLocks.js":
        "A stand-in for the part of `navigator.locks` the session uses, over localStorage, for a browser without "
        "Web Locks (the dev server reached over http by LAN address, Safari before 15.4): the last writer of a lock "
        "key holds it, renewed every second, and a key left unrenewed for 10 s is free.",
    "src/cloud/syncCore.js":
        "The pure rules of one canvas on several tabs and devices: the head `{ epoch, seq }`, the lease's state, and "
        "the open decision, which compares versions, not clocks. No Firestore, no IndexedDB (DESIGN.md §13).",
    "src/cloud/store2.js":
        "The kobin-2 store as cloud chunks and back: one chunk per frame snapshot or run of log entries, split into "
        "700 KiB parts. Pure and lossless (DESIGN.md §13).",
    "src/cloud/gzip.js":
        "The cloud chunks' compression: the browser's own gzip stream, raw where it is missing, never lz-string "
        "(OPEN-FLAGS F64). The diagnostic report uses it too.",
    "src/cloud/lzWorker.js":
        "lz-string in a Web Worker, for the old lz1 cloud copy that a canvas still in the v1 local store writes and "
        "old copies are read from; the main thread only where there is no worker.",
}
