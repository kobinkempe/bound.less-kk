import { ringsFullyInsideLasso } from "./hittest";

describe("lasso containment", () => {
    const box = [[0, 0], [10, 0], [10, 10], [0, 10]];

    test("accepts a fully bounded ring, including boundary contact", () => {
        expect(ringsFullyInsideLasso([[[1, 1], [9, 1], [9, 9], [1, 9]]], box)).toBe(true);
        expect(ringsFullyInsideLasso([[[0, 1], [2, 1], [2, 2], [0, 2]]], box)).toBe(true);
    });

    test("rejects geometry extending outside", () => {
        expect(ringsFullyInsideLasso([[[-1, 1], [2, 1], [2, 2], [-1, 2]]], box)).toBe(false);
    });

    test("rejects an edge that crosses a concave notch despite inside vertices", () => {
        const concave = [[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10]];
        expect(ringsFullyInsideLasso([[[2, 8], [8, 8], [8, 9], [2, 9]]], concave)).toBe(false);
    });
});
