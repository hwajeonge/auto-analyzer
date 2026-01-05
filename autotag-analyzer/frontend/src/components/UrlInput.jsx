import React, { useState } from "react";

export default function UrlInput({ onAnalyze }) {
  const [url, setUrl] = useState("");

  return (
    <div>
      <input
        style={{ width: 400 }}
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://example.com"
      />
      <button onClick={() => onAnalyze(url)}>분석</button>
    </div>
  );
}
