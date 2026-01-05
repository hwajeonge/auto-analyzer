import React, { useState } from "react";
import { analyzeUrl } from "./api";
import UrlInput from "./components/UrlInput";
import ResultView from "./components/ResultView";

export default function App() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAnalyze = async url => {
    try {
      setLoading(true);
      setError(null);

      const data = await analyzeUrl(url);
      setResult(data);
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false); // ⭐ 반드시 finally
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>AutoTag Analyzer</h1>

      <UrlInput onAnalyze={handleAnalyze} />

      {loading && <p>분석 중...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {result && <ResultView result={result} />}
    </div>
  );
}
