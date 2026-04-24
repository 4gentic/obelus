import { Route, Routes } from "react-router-dom";
import Frame from "./components/Frame";
import Landing from "./routes/landing";
import Library from "./routes/library";
import Review from "./routes/review";
import ReviewMd from "./routes/review-md";

export default function App() {
  return (
    <Routes>
      <Route element={<Frame />}>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Library />} />
        <Route path="/app/review/:paperId" element={<Review />} />
        <Route path="/app/review-md/:paperId" element={<ReviewMd />} />
      </Route>
    </Routes>
  );
}
