import { APP_VERSION } from "./version";
import pkg from "../package.json";

test("the app's version is package.json's, and semantic", () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
