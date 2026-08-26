import {
  HashRouter as Router,
  Switch,
  Route
} from "react-router-dom";
import HomeV2 from "./Pages/HomeV2";
import CanvasesV2 from "./Pages/CanvasesV2";
import CanvasEditor from "./Pages/CanvasEditor";
import CanvasV2 from "./Pages/CanvasV2";
import NotFoundPage from "./Pages/NotFoundPage";
import BakeLab from "./Pages/BakeLab";
import ArcPen from "./Pages/ArcPen";
import ArcBake from "./Pages/ArcBake";

function App() {
  return (
      <Router>
        <div>
          <Switch>
            <Route path="/bakelab">
              <BakeLab />
            </Route>
            <Route path="/arcpen">
              <ArcPen />
            </Route>
            <Route path="/arcbake">
              <ArcBake />
            </Route>
            <Route path="/v2">
              <CanvasV2 />
            </Route>
            <Route path="/canvases">
              <CanvasesV2 />
            </Route>
            <Route
              path="/canvas/:canvasId"
              render={({ match }) => (
                // Keyed so switching canvases remounts the editor (and its
                // engine + autosave slot) — v5 reuses the element otherwise.
                <CanvasEditor key={match.params.canvasId} />
              )}
            />
            <Route exact path="/">
              <HomeV2 />
            </Route>
            <Route>
              <NotFoundPage />
            </Route>
          </Switch>
        </div>
      </Router>
  );
}


export default App;
