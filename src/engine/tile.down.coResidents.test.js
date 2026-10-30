import LevelMap from "./LevelMap";
import Document from "./Document";
import TileStore from "./TileStore";
import { BASE, ENTER, EXIT, G, R } from "./frameLattice";
import { rectLoop, reverseLoop } from "./geometry/arcShape";
import { inks } from "./__testkit__/ink";

const CFG = { enter: ENTER, base: BASE, exit: EXIT, arcTolerancePx: 0.25,
    polygonizeWidthFrac: 1 / 3, lineModeLevel: 2, bufferScreens: 1 };

test.each([0, 1, 4, 6, 22])("F172 minifies a co-resident branch's ceded ink at depth %s", (depth) => {
    const M = new LevelMap(CFG, 800, 600), doc = new Document();
    M.ensureSpine(-1);
    let view = M.frame("0");
    let parallel = M.privateFrame(view.parent, view.cell.i, view.cell.j, "family");
    const digits = [[705,-139],[1801,-1027],[1304,-1480],[-1908,1473],[1559,-1011]];
    for (let k = 0; k < depth; k++) {
        const [i,j] = digits[k % digits.length];
        view = M.cellChild(view.id,i,j);
        parallel = M.privateFrame(parallel.id,i,j,"family");
    }
    const kid = M.privateFrame(parallel.id,1031,976,"family");
    const loops = rectLoop({left:-2048,top:-2048,right:2048,bottom:2048})
        .concat(rectLoop({left:-512,top:-512,right:512,bottom:512}).map(reverseLoop));
    doc.add({id:1,type:"shape",origin:"native",loops,color:"#224466",opacity:1},kid.id);
    const distant = M.privateFrame(parallel.id,-1031,-976,"family");
    doc.add({id:2,type:"shape",origin:"native",loops,color:"#224466",opacity:1},distant.id);
    const store = new TileStore(M,doc,CFG);
    try {
        const p = [1031 * G, 976 * G];
        const candidates = store._downSources(view.id,{left:p[0]-1,top:p[1]-1,right:p[0]+1,bottom:p[1]+1});
        expect(candidates).toContain(kid.id);
        expect(candidates).not.toContain(distant.id);
        expect(new Set(candidates).size).toBe(candidates.length);
        const tile = store._ensureDown(view.id,0,0);
        expect(inks(tile.objs,[p[0]+1024/R,p[1]])).toBe(true);
        expect(inks(tile.objs,p)).toBe(false);
    } finally { store.destroy(); }
});
