import React, { useState, useEffect } from "react";
import { analyzeUrl, analyzeUrlStream } from "./api";
import UrlInput from "./components/UrlInput";
import ResultView from "./components/ResultView";

export default function App() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [streamResult, setStreamResult] = useState(null);

  const handleAnalyze = async url => {
    try {
      setLoading(true);
      setError(null);
      setStreamResult({ buttons: [], allEvents: [] }); // 초기화

      // 실시간 스트리밍으로 분석
      await analyzeUrlStream(url, (eventType, data) => {
        if (eventType === 'button') {
          // 새로운 버튼 분석 결과를 실시간으로 추가
          setStreamResult(prev => ({
            ...prev,
            buttons: [...(prev?.buttons || []), data],
            allEvents: [...(prev?.allEvents || []), ...data.events]
          }));
        } else if (eventType === 'complete') {
          // 최종 결과
          setResult(data);
          setStreamResult(null);
        } else if (eventType === 'error') {
          setError(data.error);
        }
      });

      // 기존 방식으로도 백업 (필요시)
      // const data = await analyzeUrl(url);
      // setResult(data);
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
      {/* 실시간 스트리밍 결과 또는 최종 결과 표시 */}
      {(streamResult || result) && <ResultView result={streamResult || result} />}
    </div>
  );
}