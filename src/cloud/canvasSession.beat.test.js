/**
 * The lease renewal does not race the push's manifest transaction (REVIEWER S-1: the renewal every
 * 20 s and the push both transact on the manifest; whichever commits second fails its precondition —
 * the "RPC 'Commit' failed-precondition" warnings every few minutes in Kobin's report 04-06-17). While a
 * push is in flight the beat skips its renewal, unless half the lease has gone since the last one.
 */
import { cloudRenewLease } from "./canvasSync";
import { CanvasSession } from "./canvasSession";

jest.mock("./canvasSync", () => ({ ...jest.requireActual("./canvasSync"), cloudRenewLease: jest.fn(async () => ({ ok: true })) }));

const session = (now) => {
    const s = Object.create(CanvasSession.prototype);
    Object.assign(s, {
        stopped: false, hasLock: true, uid: "u", id: "c", gen: 1, epoch: "e", needOpen: false,
        state: { mode: "editing", cloud: "saved" }, o: { ttlMs: 90000 },
        env: { visible: () => true, now: () => now.t }, busy: null, _renewedAt: null,
    });
    s._set = () => {};
    return s;
};

describe("BT — the beat and the push", () => {
    beforeEach(() => { cloudRenewLease.mockReset(); cloudRenewLease.mockImplementation(async () => ({ ok: true })); });   // CRA resets mocks
    test("BT-1 no push in flight: the beat renews", async () => {
        const now = { t: 1000 };
        await session(now)._beat();
        expect(cloudRenewLease).toHaveBeenCalledTimes(1);
    });
    test("BT-2 a push in flight and a fresh lease: the beat skips; past half the lease it renews anyway", async () => {
        const now = { t: 1000 };
        const s = session(now);
        await s._beat();                                   // renewed at t = 1000
        s.busy = new Promise(() => {});                    // a push that is still running
        now.t += 20000;
        await s._beat();
        expect(cloudRenewLease).toHaveBeenCalledTimes(1); // red: renewed under the push
        now.t += 30000;                                    // 50 s since the renewal: over half of 90
        await s._beat();
        expect(cloudRenewLease).toHaveBeenCalledTimes(2);
    });
});
