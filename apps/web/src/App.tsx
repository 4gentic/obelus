import { Route, Routes } from "react-router-dom";
import Frame from "./components/Frame";
import Demo from "./routes/demo";
import Landing from "./routes/landing";
import Library from "./routes/library";
import Review from "./routes/review";

export default function App() {
  return (
    <Routes>
      <Route element={<Frame />}>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Library />} />
        <Route path="/app/demo" element={<Demo />} />
        <Route path="/app/review/:paperId" element={<Review />} />
      </Route>
    </Routes>
  );
}
