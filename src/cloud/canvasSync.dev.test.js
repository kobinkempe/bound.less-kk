/**
 * SYNC-PLAN R7: a development build reads and writes `users/{uid}/dev-canvases`, never the
 * real `canvases` collection the deployed app uses (the two share one Firebase project).
 * Every writer in canvasSync runs against the fake Firestore; the written paths are checked.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fake } from "../engine/__testkit__/fakeFirestore";
import { setCompression } from "./gzip";
import { encodeRecords } from "../engine/format2";
import {
    isDevBuild, CANVAS_COLLECTION, DEV_COLLECTION, REAL_COLLECTION,
    cloudSaveCanvas, cloudPushCanvas2, cloudRenameCanvas, cloudTrashCanvas, cloudRestoreCanvas,
    cloudDeleteCanvas, cloudListCanvases, cloudGetCanvasMeta, cloudLoadCanvas2,
    cloudTakeLease, cloudRenewLease, cloudAskLease, cloudReleaseLease,
} from "./canvasSync";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("./firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));

const nodeGzip = { name: "gz1", gzip: async (u8) => new Uint8Array(zlib.gzipSync(Buffer.from(u8))), gunzip: async (u8) => new Uint8Array(zlib.gunzipSync(Buffer.from(u8))) };
beforeAll(() => setCompression(nodeGzip));
afterAll(() => setCompression(null));
beforeEach(() => fake.reset());

const rec = (id) => ({ type: "shape", origin: "native", id, loops: [[0, 0, 1, 10, 0, 1, 10, 10, 1, 0, 10, 1, 0, 0]], color: "#123456", opacity: 1, w: 3 });
function source(seq = 3) {
    const f = encodeRecords([rec(1), rec(2)]);
    const header = { format: "boundless-drawing", version: 1, meta: { name: "A" }, camera: null, crossings: {}, seq, frameSeq: { 0: seq }, frameIds: ["0"] };
    return {
        header,
        readFrames: async (ids) => ids.map((fid) => ({ frameId: fid, seq, objects: f.objects, geo: f.geo })),
        readLog: async () => [],
    };
}
const REAL_DOC = "users/u1/canvases/c1";

describe("R7 — the dev collection", () => {
    test("isDevBuild: production on a real host is the only real build", () => {
        expect(isDevBuild("production", "bound-less-kk.web.app")).toBe(false);
        expect(isDevBuild("production", "bound-less-kk.firebaseapp.com")).toBe(false);
        expect(isDevBuild("production", "localhost")).toBe(true);
        expect(isDevBuild("production", "127.0.0.1")).toBe(true);
        expect(isDevBuild("development", "192.168.1.20")).toBe(true);   // the dev server from the phone
        expect(isDevBuild("test", "")).toBe(true);
        // Any other host is a dev build too: a production build served on the LAN, *.localhost, a
        // Hosting preview channel (review nit).
        expect(isDevBuild("production", "192.168.1.20")).toBe(true);
        expect(isDevBuild("production", "app.localhost")).toBe(true);
        expect(isDevBuild("production", "bound-less-kk--pr12-abc123.web.app")).toBe(true);
        expect(isDevBuild("production", "BOUND-LESS-KK.WEB.APP")).toBe(false);
    });

    test("this build (a test) uses the dev collection", () => {
        expect(CANVAS_COLLECTION).toBe(DEV_COLLECTION);
        expect(CANVAS_COLLECTION).not.toBe(REAL_COLLECTION);
    });

    test("every writer writes under users/{uid}/dev-canvases and the real copy is untouched", async () => {
        fake.apply([{ kind: "set", path: REAL_DOC, data: { name: "Real", format: "kobin-2", seq: 9 } }]);
        fake.writes = [];
        const entry = { id: "c1", name: "A", savedAt: "2026-09-22T00:00:00Z", strokes: 2, levels: 1 };
        await cloudSaveCanvas("u1", entry, JSON.stringify({ natives: {} }));
        await cloudPushCanvas2("u1", entry, source(), { deviceId: "dev1" });
        await cloudRenameCanvas("u1", "c1", "B");
        await cloudTrashCanvas("u1", "c1");
        await cloudRestoreCanvas("u1", "c1");
        const who = { device: "dev1", tab: "t", name: "Chrome on Windows" };
        const lease = await cloudTakeLease("u1", "c1", who);
        await cloudRenewLease("u1", "c1", lease.lease.epoch);
        await cloudAskLease("u1", "c1", { ...who, device: "dev2" });
        await cloudReleaseLease("u1", "c1", lease.lease.epoch);
        const listed = await cloudListCanvases("u1");
        expect(listed.map((c) => c.id)).toEqual(["c1"]);
        expect((await cloudGetCanvasMeta("u1", "c1")).name).toBe("B");
        await cloudDeleteCanvas("u1", "c1");
        expect(fake.writes.length).toBeGreaterThan(5);
        for (const w of fake.writes) expect(w.path.startsWith("users/u1/dev-canvases/")).toBe(true);
        expect(fake.data(REAL_DOC)).toEqual({ name: "Real", format: "kobin-2", seq: 9 });
    });

    test("the real collection is readable (the dev copy-in) and nothing is written reading it", async () => {
        await cloudPushCanvas2("u1", { id: "c1", name: "Real" }, source(5), { deviceId: "prod" });
        // Move what was pushed into the real collection's paths, as the deployed app would have written it.
        for (const p of fake.paths("users/u1/dev-canvases/")) {
            fake.apply([{ kind: "set", path: p.replace("dev-canvases", "canvases"), data: fake.data(p) }, { kind: "delete", path: p }]);
        }
        fake.writes = [];
        const pulled = await cloudLoadCanvas2("u1", "c1", { real: true });
        expect(pulled.header.seq).toBe(5);
        expect(Object.keys(pulled.frames)).toEqual(["0"]);
        expect(await cloudLoadCanvas2("u1", "c1")).toBeNull();   // the dev collection has no copy
        expect(fake.writes).toEqual([]);
    });

    test("no module in src/cloud names the real collection outside the read-only builders", () => {
        const dir = __dirname;
        for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith(".js") || f.includes(".test.")) continue;
            const src = fs.readFileSync(path.join(dir, f), "utf8");
            const lines = src.split(/\r?\n/);
            lines.forEach((line) => {
                if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // comments
                if (/["'`]canvases["'`]/.test(line)) expect(line).toMatch(/export const REAL_COLLECTION = "canvases";/);
                if (/REAL_COLLECTION/.test(line) && !/export const REAL_COLLECTION|CANVAS_COLLECTION = /.test(line)) {
                    expect(line).toMatch(/^const real(CanvasDoc|PartDoc2) = /);
                }
            });
        }
    });
});
