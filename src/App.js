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

function App() {
  return (
      <Router>
        <div>
          <Switch>
            <Route path="/v2">
              <CanvasV2 />
            </Route>
            <Route path="/canvases">
              <CanvasesV2 />
            </Route>
            <Route path="/canvas/:canvasId">
              <CanvasEditor />
            </Route>
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
