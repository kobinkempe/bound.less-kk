# -*- coding: utf-8 -*-
"""Per-function entries for the shell: the hook, local storage, the cloud."""

E = {}


def add(key, fn, what, long, ref="§13"):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- constructors that belong to a class row already written ---------------
for k, cls in [("lad.Ladder.constructor", "Ladder"),
               ("lrl.LogicRule.constructor", "LogicRule"),
               ("prng.PreferenceRange.constructor", "PreferenceRange"),
               ("prng.StandardPreferenceRange.constructor", "StandardPreferenceRange"),
               ("prng.UserPreferenceRange.constructor", "UserPreferenceRange")]:
    add(k, cls + ": constructor", "Builds one " + cls + ".",
        ["Covered by the row for `" + cls + "` - the constructor is where its fields are fixed and it does nothing else."], "§14")

# ------------------------------------------------------- hooks/useKobinEngine
add("hok.now", "now()", "Monotonic time, falling back to the wall clock.",
    ["One definition, so the three parts of a save are timed against the same clock."])
add("hok.signCursor", "signCursor(plus)",
    "Draws the ctrl cursor - an arrow with a plus or minus badge.",
    ["An SVG data URI rather than a stock cursor, because no standard cursor keyword means 'add to selection'. The nearest one, `copy`, shows a plus that means duplicate.",
     "The badge is the product's own terracotta, taken from the design file so that the cursor and the selection ants are visibly the same colour."])
add("hok.useKobinEngine", "useKobinEngine({ storageKey, onAutosave })",
    "THE ENGINE LIFECYCLE the product uses.",
    ["Mounts the engine into a host element, wires pointer, wheel, pinch, resize and keyboard input to it, owns every piece of tool and style state, and owns the autosave loop.",
     "**Status is throttled to 50 ms, except zoom.** A React re-render of the whole editor per pointer event costs about twelve milliseconds, which a gesture cannot afford. Zoom changes are flushed immediately anyway, because the scale HUD reads them and a coalesced burst would make the bar skip a rung.",
     "**Autosave is currently OFF** - `LOCAL_AUTOSAVE` is false while the storage defect stands. The failure handling around it is worth reading even so: a save that throws records the document version that failed, so the same doomed bytes are not re-serialised on the next tick, and backs off exponentially.",
     "Two pointers are a pinch. A stroke that has only just started when the second finger lands is cancelled rather than finalised, because it was the first finger arriving and not a mark."],
    "§13")
add("hok.fmtZoom", "fmtZoom(z)",
    "A zoom factor as a short human number.",
    ["Thousands and millions only where the quotient stays short. Beyond that it hands over to the scale bar's scientific formatter, because dividing by a million and printing the result gave things like `1500646128030403.00M`."])
add("hok.zoomLabel", "zoomLabel(zoom)",
    "The zoom readout, as a multiplier or a fraction.",
    ["Below one it reads as a fraction rather than a decimal, because at these depths the decimal is all zeroes."])

# ------------------------------------------------- storage/localCanvases.js
add("loc.slotKey", "slotKey(id)", "The storage key for one canvas.",
    ["One slot per canvas. The prefix is what makes every other operation - listing, purging, migrating - a key scan rather than an index read."])
add("loc.packSlot", "packSlot(json)", "Compresses a document for storage.",
    ["lz-string's UTF-16 form, which is the dense one for this API, behind an `lz1:` marker so the reader can tell a compressed slot from a legacy plain one.",
     "It stretches the origin quota several-fold. It is also, measured, the single most expensive thing in a save - 97% of a 6.8 second autosave on a large document - which is the defect that turned local autosave off."])
add("loc.unpackSlot", "unpackSlot(raw)", "Reads a slot, compressed or not.",
    ["Legacy plain-JSON slots start with a brace and keep loading for ever. A format marker that only the new writer emits is what makes that free."])
add("loc.newCanvasId", "newCanvasId()", "A fresh canvas id.",
    ["Time in base 36 plus four random characters - sortable, short, and collision-free enough for one browser."])
add("loc.getDeviceId", "getDeviceId()", "A stable id for this browser.",
    ["What lets a device recognise its OWN presence heartbeat in the cloud and not warn about itself."])
add("loc.readIndex", "readIndex()", "The gallery index, defensively.",
    ["Returns an empty list rather than throwing on anything malformed. The index is a convenience over the slots, which are the real data, so it must never be the thing that stops the app starting."])
add("loc.writeIndex", "writeIndex(list)", "Writes the index, reporting quota failure.",
    ["Returns false rather than throwing, because a full quota is an expected state here and every caller has something better to do than unwind."])
add("loc.statsFromDoc", "statsFromDoc(doc)", "Stroke and depth counts for a gallery badge.",
    ["Counts natives per frame and measures the depth span. It is also how the app decides whether an unsaved canvas is worth keeping as a draft - a canvas with no strokes is not."])
add("loc.upsertIndexEntry", "upsertIndexEntry(entry)", "Adds or refreshes one index row.",
    ["Newest first, sorted on write, so the gallery never sorts."])
add("loc.removeCanvas", "removeCanvas(id)", "Deletes a canvas outright, no recycle bin.",
    ["Only for a never-saved empty scratch canvas, where there is nothing a bin row could offer."])
add("loc.trashSlotKey", "trashSlotKey(id)", "The recycle bin's key for one canvas.",
    ["A separate prefix, so a binned canvas cannot be found by anything that walks live slots."])
add("loc.writeTrash", "writeTrash(list)", "Writes the bin index.",
    ["Swallows a quota failure: failing to record a deletion must not fail the deletion."])
add("loc.removeThumbs", "removeThumbs(canvasId)", "Deletes every thumbnail for a canvas.",
    ["A key scan, because thumbnails are keyed per canvas and per scene and there is no list of them.",
     "Only ever called when a bin entry expires. Thumbnails survive while a canvas is binned, which is what makes restoring one give its cover back for free - and is also why they accumulate."])
add("loc.readTrash", "readTrash(...)", "The bin, newest first, purging what has expired.",
    ["Expiry happens on read rather than on a timer. There is no timer in a browser that can be relied on to run, and the bin is only interesting at the moment somebody looks at it.",
     "An expired entry takes its slot and its thumbnails with it."])
add("loc.trashCanvas", "trashCanvas(id, fallbackEntry)",
    "Moves a canvas to the recycle bin, slot and all.",
    ["The slot is moved verbatim, so a restore is byte-identical rather than a re-serialisation.",
     "The fallback entry covers a canvas with no index row - a never-saved scratch, or a cloud-only listing - so the bin still shows a row for it rather than losing it silently."])
add("loc.restoreCanvas", "restoreCanvas(id)", "Brings a binned canvas back.",
    ["The index row is rebuilt only when a local slot existed; a cloud-only row comes back through the cloud listing instead, which is the one path that has the data.",
     "If the restore write fails on quota the entry stays in the bin rather than being lost between the two."])
add("loc.stashOverwrittenVersion", "stashOverwrittenVersion(json, name)",
    "Files the losing side of a cross-device overwrite in the bin.",
    ["Given a FRESH id and a '(overwritten)' name, so restoring it becomes its own canvas rather than fighting the live one for the same slot.",
     "This is the safety net behind the cross-device banner: if two devices edit the same canvas, the version that lost is recoverable rather than gone."])
add("loc.purgeTrashEntry", "purgeTrashEntry(id)", "Deletes a binned canvas for good.",
    ["Row, slot and thumbnails. The only irreversible operation in the module."])
add("loc.duplicateCanvas", "duplicateCanvas(id, fallbackJson, fallbackName)",
    "Copies a canvas into a fresh slot.",
    ["Names it '<name> copy' and carries the cover thumbnail across, so the copy is recognisable in the gallery immediately rather than after the next save.",
     "Takes a fallback document for a cloud-only canvas whose data was fetched separately."])
add("loc.renameCanvasLocal", "renameCanvasLocal(id, name, savedAt)",
    "Renames without opening the editor.",
    ["Writes both the index row and the name embedded in the document, so the next cloud save or pull carries the new name rather than reverting it."])
add("loc.loadCanvasRaw", "loadCanvasRaw(id)", "One canvas's document, decompressed.",
    ["Null on anything unreadable, so a single corrupt slot cannot break the gallery."])
add("loc.saveCanvasRaw", "saveCanvasRaw(id, json)", "Writes one canvas, reporting quota failure.",
    ["Returns false rather than throwing - the same contract as the index writer, for the same reason."])
add("loc.backupCanvasSlot", "backupCanvasSlot(id)",
    "Copies a slot aside before a cloud pull overwrites it.",
    ["Belt and braces under the overwrite stash: if the merge decision was wrong, the bytes are still there under a `.bak` key."])
add("loc.migrateLegacyAutosave", "migrateLegacyAutosave()",
    "Adopts the pre-multi-canvas drawing into the gallery, once.",
    ["The app used to keep one drawing in one key. On the first gallery visit that drawing becomes a real canvas with its own slot and index row.",
     "The legacy key is left in place - as a safety net, and because the dev harness still reads it - and a flag stops the migration running twice."])
add("loc.thumbKey", "thumbKey(canvasId, sceneId)", "The key for one scene thumbnail.",
    ["Keyed per canvas AND per scene, which is why there are 251 of them on a busy browser."])
add("loc.loadThumbs", "loadThumbs(canvasId, sceneIds)", "The stored thumbnails for a set of scenes.",
    ["Missing ones are simply absent rather than an error; the caller regenerates what it did not get."])
add("loc.saveThumbs", "saveThumbs(canvasId, map)", "Stores thumbnails, quota permitting.",
    ["Each write is independent, so a quota failure loses one thumbnail rather than the batch."])
add("loc.loadCoverThumb", "loadCoverThumb(canvasId)", "The gallery card's image.",
    ["The primary scene's thumbnail, aliased under a 'cover' key so the gallery does not have to know which scene is primary."])
add("loc.agoLabel", "agoLabel(verb, iso, fallback)", "'Edited 3 hours ago'.",
    ["One implementation for both the edited and the deleted labels, so they cannot phrase the same interval differently."])
add("loc.editedLabel", "editedLabel(savedAt)", "When a canvas was last edited.", ["-"])
add("loc.deletedLabel", "deletedLabel(deletedAt)", "When a canvas was binned.", ["-"])
add("loc.depthLabel", "depthLabel(levels)", "'3 levels deep', for the gallery badge.",
    ["The one place the engine's level count is turned into something a reader is meant to feel rather than measure."])

# --------------------------------------------------- storage/thumbnails.js
add("thm.aspectRect", "aspectRect(rect)", "Grows a scene rect to the thumbnail's shape.",
    ["Centred, so the thumbnail shows the scene plus margin rather than a crop of it."])
add("thm.rasterize", "rasterize(svgEl)", "Turns the live SVG into a JPEG data URL.",
    ["Serialises the SVG, loads it as an image, draws it into a canvas over white.",
     "Every failure path resolves to null rather than rejecting. A thumbnail is a nicety and must never be able to fail a save."])
add("thm.renderThumbs", "renderThumbs(doc, scenes, existing)",
    "Renders thumbnails for the scenes whose content changed.",
    ["**It builds a WHOLE SECOND ENGINE** in a hidden host, loads the drawing into it, and jumps it to each scene in turn.",
     "That is far and away the most expensive thing the editor does, and until it was instrumented it was invisible - it ran inside the save path and was attributed to nothing.",
     "Only scenes whose content hash has changed are re-rendered, which is what keeps an ordinary save cheap."])

# --------------------------------------------------------- cloud/canvasSync
add("cld.canvasesCol", "canvasesCol(uid)", "The user's canvases collection.",
    ["Every path is built from the signed-in uid, which is what the security rules match on: a user owns exactly their own subtree and nothing is public."])
add("cld.canvasDoc", "canvasDoc(uid, id)", "One canvas's parent record.", ["-"])
add("cld.partDoc", "partDoc(uid, id, i)", "One chunk of one canvas's drawing.", ["-"])
add("cld.encodeCanvasPayload", "encodeCanvasPayload(json)",
    "Compresses a document and splits it into chunks.",
    ["A Firestore document caps at one mebibyte, so the drawing cannot live on the parent. It is compressed to bytes and cut into 700 KiB parts.",
     "Pure, and unit-tested without Firestore - which is why the chunking has its own test file rather than being reachable only through the network."])
add("cld.decodeCanvasPayload", "decodeCanvasPayload(parts, codec)",
    "Reassembles chunks into a document.",
    ["Legacy string parts still decode. The codec is read from the parent record rather than guessed, so an old canvas and a new one are told apart by data rather than by sniffing."])
add("cld.boundedThumbs", "boundedThumbs(thumbs)",
    "Caps the thumbnails that ride on the parent record.",
    ["They share the parent's one-mebibyte limit with the metadata, so the cover goes first and the rest fill the remaining budget in insertion order.",
     "Without the cap a canvas with many scenes would silently fail to save at all."])
add("cld.cloudSaveCanvas", "cloudSaveCanvas(uid, entry, json, thumbs)",
    "Saves a canvas to the account.",
    ["**Parts first, in bounded commits; the parent LAST.** A batch caps at about ten mebibytes, so a large drawing is committed six parts at a time - the old single-batch write failed wholesale.",
     "Readers key off the parent's part count and codec, so writing it last means a torn save never looks complete: it looks like the previous save, which is a state the app already handles.",
     "Stale parts beyond the new count are deleted in the same final commit, and the presence heartbeat is carried through by hand, because the parent is written as a whole document and would otherwise blank it."])
add("cld.cloudListCanvases", "cloudListCanvases(uid)",
    "Every canvas in the account, tombstones included.",
    ["Metadata only - listing the gallery downloads no drawings, which is the whole reason metadata lives on the parent.",
     "Deleted canvases are included on purpose. A device that filtered them out would re-upload a canvas deleted elsewhere, because to that device it would look like a canvas the account had never seen."])
add("cld.cloudGetCanvasMeta", "cloudGetCanvasMeta(uid, id)", "One canvas's metadata, one read.",
    ["What the freshest-wins pull compares against, and what the presence heartbeat reads. One document rather than a drawing."])
add("cld.cloudLoadCanvas", "cloudLoadCanvas(uid, id)", "A canvas's drawing, thumbnails and metadata.",
    ["Reads the parent, then every part in parallel, then decodes.",
     "The parent's name outranks the one embedded in the drawing, because a gallery rename only touches the parent."])
add("cld.cloudTrashCanvas", "cloudTrashCanvas(uid, id)", "Soft-deletes: a tombstone on the parent.",
    ["The parts are left in place, so restoring is a one-field write and no data moves."])
add("cld.cloudRestoreCanvas", "cloudRestoreCanvas(uid, id)", "Clears the tombstone.",
    ["A full save clears it too, which means editing a canvas anywhere resurrects it - the behaviour a person expects without being told."])
add("cld.cloudRenameCanvas", "cloudRenameCanvas(uid, id, name, savedAt)",
    "Renames without re-uploading the drawing.",
    ["A parent-only merge. The timestamp is passed in so it matches the local index bump exactly, which keeps freshest-wins comparisons symmetric between the two stores."])
add("cld.cloudSetEditing", "cloudSetEditing(uid, id, deviceId)",
    "Stamps 'this device has it open'.",
    ["Every thirty seconds while the tab is visible. Another device seeing a fresh stamp that is not its own shows the overwrite warning."])
add("cld.cloudClearEditing", "cloudClearEditing(uid, id, deviceId)",
    "Clears our own heartbeat on the way out.",
    ["Reads before writing, and clears only if the stamp is ours - otherwise closing one tab would silence the warning about another device that is still editing."])
add("cld.cloudDeleteCanvas", "cloudDeleteCanvas(uid, id)", "Permanent deletion, parts and all.",
    ["One batch, so a half-deleted canvas cannot be left behind."])

# ------------------------------------------------------- cloud/firebaseApp
add("fba.getFirebaseApp", "getFirebaseApp()", "The Firebase app, initialised once.",
    ["Lazy and memoised, so importing the module from a jsdom test that never signs in starts no SDK machinery."])
add("fba.getFirebaseAuth", "getFirebaseAuth()", "The auth instance.", ["-"])
add("fba.getDb", "getDb()", "The Firestore instance.", ["-"])

# ---------------------------------------------------------- cloud/useUser
add("usr.useUser", "useUser()", "Live sign-in state: { user, ready }.",
    ["`ready` matters as much as `user`: before Firebase has resolved, 'nobody is signed in' and 'we do not know yet' are different states, and rendering the signed-out gallery during the second one makes the app look like it lost your canvases."])
add("usr.signInWithGoogle", "signInWithGoogle()", "Signs in, with a redirect fallback.",
    ["Tries a popup, and falls back to a full-page redirect when the browser blocks it - which phones and strict settings do routinely. The auth listener picks the result up on return either way."])
add("usr.signOutUser", "signOutUser()", "Signs out.", ["-"])
