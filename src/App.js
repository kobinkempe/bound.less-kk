import {
  HashRouter as Router,
  Switch,
  Route
} from "react-router-dom";
import HomeV2 from "./Pages/HomeV2";
import CanvasesV2 from "./Pages/CanvasesV2";
import CanvasEditor from "./Pages/CanvasEditor";
import NotFoundPage from "./Pages/NotFoundPage";

function App() {
  return (
      <Router>
        <div>
          <Switch>
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
